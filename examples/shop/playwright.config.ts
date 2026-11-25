import { defineConfig } from '@playwright/test'
const port = process.env.PORT ?? '4173'
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 15_000, expect: { timeout: 2000 }, use: { baseURL: `http://127.0.0.1:${port}`, actionTimeout: 4000 },
  webServer: { command: 'node server.mjs', url: `http://127.0.0.1:${port}`, reuseExistingServer: false, env: { PORT: port, BUG: process.env.BUG ?? '' } },
})
