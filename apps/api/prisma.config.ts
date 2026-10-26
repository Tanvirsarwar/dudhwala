import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Optional so `prisma generate` / `validate` work without a database;
  // migrate commands fail clearly when it is missing.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
