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
  if (result.rejected) return `${result.label.padEnd(38)}  REJECTED  ${result.rejected}`
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

/**
 * `TUNE_PRINT` filters the LINES, never the file. `pass` prints the candidates that hold every
 * gate, `near` those missing at most one, `all` (the default) every one of them. A grid of a
 * hundred points is unreadable in full and every point is still in `artifacts/` and in the
 * append-only log either way — this is a terminal filter and not a selection of results.
 */
const PRINT = process.env.TUNE_PRINT ?? 'all'

function failCount(result) {
  if (result.rejected) return 99
  return Object.values(result.verdict).filter((held) => !held).length
}

function print(data) {
  const limit = PRINT === 'pass' ? 0 : PRINT === 'near' ? 1 : Infinity
  let hidden = 0
  for (const result of data.results) {
    if (failCount(result) > limit) {
      hidden += 1
      continue
    }
    console.log(fmt(result))
  }
  if (hidden > 0) console.log(`  (${hidden} candidates with more than ${limit} failing gates not printed)`)
}

const args = process.argv.slice(2)
if (args[0] === '--print') {
  print(JSON.parse(readFileSync(args[1] ?? OUT, 'utf8')))
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
print(data)
console.log(
  `[tuning1] ${data.results.length} candidates x ${data.policies.length} policies x 8 seeds in ` +
    `${(data.elapsedMs / 1000).toFixed(1)}s`,
)
