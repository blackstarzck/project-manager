import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: './e2e', timeout: 35_000, expect: { timeout: 10_000 }, fullyParallel: false, workers: 1, retries: 0,
  outputDir: './artifacts', reporter: [['list'], ['html', { outputFolder: fileURLToPath(new URL('./report', import.meta.url)), open: 'never' }]],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4310', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' } },
  webServer: [
    { command: 'npx tsx tests/start-server.ts', cwd: root, url: 'http://127.0.0.1:4311/api/health', reuseExistingServer: false, timeout: 60_000, env: { GROQ_API_KEY: '', GROQ_MODEL: 'qa-fixture-only' } },
    { command: 'npx vite --host 127.0.0.1 --port 4310', cwd: root, url: 'http://127.0.0.1:4310', reuseExistingServer: false, timeout: 60_000, env: { VITE_API_PROXY: 'http://127.0.0.1:4311', GROQ_API_KEY: '' } },
  ],
});
