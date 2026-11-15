const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/ui', testMatch: '**/*.spec.cjs', timeout: 60000,
  fullyParallel: false, workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173', headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'node tests/ui/serve.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
    // Always own this fixture; reusing an interrupted run can lose its server mid-test.
    { command: 'node tests/ui/serve-auth.cjs', url: 'http://127.0.0.1:4174', reuseExistingServer: false },
  ],
});
