import { defineConfig, devices } from '@playwright/test';

// Set PW_CHROMIUM_PATH to reuse an already-installed Chromium instead of `npx playwright install`.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions: { executablePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testMatch: /(policy|fpo)\.spec\.ts/ },
    { name: 'phone', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } }, testMatch: /(farmer|citizen)\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    env: { VITE_API_MODE: 'mock' },
    timeout: 60_000,
  },
});
