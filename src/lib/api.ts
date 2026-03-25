import type { CreateRoomResponse, EncryptionEnvelope, RoomResponse, SessionExchangeResponse } from '../types';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBase}${url}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    let parsedError: string | null = null;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      parsedError = parsed.error ?? null;
    } catch {
      parsedError = null;
    }

    throw new Error(parsedError ?? (body || `Request failed with ${response.status}`));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function createRoom(input: {
  title: string;
  timezone: string;
  selectedDates: string[];
  startHour: number;
  endHour: number;
}) {
  return request<CreateRoomResponse>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function exchangeSession(input: {
  roomId: string;
  capabilityType: 'organizer' | 'participant';
  capability: string;
}) {
  return request<SessionExchangeResponse>('/api/session/exchange', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchRoom(roomId: string, sessionToken: string) {
  return request<RoomResponse>(`/api/rooms/${encodeURIComponent(roomId)}`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
}

export function saveSubmission(input: {
  roomId: string;
  sessionToken: string;
  submissionId?: string;
  editToken?: string;
  envelope: EncryptionEnvelope;
}) {
  const payload = {
    ...(input.submissionId ? { submissionId: input.submissionId } : {}),
    ...(input.editToken ? { editToken: input.editToken } : {}),
    envelope: {
      version: input.envelope.version,
      algorithm: input.envelope.algorithm,
      nonce: input.envelope.nonce,
      ciphertext: input.envelope.ciphertext,
    },
  };
  const body = JSON.stringify(payload);

  if (!body || body === 'null' || !body.startsWith('{')) {
    throw new Error('Failed to serialize encrypted submission payload.');
  }

  return request<{
    submissionId: string;
    editToken: string;
  }>(`/api/rooms/${encodeURIComponent(input.roomId)}/submissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });
}

export function deleteRoom(roomId: string, sessionToken: string) {
  return request<void>(`/api/rooms/${encodeURIComponent(roomId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
}
