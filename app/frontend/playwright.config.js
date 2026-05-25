/**
 * E2E Test Prerequisites:
 * 1. DISABLE_AI=true in .env
 * 2. BYPASS_CAPTCHA=true in .env
 * 3. SEED_E2E_USER=1 in .env (creates e2e-test-user poweruser)
 * 4. docker compose -f docker/docker-compose.yml up -d
 * 5. Run from app/frontend/: npx playwright test
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalTeardown: './tests/e2e/globalTeardown.mjs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.js/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
