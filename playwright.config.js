import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {},
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'npm run preview -- --no-clipboard', url: 'http://127.0.0.1:3000', reuseExistingServer: false },
    {
      command: `${process.env.TEST_PYTHON || 'python3'} -m waitress --host=127.0.0.1 --port=8080 --call bewaesserer.app:create_app`,
      url: 'http://127.0.0.1:8080/api/state', reuseExistingServer: false,
      env: { GPIOZERO_PIN_FACTORY: 'mock', BEWAESSERER_CONFIG: process.env.TEST_CONFIG || '/tmp/bewaesserer-ui-settings.json',
        BEWAESSERER_HISTORY: process.env.TEST_HISTORY || '/tmp/bewaesserer-ui-history.sqlite3' },
    },
  ],
});
