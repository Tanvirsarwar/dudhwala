// Prints a Markdown table of every API route with its access rule, from the controller sources.
// Usage: node scripts/routes.mjs > ../../docs/API_ROUTES.md
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src', import.meta.url).pathname;
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'generated') walk(p); }
    else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(p);
  }
})(root);

const rows = [];
for (const file of files.sort()) {
  const src = readFileSync(file, 'utf8');
  const classRe = /@Controller\((?:'([^']*)')?\)[\s\S]*?export class (\w+)/g;
  let m;
  const classes = [];
  while ((m = classRe.exec(src))) classes.push({ prefix: m[1] ?? '', name: m[2], at: m.index });
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    const body = src.slice(c.at, classes[i + 1]?.at ?? src.length);
    const methodRe = /@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)([\s\S]*?)\n\s*(?:async\s+)?(\w+)\(/g;
    let mm;
    while ((mm = methodRe.exec(body))) {
      const decos = mm[3];
      const access =
        /@Public\(\{ audience: 'CUSTOMER' \}\)/.test(decos) ? 'public (anonymous or customer cart)' :
        /@Public\(\)/.test(decos) ? 'public' :
        /@CustomerOnly\(\)/.test(decos) ? 'customer' :
        /@StaffAny\(\{ allowWithoutMfa: true \}\)/.test(decos) ? 'staff (MFA not yet required)' :
        /@StaffAny\(/.test(decos) ? 'any staff' :
        (decos.match(/@RequirePermission\('([^']+)'\)/)?.[1] ? `\`${decos.match(/@RequirePermission\('([^']+)'\)/)[1]}\`` : '**none — denied**');
      const path = ['/v1', c.prefix, mm[2] ?? ''].filter(Boolean).join('/').replace(/\/+/g, '/');
      rows.push({ method: mm[1].toUpperCase(), path, access, where: `${relative(root, file)}` });
    }
  }
}
rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const out = [
  '# API routes (generated)',
  '',
  'Generated from the controller sources by `apps/api/scripts/routes.mjs`. Do not edit by hand; regenerate after changing routes.',
  'Access: `public` = no login; `customer` = customer session; a permission code = staff session with that permission (and TOTP when the role requires it). Outlet-scoped routes also check that the outlet in the path belongs to the caller (404 otherwise).',
  '',
  `Routes: ${rows.length}`,
  '',
  '| Method | Path | Access | Source |',
  '|--------|------|--------|--------|',
  ...rows.map((r) => `| ${r.method} | \`${r.path}\` | ${r.access} | ${r.where} |`),
  '',
];
process.stdout.write(out.join('\n'));
