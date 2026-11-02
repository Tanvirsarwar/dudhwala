// Prints one SQL statement that creates a staff account, for the Supabase SQL editor.
//   STAFF_PASSWORD='long password' node scripts/staff-insert-sql.mjs admin you@example.com "Your Name"
// The password is read from the environment and hashed here (Argon2id, same settings as the API); only the hash is printed.
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';

const [role, email, name] = [process.argv[2]?.toUpperCase(), process.argv[3]?.trim().toLowerCase(), process.argv[4]?.trim()];
const password = process.env.STAFF_PASSWORD ?? '';
if ((role !== 'ADMIN' && role !== 'MANAGER') || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
  console.error('Usage: STAFF_PASSWORD=... node scripts/staff-insert-sql.mjs admin|manager email "Full Name"');
  process.exit(2);
}
if (password.length < 12) {
  console.error('STAFF_PASSWORD must be at least 12 characters');
  process.exit(2);
}
const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
const q = (s) => `'${s.replace(/'/g, "''")}'`;
console.log(`INSERT INTO "user" (id, kind, staff_role, email, full_name, password_hash, updated_at)
VALUES ('${randomUUID()}', 'STAFF', '${role}', ${q(email)}, ${q(name)}, ${q(hash)}, now());`);
