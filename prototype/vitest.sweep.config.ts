import { defineConfig } from 'vitest/config'

// The I9 sweep (§5 stage 1) is a measurement tool, not a regression test: it runs
// on demand via `npm run sweep:i9` and is deliberately kept out of the `npm test`
// include glob so that a minutes-long geometry sweep never sits in the unit-test
// loop. It has its own config rather than a flag on the main one so the two
// cannot drift.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/sweeps/**/*.sweep.ts'],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 30 * 60 * 1000,
  },
})
