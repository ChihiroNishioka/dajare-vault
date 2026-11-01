import { defineConfig, devices } from '@playwright/test';

const preview = 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort';
const buildLocal = 'VITE_FORCE_LOCAL=1 npm run build';

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'scripts/screenshots.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'on-first-retry',
  },
  webServer: {
    command: process.env.CI ? preview : `${buildLocal} && ${preview}`,
    url: 'http://127.0.0.1:4173/dajare-vault/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'pc-chromium',
      testMatch: /e2e\/.*\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'iphone-webkit',
      testMatch: /e2e\/.*\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'screenshots-pc',
      testMatch: /scripts\/screenshots\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'screenshots-iphone',
      testMatch: /scripts\/screenshots\.spec\.ts/,
      use: { ...devices['iPhone 13'], deviceScaleFactor: 1 },
    },
  ],
});
