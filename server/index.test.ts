import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.APP_ORIGIN = 'http://127.0.0.1:5173';
process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:5173';

const db = vi.hoisted(() => ({
  createAuthSession: vi.fn(),
  createRoom: vi.fn(),
  deleteExpiredAuthSessions: vi.fn(),
  deleteExpiredRooms: vi.fn(),
  deleteRoom: vi.fn(),
  ensureSchema: vi.fn(),
  findAuthSessionById: vi.fn(),
  findRoomById: vi.fn(),
  findSubmissionById: vi.fn(),
  listRoomSubmissions: vi.fn(),
  touchAuthSession: vi.fn(),
  upsertSubmission: vi.fn(),
}));

vi.mock('./db.js', () => db);

import { createApp } from './index.js';
import { buildSessionToken, hashSecret } from './security.js';

const participantCapability = 'participant_secret_token_1234567890';
const organizerCapability = 'organizer_secret_token_1234567890';
const sessionSecret = 'session_secret_token_1234567890';
const organizerSessionSecret = 'organizer_session_secret_1234567890';
const editToken = 'edit_token_secret_1234567890';
const envelope = {
  version: 2,
  algorithm: 'xchacha20poly1305-ietf',
  nonce: 'nonce_payload_value_1234',
  ciphertext: 'ciphertext_payload_value_1234',
};
const selectedDates = ['2026-03-24', '2026-03-27', '2026-03-30'];

