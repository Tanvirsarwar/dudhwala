import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const API = process.env.API_URL ?? 'http://localhost:4000/v1';

/** A fresh random BD mobile number (017 + 8 digits); random so repeated runs never hit per-number OTP limits. */
export function uniquePhone(): string {
  return `017${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
}

/** Reads the latest OTP from the API's development SMS outbox (never enabled outside development). */
export async function latestOtp(page: Page, phone: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${API}/dev/sms?phone=${phone}`);
        const msgs = (await res.json()) as { text: string }[];
        code = /(\d{6})/.exec(msgs.at(-1)?.text ?? '')?.[1];
        return code;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  return code as string;
}

export async function otpLogin(page: Page, phone: string): Promise<void> {
  await page.getByLabel('মোবাইল নম্বর').fill(phone);
  await page.getByRole('button', { name: 'কোড পাঠান' }).click();
  const code = await latestOtp(page, phone);
  await page.getByLabel('কোড').fill(code);
  await page.getByRole('button', { name: 'যাচাই করুন' }).click();
}

/** Accessibility gate (QA_TEST_PLAN §6): no serious or critical axe violations. */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")} — ${v.nodes[0]?.failureSummary?.split("\n")[1]?.trim() ?? ""}`)).toEqual([]);
}

export const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), same parameters as the API. */
export async function totp(secretB32: string, at = Date.now()): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretB32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = (h[h.length - 1] as number) & 0xf;
  const n = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return n.padStart(6, '0');
}
