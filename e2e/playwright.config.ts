import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running stack (API :4000, storefront :3000, admin :3001)
 * with the demo seed loaded. CI starts the stack first (see .github/workflows/e2e.yml).
 * CHROMIUM_PATH lets sandboxes with a preinstalled browser skip downloads.
 */
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: 'results',
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'bn-BD',
    timezoneId: 'Asia/Dhaka',
    launchOptions,
  },
  projects: [
    { name: 'mobile', testMatch: /storefront\.spec\.ts/, use: { ...devices['Pixel 7'], launchOptions } },
    { name: 'desktop', testMatch: /storefront\.spec\.ts/, use: { ...devices['Desktop Chrome'], launchOptions } },
    // Admin + rider journeys run once (serial, shared accounts); the rider steps use a phone-sized context.
    { name: 'admin', testMatch: /admin\.spec\.ts/, use: { ...devices['Desktop Chrome'], launchOptions } },
  ],
});