describe('When2Blind API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.deleteExpiredRooms.mockResolvedValue(0);
    db.deleteExpiredAuthSessions.mockResolvedValue(0);
    db.touchAuthSession.mockResolvedValue(undefined);
  });

  it('creates a room with organizer and participant bootstrap links', async () => {
    db.createRoom.mockImplementation(async (input: Record<string, unknown>) => ({
      id: String(input.id),
      title: 'Team sync',
      timezone: 'Europe/Amsterdam',
      selectedDates,
      startDate: '2026-03-24',
      endDate: '2026-03-30',
      startHour: Number(input.startHour),
      endHour: Number(input.endHour),
      slotMinutes: 60,
      expiresAt: '2026-04-23T20:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
    }));

    const response = await request(createApp())
      .post('/api/rooms')
      .send({
        title: 'Team sync',
        timezone: 'Europe/Amsterdam',
        selectedDates,
        startHour: 8,
        endHour: 19,
      });

    expect(response.status).toBe(201);
    expect(response.body.room.startHour).toBe(8);
    expect(response.body.room.endHour).toBe(19);
    expect(response.body.organizerLink).toContain(`/organize/${response.body.room.id}?cap=`);
    expect(response.body.organizerLink).toContain('#key=');
    expect(response.body.participantLink).toContain(`/rooms/${response.body.room.id}?cap=`);
    expect(response.body.participantLink).toContain('#key=');
  });

  it('rejects invalid room hour windows', async () => {
    const response = await request(createApp())
      .post('/api/rooms')
      .send({
        title: 'Team sync',
        timezone: 'Europe/Amsterdam',
        selectedDates,
        startHour: 18,
        endHour: 9,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('End hour');
  });

  it('exchanges a participant capability for a short-lived session', async () => {
    db.findRoomById.mockResolvedValue({
      id: 'room-1',
      title: 'Team sync',
      timezone: 'Europe/Amsterdam',
      selectedDates,
      startDate: '2026-03-24',
      endDate: '2026-03-30',
      startHour: 9,
      endHour: 17,
      slotMinutes: 60,
      expiresAt: '2099-04-23T20:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      participantAccessHash: hashSecret(participantCapability),
      organizerSecretHash: hashSecret(organizerCapability),
    });
    db.createAuthSession.mockResolvedValue({
      id: 'session-1',
      roomId: 'room-1',
      capabilityType: 'participant',
      sessionTokenHash: 'ignored',
      expiresAt: '2099-04-23T21:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      lastUsedAt: '2026-03-24T20:00:00.000Z',
    });

    const response = await request(createApp()).post('/api/session/exchange').send({
      roomId: 'room-1',
      capabilityType: 'participant',
      capability: participantCapability,
    });

    expect(response.status).toBe(201);
    expect(response.body.sessionToken).toContain('.');
    expect(db.createAuthSession).toHaveBeenCalledOnce();
  });

  it('returns room metadata and ciphertext submissions for a valid participant session', async () => {
    db.findAuthSessionById.mockResolvedValue({
      id: 'session-1',
      roomId: 'room-1',
      capabilityType: 'participant',
      sessionTokenHash: hashSecret(sessionSecret),
      expiresAt: '2099-04-23T21:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      lastUsedAt: '2026-03-24T20:00:00.000Z',
    });
    db.findRoomById.mockResolvedValue({
      id: 'room-1',
      title: 'Team sync',
      timezone: 'Europe/Amsterdam',
      selectedDates,
      startDate: '2026-03-24',
      endDate: '2026-03-30',
      startHour: 9,
      endHour: 17,
      slotMinutes: 60,
      expiresAt: '2099-04-23T20:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      participantAccessHash: hashSecret(participantCapability),
      organizerSecretHash: hashSecret(organizerCapability),
    });
    db.listRoomSubmissions.mockResolvedValue([
      {
        id: 'submission-1',
        roomId: 'room-1',
        envelope,
        createdAt: '2026-03-24T20:00:00.000Z',
        updatedAt: '2026-03-24T20:00:00.000Z',
      },
    ]);

    const response = await request(createApp())
      .get('/api/rooms/room-1')
      .set('Authorization', `Bearer ${buildSessionToken('session-1', sessionSecret)}`);

    expect(response.status).toBe(200);
    expect(response.body.submissions[0].envelope.version).toBe(2);
    expect(db.touchAuthSession).toHaveBeenCalledWith('session-1');
  });

  it('returns room metadata and ciphertext submissions for a valid organizer session', async () => {
    db.findAuthSessionById.mockResolvedValue({
      id: 'session-1',
      roomId: 'room-1',
      capabilityType: 'organizer',
      sessionTokenHash: hashSecret(organizerSessionSecret),
      expiresAt: '2099-04-23T21:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      lastUsedAt: '2026-03-24T20:00:00.000Z',
    });
    db.findRoomById.mockResolvedValue({
      id: 'room-1',
      title: 'Team sync',
      timezone: 'Europe/Amsterdam',
      selectedDates,
      startDate: '2026-03-24',
      endDate: '2026-03-30',
      startHour: 9,
      endHour: 17,
      slotMinutes: 60,
      expiresAt: '2099-04-23T20:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      participantAccessHash: hashSecret(participantCapability),
      organizerSecretHash: hashSecret(organizerCapability),
    });
    db.listRoomSubmissions.mockResolvedValue([
      {
        id: 'submission-1',
        roomId: 'room-1',
        envelope,
        createdAt: '2026-03-24T20:00:00.000Z',
        updatedAt: '2026-03-24T20:00:00.000Z',
      },
    ]);

    const response = await request(createApp())
      .get('/api/rooms/room-1')
      .set('Authorization', `Bearer ${buildSessionToken('session-1', organizerSessionSecret)}`);

    expect(response.status).toBe(200);
    expect(response.body.submissions[0].envelope.version).toBe(2);
    expect(db.touchAuthSession).toHaveBeenCalledWith('session-1');
  });

  it('rotates the participant edit token on each successful write', async () => {
    db.findAuthSessionById.mockResolvedValue({
      id: 'session-1',
      roomId: 'room-1',
      capabilityType: 'participant',
      sessionTokenHash: hashSecret(sessionSecret),
      expiresAt: '2099-04-23T21:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      lastUsedAt: '2026-03-24T20:00:00.000Z',
    });
    db.findRoomById.mockResolvedValue({
      id: 'room-1',
      title: 'Team sync',
      timezone: 'Europe/Amsterdam',
      selectedDates,
      startDate: '2026-03-24',
      endDate: '2026-03-30',
      startHour: 9,
      endHour: 17,
      slotMinutes: 60,
      expiresAt: '2099-04-23T20:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      participantAccessHash: hashSecret(participantCapability),
      organizerSecretHash: hashSecret(organizerCapability),
    });
    db.findSubmissionById.mockResolvedValue({
      id: 'submission-1',
      roomId: 'room-1',
      editTokenHash: hashSecret(editToken),
      envelope,
      createdAt: '2026-03-24T20:00:00.000Z',
      updatedAt: '2026-03-24T20:00:00.000Z',
    });
    db.upsertSubmission.mockResolvedValue({
      id: 'submission-1',
      roomId: 'room-1',
      envelope,
      createdAt: '2026-03-24T20:00:00.000Z',
      updatedAt: '2026-03-24T20:01:00.000Z',
    });

    const response = await request(createApp())
      .post('/api/rooms/room-1/submissions')
      .set('Authorization', `Bearer ${buildSessionToken('session-1', sessionSecret)}`)
      .send({
        submissionId: 'submission-1',
        editToken,
        envelope,
      });

    expect(response.status).toBe(201);
    expect(response.body.editToken).toBeTruthy();
    expect(db.upsertSubmission).toHaveBeenCalledOnce();
  });

  it('requires an organizer session to delete a room', async () => {
    db.findAuthSessionById.mockResolvedValue({
      id: 'session-1',
      roomId: 'room-1',
      capabilityType: 'organizer',
      sessionTokenHash: hashSecret(organizerSessionSecret),
      expiresAt: '2099-04-23T21:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      lastUsedAt: '2026-03-24T20:00:00.000Z',
    });
    db.findRoomById.mockResolvedValue({
      id: 'room-1',
      title: 'Team sync',
      timezone: 'Europe/Amsterdam',
      selectedDates,
      startDate: '2026-03-24',
      endDate: '2026-03-30',
      startHour: 9,
      endHour: 17,
      slotMinutes: 60,
      expiresAt: '2099-04-23T20:00:00.000Z',
      createdAt: '2026-03-24T20:00:00.000Z',
      participantAccessHash: hashSecret(participantCapability),
      organizerSecretHash: hashSecret(organizerCapability),
    });

    const denied = await request(createApp()).delete('/api/rooms/room-1');
    expect(denied.status).toBe(401);

    const allowed = await request(createApp())
      .delete('/api/rooms/room-1')
      .set('Authorization', `Bearer ${buildSessionToken('session-1', organizerSessionSecret)}`);

    expect(allowed.status).toBe(204);
    expect(db.deleteRoom).toHaveBeenCalledWith('room-1');
  });

  it('applies no-referrer policy and clickjacking headers', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
