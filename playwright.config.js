// playwright.config.js
//
// Config for the frontend smoke test suite. Kept minimal — this project is
// not adopting Playwright broadly; it's only used for the smoke tier.
//
// Local run:
//   npx playwright install --with-deps chromium
//   PROD_HOST=app.hearthandpage.ca npx playwright test
//
// CI runs it via the post-deploy smoke test workflow after the API health
// and pdf-runtime-check jobs pass.

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: 'tests/smoke',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ignoreHTTPSErrors: false,
    trace: 'retain-on-failure',
    // Reasonable timeouts for a smoke test — the app should be fast.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
};
