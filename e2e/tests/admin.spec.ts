import { readFileSync } from 'node:fs';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ADMIN, API, expectAccessible, otpLogin, totp, uniquePhone } from './helpers';

/**
 * Admin and rider journeys (QA_TEST_PLAN §5: E10–E15, E18). One serial run:
 * Super Admin first login + MFA enrolment → creates a manager and a rider at the
 * demo outlet → a customer places a COD order → the manager confirms, prepares,
 * assigns and dispatches → the rider completes with cash → the manager confirms
 * the cash handover → payment becomes PAID. Requires the stack from e2e/stack.sh.
 */

const creds = JSON.parse(readFileSync(new URL('../.stack/admin.json', import.meta.url), 'utf8')) as { email: string; password: string; runId: string };
const manager = { email: `e2e-manager-${creds.runId}@example.test`, password: `Mgr-${creds.runId}-password!` };
const rider = { phone: uniquePhone(), password: `Rdr-${creds.runId}-password!`, name: `রাইডার ${creds.runId}` };
let orderNumber = '';

/** TOTP codes are single-use per 30 s step (server replay guard): wait for a fresh step when needed. */
const lastStep = new Map<string, number>();
async function freshTotp(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  while ((lastStep.get(secret) ?? -1) >= step) {
    await new Promise((r) => setTimeout(r, 1000));
    step = Math.floor(Date.now() / 30_000);
  }
  lastStep.set(secret, step);
  return totp(secret);
}

async function staffLogin(page: Page, login: string, password: string) {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel('ইমেইল বা মোবাইল').fill(login);
  await page.getByLabel('পাসওয়ার্ড').fill(password);
  await page.getByRole('button', { name: 'লগইন' }).click();
}

/** First login of an MFA role: enrol an authenticator, confirm a code, acknowledge recovery codes. */
async function enrolMfa(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/login\/enroll/);
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await page.getByLabel('৬ অঙ্কের কোড').fill(await freshTotp(secret));
  await page.getByRole('button', { name: 'চালু করুন' }).click();
  await expect(page.getByRole('heading', { name: 'রিকভারি কোড সংরক্ষণ করুন' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'রিকভারি কোড' }).getByRole('listitem')).toHaveCount(10);
  await page.getByRole('link', { name: 'সংরক্ষণ করেছি — চালিয়ে যান' }).click();
  return secret;
}

