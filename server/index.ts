import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from 'helmet';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ZodError } from 'zod';
import {
  createAuthSession,
  createRoom,
  deleteExpiredAuthSessions,
  deleteExpiredRooms,
  deleteRoom,
  ensureSchema,
  findAuthSessionById,
  findRoomById,
  findSubmissionById,
  listRoomSubmissions,
  touchAuthSession,
  upsertSubmission,
} from './db.js';
import {
  buildSessionToken,
  type CapabilityType,
  generateId,
  generateSecret,
  getBearerToken,
  hashSecret,
  parseSessionToken,
  securityLog,
  verifySecret,
} from './security.js';
import { parseCreateRoom, parseSaveSubmission, parseSessionExchange } from './validation.js';

const port = Number(process.env.PORT ?? 8787);
const appOrigin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
const parsedRoomTtlDays = Number(process.env.ROOM_TTL_DAYS ?? 30);
const roomTtlDays = Number.isFinite(parsedRoomTtlDays) && parsedRoomTtlDays > 0 ? parsedRoomTtlDays : 30;
const parsedSessionTtlHours = Number(process.env.SESSION_TTL_HOURS ?? 12);
const sessionTtlHours = Number.isFinite(parsedSessionTtlHours) && parsedSessionTtlHours > 0 ? parsedSessionTtlHours : 12;
const currentDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = resolve(currentDir, '..', '..', 'dist');
const distIndexPath = resolve(distDir, 'index.html');
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? appOrigin)
    .split(',')
    .map((value) => normalizeOrigin(value))
    .filter(Boolean),
);

