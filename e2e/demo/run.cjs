// Runs every demo browser suite in order against a running demo. Usage: pnpm test:demo:browser (after ./start-demo.sh)
const { spawnSync } = require('node:child_process');
const suites = ['storefront.cjs', 'admin.cjs', 'platform.cjs', 'resilience.cjs'];
let failed = 0;
for (const s of suites) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [require('node:path').join(__dirname, s)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
