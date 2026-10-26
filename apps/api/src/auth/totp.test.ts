import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from './totp.js';
import { DataCipher, numericCode } from '../common/crypto.js';

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  // RFC 4226 Appendix D test vectors, secret "12345678901234567890".
  const rfcSecret = Buffer.from('12345678901234567890');
  it.each([
    [0, '755224'],
    [1, '287082'],
    [9, '520489'],
  ])('HOTP counter %i = %s', (c, code) => expect(hotp(rfcSecret, c)).toBe(code));

  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(rfcSecret)).equals(rfcSecret)).toBe(true);
    expect(() => base32Decode('01!')).toThrow();
  });

  it('accepts ±1 step and rejects others', () => {
    const s = base32Encode(rfcSecret);
    const t = new Date('2026-11-01T00:00:00Z');
    const code = totpAt(s, t);
    expect(verifyTotp(s, code, t)).toBe(Math.floor(t.getTime() / 30_000));
    expect(verifyTotp(s, code, new Date(t.getTime() + 30_000))).not.toBeNull();
    expect(verifyTotp(s, code, new Date(t.getTime() + 90_000))).toBeNull();
    expect(verifyTotp(s, 'abcdef', t)).toBeNull();
  });

  it('builds an otpauth URI', () => {
    expect(otpauthUri('ABC', 'a@b.c')).toBe('otpauth://totp/Dudhwala%20Admin%3Aa%40b.c?secret=ABC&issuer=Dudhwala%20Admin&algorithm=SHA1&digits=6&period=30');
  });
});

describe('crypto', () => {
  const c = new DataCipher(Buffer.alloc(32, 1).toString('base64'), 'k1');
  it('encrypts and decrypts with key id', () => {
    const blob = c.encrypt('secret');
    expect(Buffer.from(blob).toString('utf8')).not.toContain('secret');
    expect(c.decrypt(blob)).toBe('secret');
    expect(() => new DataCipher(Buffer.alloc(32, 1).toString('base64'), 'k2').decrypt(blob)).toThrow('Unknown encryption key id');
  });
  it('detects tampering', () => {
    const blob = c.encrypt('secret');
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 1;
    expect(() => c.decrypt(blob)).toThrow();
  });
  it('rejects wrong key length', () => expect(() => new DataCipher('AAAA', 'k')).toThrow());
  it('generates fixed-width numeric codes', () => {
    for (let i = 0; i < 50; i++) expect(numericCode(6)).toMatch(/^\d{6}$/);
  });
});