type AuthenticatedSession = {
  id: string;
  roomId: string;
  capabilityType: CapabilityType;
  expiresAt: string;
};

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      hsts: process.env.NODE_ENV === 'production',
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(express.json({ limit: '256kb', type: ['application/json', 'text/plain'] }));
  app.use(requestTimeoutMiddleware(10_000));
  app.use(corsMiddleware);
  app.use((request, response, next) => {
    response.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.header('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(async (_, response, next) => {
    try {
      await deleteExpiredRooms();
      await deleteExpiredAuthSessions();
    } catch (error) {
      response.status(500).json({ error: formatServerError(error) });
      return;
    }
    next();
  });

  app.get('/api/health', (_, response) => {
    response.json({ ok: true });
  });

  app.post('/api/session/exchange', authRateLimit('session_exchange', 5 * 60_000, 20), async (request, response) => {
    try {
      const { roomId, capabilityType, capability } = parseSessionExchange(request.body);
      const room = await findRoomById(roomId);

      if (!room) {
        securityLog('session_exchange_failed', {
          capabilityType,
          ip: request.ip,
          reason: 'room_missing',
          roomId,
        });
        response.status(401).json({ error: 'Unauthorized.' });
        return;
      }

      if (new Date(room.expiresAt).getTime() < Date.now()) {
        securityLog('session_exchange_failed', {
          capabilityType,
          ip: request.ip,
          reason: 'room_expired',
          roomId,
        });
        response.status(410).json({ error: 'Room has expired.' });
        return;
      }

      const storedHash =
        capabilityType === 'organizer' ? room.organizerSecretHash : room.participantAccessHash;
      if (!verifySecret(capability, storedHash)) {
        securityLog('session_exchange_failed', {
          capabilityType,
          ip: request.ip,
          reason: 'bad_capability',
          roomId,
        });
        response.status(401).json({ error: 'Unauthorized.' });
        return;
      }

      const sessionId = generateId(18);
      const sessionSecret = generateSecret();
      const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000).toISOString();
      await createAuthSession({
        id: sessionId,
        roomId: room.id,
        capabilityType,
        sessionTokenHash: hashSecret(sessionSecret),
        expiresAt,
      });

      securityLog('session_exchange_succeeded', {
        capabilityType,
        ip: request.ip,
        roomId,
      });

      response.status(201).json({
        roomId: room.id,
        capabilityType,
        sessionToken: buildSessionToken(sessionId, sessionSecret),
        expiresAt,
      });
    } catch (error) {
      handleRouteError(error, response, {
        method: request.method,
        path: request.path,
        body: request.body,
      });
    }
  });

  app.post('/api/rooms', authRateLimit('room_create', 15 * 60_000, 25), async (request, response) => {
    try {
      const { title, timezone, selectedDates, startHour, endHour } = parseCreateRoom(request.body);
      const sortedDates = [...selectedDates].sort();
      const startDate = sortedDates[0] ?? '';
      const endDate = sortedDates.at(-1) ?? startDate;
      const roomId = generateId(18);
      const organizerSecret = generateSecret();
      const participantAccessToken = generateSecret();
      const participantEncryptionSecret = generateSecret();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + roomTtlDays);

      const room = await createRoom({
        id: roomId,
        title,
        timezone,
        selectedDates: sortedDates,
        startDate,
        endDate,
        startHour,
        endHour,
        slotMinutes: 60,
        expiresAt: expiresAt.toISOString(),
        participantAccessHash: hashSecret(participantAccessToken),
        organizerSecretHash: hashSecret(organizerSecret),
      });

      response.status(201).json({
        room,
        retentionDays: roomTtlDays,
        organizerCapability: organizerSecret,
        participantCapability: participantAccessToken,
        encryptionKey: participantEncryptionSecret,
        organizerLink: `${appOrigin}/organize/${roomId}?cap=${encodeURIComponent(
          organizerSecret,
        )}#key=${encodeURIComponent(participantEncryptionSecret)}`,
        participantLink: `${appOrigin}/rooms/${roomId}?cap=${encodeURIComponent(
          participantAccessToken,
        )}#key=${encodeURIComponent(participantEncryptionSecret)}`,
      });
    } catch (error) {
      handleRouteError(error, response, {
        method: request.method,
        path: request.path,
        body: request.body,
      });
    }
  });

  app.get('/api/rooms/:roomId', authRateLimit('room_fetch', 5 * 60_000, 120), async (request, response) => {
    try {
      const roomId = normalizePathParam(request.params.roomId);
      const bearerToken = getBearerToken(request);
      const parsed = bearerToken ? parseSessionToken(bearerToken) : null;
      if (!parsed) {
        response.status(401).json({ error: 'Unauthorized.' });
        return;
      }

      const candidate = await findAuthSessionById(parsed.sessionId);
      if (
        !candidate ||
        candidate.roomId !== roomId ||
        new Date(candidate.expiresAt).getTime() < Date.now() ||
        !verifySecret(parsed.secret, candidate.sessionTokenHash) ||
        (candidate.capabilityType !== 'participant' && candidate.capabilityType !== 'organizer')
      ) {
        securityLog('session_auth_failed', {
          capabilityType: 'participant_or_organizer',
          ip: request.ip,
          roomId,
          sessionId: parsed.sessionId,
        });
        response.status(401).json({ error: 'Unauthorized.' });
        return;
      }

      await touchAuthSession(candidate.id);
      const session = candidate;
      if (!session) {
        return;
      }

      const room = await findRoomById(session.roomId);
      if (!room) {
        response.status(404).json({ error: 'Room not found.' });
        return;
      }

      if (new Date(room.expiresAt).getTime() < Date.now()) {
        securityLog('expired_room_access', {
          ip: request.ip,
          roomId: room.id,
          sessionId: session.id,
        });
        response.status(410).json({ error: 'Room has expired.' });
        return;
      }

      const submissions = await listRoomSubmissions(room.id);
      response.json({
        room: publicRoom(room),
        retentionDays: roomTtlDays,
        submissions,
      });
    } catch (error) {
      handleRouteError(error, response, {
        method: request.method,
        path: request.path,
        body: request.body,
      });
    }
  });

  app.post('/api/rooms/:roomId/submissions', authRateLimit('submission_write', 5 * 60_000, 80), async (request, response) => {
    try {
      const roomId = normalizePathParam(request.params.roomId);
      const session = await requireSession(request, response, 'participant', roomId);
      if (!session) {
        return;
      }

      const room = await findRoomById(session.roomId);
      if (!room) {
        response.status(404).json({ error: 'Room not found.' });
        return;
      }

      if (new Date(room.expiresAt).getTime() < Date.now()) {
        response.status(410).json({ error: 'Room has expired.' });
        return;
      }

      const { submissionId, editToken, envelope } = parseSaveSubmission(request.body);
      if (envelope.version > 2) {
        securityLog('invalid_ciphertext_version', {
          ip: request.ip,
          roomId: room.id,
          version: envelope.version,
        });
        response.status(400).json({ error: 'Unsupported envelope version.' });
        return;
      }

      let effectiveId = submissionId ?? '';
      let currentEditToken = editToken ?? '';

      if (effectiveId) {
        const existing = await findSubmissionById(effectiveId);
        if (!existing || existing.roomId !== room.id || !verifySecret(currentEditToken, existing.editTokenHash)) {
          securityLog('submission_edit_failed', {
            ip: request.ip,
            roomId: room.id,
            submissionId: effectiveId,
          });
          response.status(401).json({ error: 'Unauthorized.' });
          return;
        }
      } else {
        effectiveId = generateId(18);
      }

      const rotatedEditToken = generateSecret();
      const submission = await upsertSubmission({
        id: effectiveId,
        roomId: room.id,
        editTokenHash: hashSecret(rotatedEditToken),
        envelope,
      });

      response.status(201).json({
        submission,
        submissionId: effectiveId,
        editToken: rotatedEditToken,
      });
    } catch (error) {
      handleRouteError(error, response, {
        method: request.method,
        path: request.path,
        body: request.body,
      });
    }
  });

  app.delete('/api/rooms/:roomId', authRateLimit('room_delete', 5 * 60_000, 20), async (request, response) => {
    try {
      const roomId = normalizePathParam(request.params.roomId);
      const session = await requireSession(request, response, 'organizer', roomId);
      if (!session) {
        return;
      }

      const room = await findRoomById(session.roomId);
      if (!room) {
        response.status(404).json({ error: 'Room not found.' });
        return;
      }

      await deleteRoom(room.id);
      response.status(204).send();
    } catch (error) {
      handleRouteError(error, response, {
        method: request.method,
        path: request.path,
        body: request.body,
      });
    }
  });

  if (process.env.NODE_ENV === 'production' && existsSync(distIndexPath)) {
    app.use(express.static(distDir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_, response) => {
      response.sendFile(distIndexPath);
    });
  }

  return app;
}

