#!/usr/bin/env node
// Tuning batch 1 (§5 stage 4) — the search driver.
//
//   node scripts/tuning1.mjs <grid.json>          run a grid and print the table
//   node scripts/tuning1.mjs --print <out.json>   re-print a finished run
//
// `tests/sweeps/tuning1-stage-search.sweep.ts` is the measurement; this is the thing that runs it
// and turns its JSON into one line per candidate. It exists because vitest's stdout is not a
// reliable channel in every terminal this repo is driven from, and a search whose results can only
// be read by scrolling a test runner's log is a search nobody will run twice.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const OUT = process.env.TUNE_OUT ?? 'artifacts/tuning1-search.json'

function fmt(result) {
  const skilled = result.policies['skilled']
  const wins = (id) => (result.policies[id] ? `${result.policies[id].wins}/8` : '  - ')
  const failed = Object.entries(result.verdict)
    .filter(([, held]) => !held)
    .map(([name]) => name)
  return [
    result.label.padEnd(38),
    `sk ${wins('skilled')}`,
    `fl ${wins('flees-always')}`,
    `no ${wins('tactical-no-input')}`,
    `cp ${wins('camps-in-place')}`,
    `I2 ${skilled.damageRatio.toFixed(3)}`,
    `[${skilled.windowRatios.map((r) => r.toFixed(2)).join('/')}]`,
    `idle ${String(skilled.longestIdleRun).padStart(2)}`,
    `eng ${skilled.meanEngaged.toFixed(1).padStart(4)}`,
    `shr ${(skilled.shooterShare * 100).toFixed(1).padStart(4)}%`,
    `end ${Math.round(skilled.meanEndTick)}`,
    result.i4DamageGap === null
      ? 'I4    -'
      : `I4 ${result.i4DamageGap >= 0 ? '+' : ''}${result.i4DamageGap.toFixed(3)}`,
    failed.length === 0 ? 'ALL PASS' : `fail: ${failed.join(',')}`,
  ].join('  ')
}

const args = process.argv.slice(2)
if (args[0] === '--print') {
  const data = JSON.parse(readFileSync(args[1] ?? OUT, 'utf8'))
  for (const result of data.results) console.log(fmt(result))
  process.exit(0)
}

const grid = args[0]
if (!grid) {
  console.error('usage: node scripts/tuning1.mjs <grid.json>')
  process.exit(2)
}

execFileSync(
  'npx',
  ['vitest', 'run', '--config', 'vitest.sweep.config.ts', 'tests/sweeps/tuning1-stage-search.sweep.ts'],
  { env: { ...process.env, TUNE_GRID: grid }, stdio: ['ignore', 'ignore', 'inherit'] },
)

const data = JSON.parse(readFileSync(OUT, 'utf8'))
for (const result of data.results) console.log(fmt(result))
console.log(
  `[tuning1] ${data.results.length} candidates x ${data.policies.length} policies x 8 seeds in ` +
    `${(data.elapsedMs / 1000).toFixed(1)}s`,
)
