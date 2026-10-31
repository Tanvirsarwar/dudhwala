import { describe, expect, it } from 'vitest';
import { poolConfig } from '../src/prisma/prisma.service.js';

describe('poolConfig (database TLS)', () => {
  it('keeps the URL and pins the session to UTC when no CA is configured', () => {
    expect(poolConfig({ DATABASE_URL: 'postgresql://u:p@h:5432/d?sslmode=require' })).toEqual({ connectionString: 'postgresql://u:p@h:5432/d?sslmode=require', options: '-c TimeZone=UTC' });
  });

  it('with a CA: verifies the certificate and drops ssl* URL parameters that would override it', () => {
    const cfg = poolConfig({ DATABASE_URL: 'postgresql://u:p@h:5432/d?sslmode=require&connect_timeout=5&sslrootcert=x', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----' });
    expect(cfg).toMatchObject({ options: '-c TimeZone=UTC', ssl: { rejectUnauthorized: true, ca: expect.stringContaining('BEGIN CERTIFICATE') } });
    expect(cfg.connectionString).toBe('postgresql://u:p@h:5432/d?connect_timeout=5');
  });

  it('accepts a CA pasted with literal \\n sequences', () => {
    const cfg = poolConfig({ DATABASE_URL: 'postgresql://u:p@h:5432/d', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----' });
    expect((cfg as { ssl: { ca: string } }).ssl.ca).toBe('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----');
  });

  it('caps the pool at DATABASE_POOL_MAX (1 per serverless instance) with and without a CA', () => {
    expect(poolConfig({ DATABASE_URL: 'postgresql://u:p@h:6543/d', DATABASE_POOL_MAX: 1 })).toMatchObject({ max: 1 });
    expect(poolConfig({ DATABASE_URL: 'postgresql://u:p@h:6543/d', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----', DATABASE_POOL_MAX: 1 })).toMatchObject({ max: 1, ssl: { rejectUnauthorized: true } });
  });
});
