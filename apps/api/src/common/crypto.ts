import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

export const newId = (): string => uuidv7();

/** 256-bit random token, base64url. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmacHex = (key: string, value: string): string => createHmac('sha256', key).update(value).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Uniform numeric code from a CSPRNG, e.g. OTPs. */
export const numericCode = (digits: number): string => String(randomInt(0, 10 ** digits)).padStart(digits, '0');

/**
 * AES-256-GCM envelope: keyId(1-byte len + utf8) | iv(12) | tag(16) | ciphertext.
 * Key id allows rotation (SECURITY_REVIEW §6).
 */
export class DataCipher {
  private readonly key: Buffer;
  constructor(
    keyBase64: string,
    private readonly keyId: string,
  ) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes');
  }

  encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const kid = Buffer.from(this.keyId, 'utf8');
    return new Uint8Array(Buffer.concat([Buffer.from([kid.length]), kid, iv, cipher.getAuthTag(), ct]));
  }

  decrypt(blob: Uint8Array): string {
    const buf = Buffer.from(blob);
    const kidLen = buf[0] ?? 0;
    const kid = buf.subarray(1, 1 + kidLen).toString('utf8');
    if (kid !== this.keyId) throw new Error(`Unknown encryption key id ${kid}`);
    const iv = buf.subarray(1 + kidLen, 13 + kidLen);
    const tag = buf.subarray(13 + kidLen, 29 + kidLen);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(29 + kidLen)), decipher.final()]).toString('utf8');
  }
}
