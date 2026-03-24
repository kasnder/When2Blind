import crypto from 'node:crypto';
import type { Request } from 'express';

const SCRYPT_PARAMS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

export type CapabilityType = 'organizer' | 'participant';

export function generateId(length: number) {
  const bytesNeeded = Math.ceil((length * 3) / 4);
  return crypto.randomBytes(bytesNeeded).toString('base64url').slice(0, length);
}

export function generateSecret(size = 32) {
  return crypto.randomBytes(size).toString('base64url');
}

export function hashSecret(value: string) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(value, salt, 32, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifySecret(value: string, stored: string) {
  if (!value || !stored) {
    return false;
  }

  if (!stored.startsWith('scrypt$')) {
    return false;
  }

  const [, saltEncoded, expectedEncoded] = stored.split('$');
  if (!saltEncoded || !expectedEncoded) {
    return false;
  }

  const salt = Buffer.from(saltEncoded, 'base64url');
  const expected = Buffer.from(expectedEncoded, 'base64url');
  const actual = crypto.scryptSync(value, salt, expected.length, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(actual, expected);
}

export function buildSessionToken(sessionId: string, secret: string) {
  return `${sessionId}.${secret}`;
}

export function parseSessionToken(value: string) {
  const [sessionId, secret] = value.split('.', 2);
  if (!sessionId || !secret) {
    return null;
  }

  return { sessionId, secret };
}

export function getBearerToken(request: Request) {
  const header = request.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function securityLog(event: string, details: Record<string, unknown> = {}) {
  console.info(
    JSON.stringify({
      level: 'info',
      category: 'security',
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

export function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
