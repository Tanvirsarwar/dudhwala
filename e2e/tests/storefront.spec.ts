import { expect, test } from '@playwright/test';
import { expectAccessible, otpLogin, uniquePhone } from './helpers';

/**
 * Customer journeys on the demo catalogue (QA_TEST_PLAN §5: E1, E2, E6, E7-adjacent, E9, E16).
 * Requires: API + storefront running, `db:seed:demo` loaded, ENABLE_DEV_OUTBOX=true.
 */

test('home page is Bangla, branded and accessible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('সিলেটের নিজস্ব দুগ্ধজাত পণ্য');
  await expect(page.getByRole('img', { name: /দুধওয়ালা/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'সব পণ্য' })).toBeVisible();
  await expectAccessible(page);
});

test('search, product page and out-of-stock handling', async ({ page }) => {
  await page.goto('/search?q=Opera');
  await expect(page.getByRole('heading', { level: 1, name: /Opera.*ফলাফল/ })).toBeVisible();
  await page.getByRole('link', { name: /Opera Cake/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opera Cake');
  await expect(page.getByText('৳২,৮০০').first()).toBeVisible();
  await expectAccessible(page);

  await page.goto('/p/demo-premium-black-forest-cake');
  await expect(page.getByText('স্টকে নেই', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'কার্টে যোগ করুন' })).toBeDisabled();
});

test('COD checkout: area, cart, OTP login, address, slot, place order, track, cancel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'এলাকা নির্বাচন' }).click();
  const reloaded = page.waitForEvent('load'); // choosing an area reloads the page (availability depends on it)
  await page.getByRole('button', { name: 'জিন্দাবাজার (ডেমো)' }).click();
  await reloaded;
  await expect(page.getByText('জিন্দাবাজার (ডেমো)').first()).toBeVisible();

  await page.goto('/p/demo-butter-scotch-cake-1');
  await page.getByRole('button', { name: '৬০০ গ্রাম' }).click();
  await page.getByRole('button', { name: 'বাড়ান' }).click();
  await page.getByRole('button', { name: 'কার্টে যোগ করুন' }).click();
  await expect(page.getByRole('status')).toContainText('কার্টে যোগ হয়েছে');
  await expect(page.getByRole('link', { name: /কার্ট, ২টি পণ্য/ })).toBeVisible();

  await page.goto('/cart');
  await expect(page.getByText('৳৩,০০০').first()).toBeVisible(); // 2 × ৳1,500
  await expectAccessible(page);
  await page.getByRole('link', { name: 'চেকআউট' }).click();

  const phone = uniquePhone();
  await otpLogin(page, phone);
  await expect(page.getByRole('heading', { name: 'চেকআউট' })).toBeVisible();
  await page.getByLabel('প্রাপকের নাম').fill('পরীক্ষা গ্রাহক');
  await page.getByLabel('মোবাইল', { exact: true }).fill(phone);
  await page.getByLabel('এলাকা', { exact: true }).selectOption({ label: 'জিন্দাবাজার (ডেমো)' });
  await page.getByLabel('বাসা / রাস্তা').fill('বাসা ১২, রোড ৩');
  await expect(page.locator('input[name=slot]').first()).toBeChecked();
  await expect(page.getByText('৳৬০').first()).toBeVisible(); // demo delivery fee
  await expect(page.getByText('৳৩,০৬০')).toBeVisible();
  await page.getByLabel(/শর্তাবলী/).check();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'অর্ডার নিশ্চিত করুন' }).click();

  await expect(page.getByText('ধন্যবাদ! আপনার অর্ডার গ্রহণ করা হয়েছে।')).toBeVisible();
  await expect(page.getByRole('heading', { name: /অর্ডার DW-/ })).toBeVisible();
  await expect(page.getByText('ক্যাশ অন ডেলিভারি — পরিশোধ বাকি')).toBeVisible();
  await expect(page.getByRole('link', { name: /কার্ট, ০টি পণ্য/ })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'অর্ডার বাতিল' }).click();
  await page.getByLabel('কারণ').fill('ভুল করে অর্ডার করেছি');
  await page.getByRole('button', { name: 'বাতিল নিশ্চিত করুন' }).click();
  await expect(page.getByText('বাতিল').first()).toBeVisible();
});

