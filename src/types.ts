export type Room = {
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

export type EncryptedSubmission = {
  id: string;
  roomId: string;
  envelope: EncryptionEnvelope;
  createdAt: string;
  updatedAt: string;
};

export type EncryptionEnvelope = {
  version: number;
  algorithm: string;
  nonce: string;
  ciphertext: string;
};

export type DecryptedSubmission = {
  displayName: string;
  availabilityBySlot: Record<string, boolean>;
};

export type RoomResponse = {
  room: Room;
  retentionDays: number;
  submissions: EncryptedSubmission[];
};

export type RoomAggregate = {
  exactMatches: string[];
  nearMatches: Array<{ slotKey: string; freeCount: number; displayNames: string[] }>;
  participantCount: number;
};

export type CreateRoomResponse = {
  room: Room;
  retentionDays: number;
  organizerLink: string;
  participantLink: string;
};

export type SessionExchangeResponse = {
  roomId: string;
  capabilityType: 'organizer' | 'participant';
  sessionToken: string;
  expiresAt: string;
};
