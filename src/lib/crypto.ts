import type { DecryptedSubmission, EncryptionEnvelope } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ENVELOPE_VERSION = 2;
const ENVELOPE_ALGORITHM = 'xchacha20poly1305-ietf';

export async function encryptSubmission(
  roomId: string,
  secret: string,
  payload: DecryptedSubmission,
): Promise<EncryptionEnvelope> {
  const { key, sodiumModule } = await parseRoomKey(secret);
  const nonce = sodiumModule.randombytes_buf(sodiumModule.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodiumModule.crypto_aead_xchacha20poly1305_ietf_encrypt(
    encoder.encode(JSON.stringify(payload)),
    encoder.encode(`room:${roomId}`),
    null,
    nonce,
    key,
  );

  return {
    version: ENVELOPE_VERSION,
    algorithm: ENVELOPE_ALGORITHM,
    nonce: sodiumModule.to_base64(nonce, sodiumModule.base64_variants.URLSAFE_NO_PADDING),
    ciphertext: sodiumModule.to_base64(ciphertext, sodiumModule.base64_variants.URLSAFE_NO_PADDING),
  };
}

export async function decryptSubmission(
  roomId: string,
  secret: string,
  envelope: EncryptionEnvelope,
): Promise<DecryptedSubmission> {
  const { key, sodiumModule } = await parseRoomKey(secret);
  const nonce = sodiumModule.from_base64(
    envelope.nonce,
    sodiumModule.base64_variants.URLSAFE_NO_PADDING,
  );
  const ciphertext = sodiumModule.from_base64(
    envelope.ciphertext,
    sodiumModule.base64_variants.URLSAFE_NO_PADDING,
  );
  const plaintext = sodiumModule.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    encoder.encode(`room:${roomId}`),
    nonce,
    key,
  );

  return JSON.parse(decoder.decode(plaintext)) as DecryptedSubmission;
}

async function readySodium() {
  const sodium = await import('libsodium-wrappers');
  await sodium.default.ready;
  return sodium.default;
}

async function parseRoomKey(secret: string) {
  const sodiumModule = await readySodium();
  const key = sodiumModule.from_base64(secret, sodiumModule.base64_variants.URLSAFE_NO_PADDING);
  if (key.length !== sodiumModule.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error('Invalid room decryption key.');
  }

  return { key, sodiumModule };
}
