import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/benchmark.spec.ts'],
  outputDir: './test-results',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/',
  },
  webServer: {
    command: process.env.PLAYWRIGHT_SERVER_COMMAND ?? 'npm run dev -- --host 127.0.0.1',
    url: process.env.PLAYWRIGHT_SERVER_URL ?? 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_SERVER_COMMAND,
  },
})
