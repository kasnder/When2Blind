import { Pool } from 'pg';

export type RoomRecord = {
  id: string;
  title: string;
  timezone: string;
  selectedDates: string[];
  startDate: string;
  endDate: string;
  startHour: number;
  endHour: number;
  slotMinutes: number;
  expiresAt: string;
  createdAt: string;
};

export type SubmissionRecord = {
  id: string;
  roomId: string;
  envelope: {
    version: number;
    algorithm: string;
    nonce: string;
    ciphertext: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type AuthSessionRecord = {
  id: string;
  roomId: string;
  capabilityType: 'organizer' | 'participant';
  sessionTokenHash: string;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
};

const connectionString = process.env.DATABASE_URL;
const allowInvalidDatabaseTls = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false';

if (allowInvalidDatabaseTls) {
  console.warn(
    '[security] DATABASE_SSL_REJECT_UNAUTHORIZED=false is set. TLS certificate validation for the database connection is disabled. Do not use this in production.',
  );
}

if (!connectionString) {
  throw new Error('Missing DATABASE_URL for the When2Blind API.');
}

const pool = new Pool({
  connectionString,
  ssl:
    connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: !allowInvalidDatabaseTls },
});

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      timezone TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      start_hour INTEGER NOT NULL DEFAULT 9,
      end_hour INTEGER NOT NULL DEFAULT 17,
      slot_minutes INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      participant_access_hash TEXT NOT NULL,
      organizer_secret_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS start_hour INTEGER NOT NULL DEFAULT 9`);
  await pool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS end_hour INTEGER NOT NULL DEFAULT 17`);
  await pool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS selected_dates DATE[]`);
  await pool.query(`
    UPDATE rooms
    SET selected_dates = ARRAY(
      SELECT value::date
      FROM generate_series(start_date, end_date, INTERVAL '1 day') AS value
    )
    WHERE selected_dates IS NULL OR cardinality(selected_dates) = 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      edit_token_hash TEXT NOT NULL,
      envelope JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      capability_type TEXT NOT NULL,
      session_token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function createRoom(input: {
  id: string;
  title: string;
  timezone: string;
  selectedDates: string[];
  startDate: string;
  endDate: string;
  startHour: number;
  endHour: number;
  slotMinutes: number;
  expiresAt: string;
  participantAccessHash: string;
  organizerSecretHash: string;
}) {
  const result = await pool.query<RoomRecord>(
    `
      INSERT INTO rooms (
        id, title, timezone, selected_dates, start_date, end_date, start_hour, end_hour, slot_minutes,
        expires_at, participant_access_hash, organizer_secret_hash
      )
      VALUES ($1, $2, $3, $4::date[], $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING
        id,
        title,
        timezone,
        ARRAY(
          SELECT to_char(value, 'YYYY-MM-DD')
          FROM unnest(selected_dates) AS value
          ORDER BY value
        ) AS "selectedDates",
        start_date::text AS "startDate",
        end_date::text AS "endDate",
        start_hour AS "startHour",
        end_hour AS "endHour",
        slot_minutes AS "slotMinutes",
        expires_at AS "expiresAt",
        created_at AS "createdAt"
    `,
    [
      input.id,
      input.title,
      input.timezone,
      input.selectedDates,
      input.startDate,
      input.endDate,
      input.startHour,
      input.endHour,
      input.slotMinutes,
      input.expiresAt,
      input.participantAccessHash,
      input.organizerSecretHash,
    ],
  );

  return result.rows[0];
}

export async function findRoomById(id: string) {
  const result = await pool.query<
    RoomRecord & {
      participantAccessHash: string;
      organizerSecretHash: string;
    }
  >(
    `
      SELECT
        id,
        title,
        timezone,
        ARRAY(
          SELECT to_char(value, 'YYYY-MM-DD')
          FROM unnest(selected_dates) AS value
          ORDER BY value
        ) AS "selectedDates",
        start_date::text AS "startDate",
        end_date::text AS "endDate",
        start_hour AS "startHour",
        end_hour AS "endHour",
        slot_minutes AS "slotMinutes",
        expires_at AS "expiresAt",
        created_at AS "createdAt",
        participant_access_hash AS "participantAccessHash",
        organizer_secret_hash AS "organizerSecretHash"
      FROM rooms
      WHERE id = $1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}

export async function deleteRoom(id: string) {
  await pool.query(`DELETE FROM rooms WHERE id = $1`, [id]);
}

export async function deleteExpiredRooms(now = new Date().toISOString()) {
  const result = await pool.query<{ id: string }>(
    `
      DELETE FROM rooms
      WHERE expires_at < $1
      RETURNING id
    `,
    [now],
  );

  return result.rowCount ?? 0;
}

export async function upsertSubmission(input: {
  id: string;
  roomId: string;
  editTokenHash: string;
  envelope: SubmissionRecord['envelope'];
}) {
  const result = await pool.query<SubmissionRecord>(
    `
      INSERT INTO submissions (id, room_id, edit_token_hash, envelope)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id)
      DO UPDATE SET
        edit_token_hash = EXCLUDED.edit_token_hash,
        envelope = EXCLUDED.envelope,
        updated_at = NOW()
      RETURNING
        id,
        room_id AS "roomId",
        envelope,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [input.id, input.roomId, input.editTokenHash, JSON.stringify(input.envelope)],
  );

  return result.rows[0];
}

export async function findSubmissionById(id: string) {
  const result = await pool.query<
    SubmissionRecord & {
      editTokenHash: string;
    }
  >(
    `
      SELECT
        id,
        room_id AS "roomId",
        envelope,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        edit_token_hash AS "editTokenHash"
      FROM submissions
      WHERE id = $1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}

export async function listRoomSubmissions(roomId: string) {
  const result = await pool.query<SubmissionRecord>(
    `
      SELECT
        id,
        room_id AS "roomId",
        envelope,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM submissions
      WHERE room_id = $1
      ORDER BY created_at ASC
    `,
    [roomId],
  );

  return result.rows;
}

export async function createAuthSession(input: {
  id: string;
  roomId: string;
  capabilityType: AuthSessionRecord['capabilityType'];
  sessionTokenHash: string;
  expiresAt: string;
}) {
  const result = await pool.query<AuthSessionRecord>(
    `
      INSERT INTO auth_sessions (id, room_id, capability_type, session_token_hash, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        room_id AS "roomId",
        capability_type AS "capabilityType",
        session_token_hash AS "sessionTokenHash",
        expires_at AS "expiresAt",
        created_at AS "createdAt",
        last_used_at AS "lastUsedAt"
    `,
    [input.id, input.roomId, input.capabilityType, input.sessionTokenHash, input.expiresAt],
  );

  return result.rows[0];
}

export async function findAuthSessionById(id: string) {
  const result = await pool.query<AuthSessionRecord>(
    `
      SELECT
        id,
        room_id AS "roomId",
        capability_type AS "capabilityType",
        session_token_hash AS "sessionTokenHash",
        expires_at AS "expiresAt",
        created_at AS "createdAt",
        last_used_at AS "lastUsedAt"
      FROM auth_sessions
      WHERE id = $1
    `,
    [id],
  );

  return result.rows[0] ?? null;
}

export async function touchAuthSession(id: string) {
  await pool.query(
    `
      UPDATE auth_sessions
      SET last_used_at = NOW()
      WHERE id = $1
    `,
    [id],
  );
}

export async function deleteExpiredAuthSessions(now = new Date().toISOString()) {
  const result = await pool.query(
    `
      DELETE FROM auth_sessions
      WHERE expires_at < $1
    `,
    [now],
  );

  return result.rowCount ?? 0;
}