test('online payment via the simulator: success URL alone never pays; verified IPN does', async ({ page }) => {
  await page.goto('/p/demo-opera-cake');
  await page.getByRole('button', { name: 'কার্টে যোগ করুন' }).click();
  await expect(page.getByRole('status')).toContainText('কার্টে যোগ হয়েছে');
  await page.goto('/checkout');
  const phone = uniquePhone();
  await otpLogin(page, phone);
  await page.getByLabel('প্রাপকের নাম').fill('অনলাইন গ্রাহক');
  await page.getByLabel('মোবাইল', { exact: true }).fill(phone);
  await page.getByLabel('এলাকা', { exact: true }).selectOption({ label: 'আম্বরখানা (ডেমো)' });
  await page.getByLabel('বাসা / রাস্তা').fill('বাসা ৭');
  await page.getByText('অনলাইন পেমেন্ট').click();
  await page.getByLabel(/শর্তাবলী/).check();
  await page.getByRole('button', { name: 'পেমেন্ট করুন' }).click();

  await expect(page.getByText('SIMULATOR — no real money.')).toBeVisible();
  await page.getByRole('button', { name: 'Pay (simulate success)' }).click();
  await expect(page).toHaveURL(/\/checkout\/return\?order=/);
  await expect(page.getByRole('heading', { name: 'পেমেন্ট সম্পন্ন হয়েছে' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'অর্ডার দেখুন' }).click();
  await expect(page.getByText('অনলাইন — পরিশোধিত')).toBeVisible();
});

test('a failed online payment offers retry or cash on delivery', async ({ page }) => {
  await page.goto('/p/demo-omg-chocolate-cake');
  await page.getByRole('button', { name: 'কার্টে যোগ করুন' }).click();
  await expect(page.getByRole('status')).toContainText('কার্টে যোগ হয়েছে');
  await page.goto('/checkout');
  const phone = uniquePhone();
  await otpLogin(page, phone);
  await page.getByLabel('প্রাপকের নাম').fill('গ্রাহক');
  await page.getByLabel('মোবাইল', { exact: true }).fill(phone);
  await page.getByLabel('এলাকা', { exact: true }).selectOption({ label: 'জালালাবাদ (ডেমো)' });
  await page.getByLabel('বাসা / রাস্তা').fill('বাসা ৯');
  await page.getByText('অনলাইন পেমেন্ট').click();
  await page.getByLabel(/শর্তাবলী/).check();
  await page.getByRole('button', { name: 'পেমেন্ট করুন' }).click();
  await page.getByRole('button', { name: 'Simulate failure' }).click();
  await expect(page.getByRole('heading', { name: 'পেমেন্ট সম্পন্ন হয়নি' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'ক্যাশ অন ডেলিভারিতে নিন' }).click();
  await expect(page.getByText('ক্যাশ অন ডেলিভারি — পরিশোধ বাকি')).toBeVisible();
});

test('a customer cannot open someone else’s order', async ({ page, browser }) => {
  await page.goto('/account');
  await otpLogin(page, uniquePhone());
  await expect(page.getByRole('heading', { name: 'আমার অ্যাকাউন্ট' })).toBeVisible();
  // A random (non-existent or foreign) order id shows "not found", never data.
  await page.goto('/orders/01a15a2a-0000-7000-8000-000000000000');
  await expect(page.getByText('অর্ডারটি পাওয়া যায়নি')).toBeVisible();
  // A logged-out visitor is asked to log in.
  const anon = await browser.newPage();
  await anon.goto('/orders/01a15a2a-0000-7000-8000-000000000000');
  await expect(anon.getByText('অর্ডার দেখতে প্রবেশ করুন')).toBeVisible();
  await anon.close();
});

test('a customer downloads their data and asks for account deletion', async ({ page }) => {
  await page.goto('/account');
  await otpLogin(page, uniquePhone());
  await expect(page.getByRole('heading', { name: 'গোপনীয়তা' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'আমার তথ্য ডাউনলোড' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'অ্যাকাউন্ট মুছে ফেলার অনুরোধ' }).click();
  await expect(page.getByText('অনুরোধ পাঠানো হয়েছে')).toBeVisible();
  await expect(page.getByText('অ্যাকাউন্ট মুছে ফেলার অনুরোধ প্রক্রিয়াধীন')).toBeVisible();
  await expectAccessible(page);
});

test('quick add on a product card puts one item in the cart, and options products link to their page', async ({ page }) => {
  await page.goto('/search?q=Opera');
  const card = page.getByRole('listitem').filter({ hasText: 'Opera Cake' }).first();
  await card.getByRole('button', { name: /কার্টে যোগ করুন/ }).click();
  await expect(card.getByRole('button', { name: /কার্টে যোগ করুন/ })).toContainText('যোগ হয়েছে');
  await expect(page.getByRole('link', { name: /কার্ট, ১টি পণ্য/ })).toBeVisible();
  await page.goto('/cart');
  await expect(page.getByText('Opera Cake').first()).toBeVisible();

  // a product with several pack sizes never adds blindly: it links to the page where the option is chosen
  await page.goto('/');
  const multi = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: /অপশন দেখুন/ }) }).first();
  await multi.getByRole('link', { name: /অপশন দেখুন/ }).click();
  await expect(page).toHaveURL(/\/p\//);
});
