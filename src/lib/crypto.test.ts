import { describe, expect, it } from 'vitest';
import { decryptSubmission, encryptSubmission } from './crypto';

describe('crypto', () => {
  const payload = {
    displayName: 'Konrad',
    availabilityBySlot: {
      '2026-03-24T09:00': true,
      '2026-03-24T10:00': false,
    },
  };

  it('round-trips a submission with the same room secret', async () => {
    const secret = crypto.randomUUID().replace(/-/g, '');
    const encodedSecret = btoa(secret).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const encrypted = await encryptSubmission('room-1', encodedSecret, payload);
    const decrypted = await decryptSubmission('room-1', encodedSecret, encrypted);

    expect(encrypted.version).toBe(2);
    expect(encrypted.algorithm).toBe('xchacha20poly1305-ietf');
    expect(decrypted).toEqual(payload);
  });

  it('fails decryption with a different room id', async () => {
    const encodedSecret = toRoomKey();
    const encrypted = await encryptSubmission('room-1', encodedSecret, payload);

    await expect(decryptSubmission('room-2', encodedSecret, encrypted)).rejects.toThrow();
  });

  it('fails decryption when the ciphertext is tampered with', async () => {
    const encodedSecret = toRoomKey();
    const encrypted = await encryptSubmission('room-1', encodedSecret, payload);

    await expect(
      decryptSubmission('room-1', encodedSecret, {
        ...encrypted,
        ciphertext: encrypted.ciphertext.slice(0, -1) + (encrypted.ciphertext.endsWith('A') ? 'B' : 'A'),
      }),
    ).rejects.toThrow();
  });
});

function toRoomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
