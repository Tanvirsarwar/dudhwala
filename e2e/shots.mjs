// Quick visual check: screenshots of key pages (mobile + desktop).
import { chromium, devices } from '@playwright/test';
const base = process.env.WEB_URL ?? 'http://localhost:3000';
const pages = (process.argv[2] ?? '/').split(',');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
for (const [name, dev] of [['mobile', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
  const ctx = await browser.newContext({ ...dev, locale: 'bn-BD' });
  const page = await ctx.newPage();
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `shots/${name}${p.replace(/[/?=&]/g, '_') || '_home'}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