export async function startServer() {
  if (process.env.NODE_ENV === 'production' && !isSecureOrigin(appOrigin)) {
    throw new Error('APP_ORIGIN must use HTTPS in production.');
  }

  await ensureSchema();
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`When2Blind API running on http://127.0.0.1:${port}`);
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 12_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

function publicRoom(room: Awaited<ReturnType<typeof findRoomById>> extends infer T ? Exclude<T, null> : never) {
  return {
    id: room.id,
    title: room.title,
    timezone: room.timezone,
    selectedDates: room.selectedDates,
    startDate: room.startDate,
    endDate: room.endDate,
    startHour: room.startHour,
    endHour: room.endHour,
    slotMinutes: room.slotMinutes,
    expiresAt: room.expiresAt,
    createdAt: room.createdAt,
  };
}

async function requireSession(
  request: Request,
  response: Response,
  capabilityType: CapabilityType,
  roomId: string,
) {
  const bearerToken = getBearerToken(request);
  const parsed = bearerToken ? parseSessionToken(bearerToken) : null;
  if (!parsed) {
    response.status(401).json({ error: 'Unauthorized.' });
    return null;
  }

  const session = await findAuthSessionById(parsed.sessionId);
  if (
    !session ||
    session.roomId !== roomId ||
    session.capabilityType !== capabilityType ||
    new Date(session.expiresAt).getTime() < Date.now() ||
    !verifySecret(parsed.secret, session.sessionTokenHash)
  ) {
    securityLog('session_auth_failed', {
      capabilityType,
      ip: request.ip,
      roomId,
      sessionId: parsed.sessionId,
    });
    response.status(401).json({ error: 'Unauthorized.' });
    return null;
  }

  await touchAuthSession(session.id);
  return session as AuthenticatedSession;
}

function authRateLimit(scope: string, windowMs: number, max: number) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) =>
      `${ipKeyGenerator(request.ip ?? request.socket.remoteAddress ?? 'unknown')}:${scope}:${request.params.roomId ?? 'global'}`,
    handler: (request, response) => {
      securityLog('rate_limit_triggered', {
        ip: request.ip,
        path: request.path,
        scope,
      });
      response.status(429).json({ error: 'Too many requests.' });
    },
  });
}

function corsMiddleware(request: Request, response: Response, next: NextFunction) {
  const origin = request.header('origin');
  const normalizedOrigin = normalizeOrigin(origin);

  if (!origin) {
    next();
    return;
  }

  if (!normalizedOrigin || !allowedOrigins.has(normalizedOrigin)) {
    response.status(403).json({ error: 'Origin not allowed.' });
    return;
  }

  response.header('Access-Control-Allow-Origin', normalizedOrigin);
  response.header('Vary', 'Origin');
  response.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

  if (request.method === 'OPTIONS') {
    response.status(204).send();
    return;
  }

  next();
}

function requestTimeoutMiddleware(timeoutMs: number) {
  return (request: Request, response: Response, next: NextFunction) => {
    request.setTimeout(timeoutMs, () => {
      if (!response.headersSent) {
        response.status(408).json({ error: 'Request timed out.' });
      }
    });
    next();
  };
}

function handleRouteError(
  error: unknown,
  response: Response,
  context?: {
    method?: string;
    path?: string;
    body?: unknown;
  },
) {
  if (error instanceof ZodError) {
    console.error(
      '[validation-error]',
      JSON.stringify({
        method: context?.method ?? null,
        path: context?.path ?? null,
        body: summarizeRequestBody(context?.body),
        issues: error.issues,
      }),
    );
    response.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request.' });
    return;
  }

  response.status(500).json({ error: formatServerError(error) });
}

function isSecureOrigin(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function normalizeOrigin(value: string | undefined) {
  if (!value) {
    return '';
  }

  try {
    return new URL(value).origin;
  } catch {
    return value.trim().replace(/\/+$/, '');
  }
}

function normalizePathParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function formatServerError(error: unknown) {
  console.error('[server-error]', error instanceof Error ? error.message : error);
  return 'Internal server error.';
}

function summarizeRequestBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body ?? null;
  }

  const record = body as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (key === 'capability' || key === 'editToken') {
        return [key, '[redacted]'];
      }

      if (key === 'envelope' && value && typeof value === 'object' && !Array.isArray(value)) {
        const envelope = value as Record<string, unknown>;
        return [
          key,
          {
            version: envelope.version ?? null,
            algorithm: envelope.algorithm ?? null,
            nonceLength: typeof envelope.nonce === 'string' ? envelope.nonce.length : null,
            ciphertextLength: typeof envelope.ciphertext === 'string' ? envelope.ciphertext.length : null,
          },
        ];
      }

      return [key, value];
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error('Failed to initialize schema', error);
    process.exit(1);
  });
}