test.describe.serial('admin and rider operations', () => {
  let superCtx: BrowserContext;
  let managerCtx: BrowserContext;
  let riderCtx: BrowserContext;

  test.afterAll(async () => {
    await Promise.all([superCtx?.close(), managerCtx?.close(), riderCtx?.close()]);
  });

  test('Super Admin first login enrols two-factor and creates outlet staff', async ({ browser }) => {
    superCtx = await browser.newContext();
    const page = await superCtx.newPage();
    await staffLogin(page, creds.email, creds.password);
    await enrolMfa(page);
    await expect(page.getByRole('heading', { name: 'ড্যাশবোর্ড' })).toBeVisible();
    await expect(page.getByText('সব আউটলেট (একত্রে)')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('link', { name: 'আউটলেট ও স্টাফ' }).click();
    await page.locator('li.card', { hasText: 'DEMO-1' }).getByRole('button', { name: 'স্টাফ' }).click();
    const dlg = page.getByRole('dialog');

    await dlg.getByRole('button', { name: 'স্টাফ যোগ করুন' }).click();
    await dlg.getByLabel('পুরো নাম').fill('ই২ই ম্যানেজার');
    await dlg.getByLabel('ইমেইল').fill(manager.email);
    await dlg.getByLabel('ভূমিকা').selectOption({ label: 'আউটলেট ম্যানেজার' });
    await dlg.getByLabel('অস্থায়ী পাসওয়ার্ড').fill(manager.password);
    await dlg.getByRole('button', { name: 'তৈরি করুন' }).click();
    await expect(dlg.getByText(manager.email)).toBeVisible();

    await dlg.getByRole('button', { name: 'স্টাফ যোগ করুন' }).click();
    await dlg.getByLabel('পুরো নাম').fill(rider.name);
    await dlg.getByLabel('মোবাইল').fill(rider.phone);
    await dlg.getByLabel('ভূমিকা').selectOption({ label: 'ডেলিভারি রাইডার' });
    await dlg.getByLabel('অস্থায়ী পাসওয়ার্ড').fill(rider.password);
    await dlg.getByRole('button', { name: 'তৈরি করুন' }).click();
    await expect(dlg.getByText(rider.name)).toBeVisible();
    await expectAccessible(page);
  });

  test('a customer places a cash-on-delivery order', async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    await page.goto('/p/demo-butter-scotch-cake-1');
    await page.getByRole('button', { name: 'কার্টে যোগ করুন' }).click();
    await expect(page.getByRole('status')).toContainText('কার্টে যোগ হয়েছে');
    await page.goto('/checkout');
    const phone = uniquePhone();
    await otpLogin(page, phone);
    await page.getByLabel('প্রাপকের নাম').fill('অ্যাডমিন টেস্ট গ্রাহক');
    await page.getByLabel('মোবাইল', { exact: true }).fill(phone);
    await page.getByLabel('এলাকা', { exact: true }).selectOption({ label: 'জিন্দাবাজার (ডেমো)' });
    await page.getByLabel('বাসা / রাস্তা').fill('বাসা ৩');
    await page.getByLabel(/শর্তাবলী/).check();
    await page.getByRole('button', { name: 'অর্ডার নিশ্চিত করুন' }).click();
    const heading = page.getByRole('heading', { name: /অর্ডার DW-/ });
    await expect(heading).toBeVisible();
    orderNumber = /DW-[A-Z0-9-]+/.exec((await heading.textContent()) ?? '')?.[0] ?? '';
    expect(orderNumber).not.toBe('');
    await ctx.close();
  });

  test('the outlet manager confirms, prepares, assigns a rider and dispatches', async ({ browser }) => {
    managerCtx = await browser.newContext();
    const page = await managerCtx.newPage();
    await staffLogin(page, manager.email, manager.password);
    await enrolMfa(page);
    await expect(page.getByRole('heading', { name: 'ড্যাশবোর্ড' })).toBeVisible();
    // Fixed to one outlet: a pill, no outlet switcher; Super Admin-only areas are hidden.
    await expect(page.getByLabel('সক্রিয় আউটলেট')).toContainText('DEMO-1');
    await expect(page.getByRole('combobox', { name: 'আউটলেট' })).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'প্রধান মেনু' });
    await expect(nav.getByRole('link', { name: 'পেমেন্ট ও রিফান্ড' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'কুপন' })).toHaveCount(0);

    await nav.getByRole('link', { name: 'অর্ডার' }).click();
    await page.getByLabel('অর্ডার নম্বর বা মোবাইল').fill(orderNumber);
    await page.getByRole('button', { name: 'খুঁজুন' }).click();
    await page.getByRole('link', { name: orderNumber }).click();
    await expect(page.getByRole('heading', { name: `অর্ডার ${orderNumber}` })).toBeVisible();
    await expectAccessible(page);

    const confirm = page.getByRole('button', { name: 'নিশ্চিত করুন' });
    if (await confirm.isVisible()) await confirm.click(); // outlets may auto-confirm
    await page.getByRole('button', { name: 'প্রস্তুত শুরু' }).click();
    await page.getByRole('button', { name: 'প্রস্তুত — পাঠানো যাবে' }).click();
    await expect(page.getByText('পাঠানোর আগে একজন রাইডার নির্ধারণ করুন।')).toBeVisible();
    await page.getByLabel('রাইডার').selectOption({ label: rider.name });
    await page.getByRole('button', { name: 'রাইডার নির্ধারণ' }).click();
    await expect(page.getByText('রাইডার নির্ধারণ হয়েছে')).toBeVisible();
    await page.getByRole('button', { name: 'রাইডারের হাতে দিন' }).click();
    await expect(page.getByRole('heading', { name: `অর্ডার ${orderNumber}` }).locator('..')).toContainText('ডেলিভারির পথে');
  });

  test('the rider completes the delivery and records the cash collected (phone layout)', async ({ browser }) => {
    riderCtx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await riderCtx.newPage();
    await staffLogin(page, rider.phone, rider.password);
    await expect(page).toHaveURL(/\/rider$/);
    await expect(page.getByRole('heading', { name: 'আজকের ডেলিভারি' })).toBeVisible();
    const card = page.locator('li.card', { hasText: orderNumber });
    await expect(card).toContainText('ক্যাশ নিতে হবে');
    await expectAccessible(page);

    await card.getByRole('button', { name: 'পৌঁছেছি' }).click();
    await expect(page.getByText(`${orderNumber}: আপডেট পাঠানো হয়েছে`)).toBeVisible();
    await card.getByRole('button', { name: 'ডেলিভারি সম্পন্ন' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'নিশ্চিত করুন' }).click();
    await expect(page.getByRole('region', { name: 'শেষ হয়েছে' }).or(page.locator('section', { hasText: 'শেষ হয়েছে' }))).toContainText(orderNumber);

    // Riders never reach the order board.
    await page.goto(`${ADMIN}/orders`);
    await expect(page).toHaveURL(/\/rider$/);
  });

  test('the manager confirms the cash handover and the order becomes paid', async () => {
    const page = await managerCtx.newPage();
    await page.goto(`${ADMIN}/cod`);
    const row = page.getByRole('row', { name: new RegExp(orderNumber) });
    await expect(row).toContainText('রাইডারের কাছে');
    await row.getByRole('button', { name: 'ক্যাশ পেয়েছি' }).click();
    await expect(page.getByText(`${orderNumber}: ক্যাশ জমা নিশ্চিত`)).toBeVisible();

    await page.goto(`${ADMIN}/orders?q=${orderNumber}`);
    const line = page.getByRole('row', { name: new RegExp(orderNumber) });
    await expect(line).toContainText('ডেলিভারি সম্পন্ন');
    await expect(line).toContainText('COD · পরিশোধিত');

    // A manager cannot call Super Admin finance endpoints.
    const res = await page.request.get(`${API}/admin/payments`);
    expect(res.status()).toBe(403);
  });

  test('the manager runs a stock count that corrects one item', async () => {
    const page = await managerCtx.newPage();
    await page.goto(`${ADMIN}/stock-counts`);
    await page.getByRole('button', { name: 'নতুন গণনা শুরু' }).click();
    await expect(page.getByText('গণনা শুরু হয়েছে')).toBeVisible();
    const row = page.getByRole('row', { name: /Opera Cake/ });
    const system = Number((await row.getByRole('cell').nth(1).textContent())?.trim());
    await row.getByRole('textbox').fill(String(system - 1));
    await expect(row.getByRole('cell').nth(3)).toHaveText('-1');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'সম্পন্ন করুন' }).click();
    await expect(page.getByText('গণনা সম্পন্ন, স্টক সমন্বয় হয়েছে')).toBeVisible();
    await expectAccessible(page);
  });

  test('the manager sets opening hours; staff pages stay accessible', async () => {
    const page = await managerCtx.newPage();
    await page.goto(`${ADMIN}/hours`);
    await expect(page.getByRole('heading', { name: 'সাপ্তাহিক সময়সূচি' })).toBeVisible();
    await expectAccessible(page);
    // Super Admin sees the privacy queue; the manager's menu does not list it.
    await expect(page.getByRole('link', { name: 'গ্রাহক তথ্য মুছা' })).toHaveCount(0);
    const sa = await superCtx.newPage();
    await sa.goto(`${ADMIN}/privacy`);
    await expect(sa.getByRole('heading', { name: 'গ্রাহকের তথ্য মুছে ফেলার অনুরোধ' })).toBeVisible();
    await expectAccessible(sa);
  });
});
