import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/benchmark.spec.ts'],
  outputDir: './test-results',
  // Every spec in this suite drives a live WebGL context, and batch G added two that play a
  // whole 90-second battle in real time. At Playwright's default (half the cores — five on the
  // machine this was measured on) the contention is enough to change RESULTS, not just timings:
  // `three-renderer`'s DPR reduction and `diorama-action`'s whole-battle run both failed at five
  // workers and both passed serially, and one run lost a dynamic import to the dev server
  // outright. Two workers is where the suite stopped reporting failures it does not have.
  workers: 2,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/',
  },
  webServer: {
    command: process.env.PLAYWRIGHT_SERVER_COMMAND ?? 'npm run dev -- --host 127.0.0.1',
    url: process.env.PLAYWRIGHT_SERVER_URL ?? 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_SERVER_COMMAND,
  },
})
