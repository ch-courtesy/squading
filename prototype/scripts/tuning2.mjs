#!/usr/bin/env node
// Tuning batch 2 (§5 stage 4) — the search driver.
//
//   node scripts/tuning2.mjs <grid.json>          run a grid and print the table
//   node scripts/tuning2.mjs --print <out.json>   re-print a finished run
//   node scripts/tuning2.mjs --log [log.jsonl]    compact the append-only log to one TSV row each
//
// `tests/sweeps/tuning2-stage-search.sweep.ts` is the measurement; this runs it and turns its JSON
// into one line per candidate. Same reason batch 1 had one: a search whose results can only be read
// by scrolling a test runner's log is a search nobody will run twice.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const OUT = process.env.TUNE2_OUT ?? 'artifacts/tuning2-search.json'
const PRINT = process.env.TUNE2_PRINT ?? 'all'

function stageCell(stage) {
  const skilled = stage.policies['skilled']
  const wins = (id) => (stage.policies[id] ? String(stage.policies[id].wins) : '-')
  const failed = Object.entries(stage.verdict)
    .filter(([name, held]) => !held && name !== 'I2 strict')
    .map(([name]) => name)
  return [
    `S${stage.stageId}`,
    `sk${wins('skilled')}`,
    `fl${wins('flees-always')}`,
    `no${wins('tactical-no-input')}`,
    `cp${wins('camps-in-place')}`,
    `I2 ${skilled.damageRatio.toFixed(3)}`,
    `[${skilled.windowRatios.map((r) => r.toFixed(2)).join('/')}]`,
    `eng${skilled.meanEngaged.toFixed(1).padStart(5)}`,
    `end${String(Math.round(skilled.meanEndTick)).padStart(5)}`,
    stage.i4DamageGap === null ? '' : `I4${stage.i4DamageGap >= 0 ? '+' : ''}${stage.i4DamageGap.toFixed(3)}`,
    failed.length === 0 ? 'PASS' : `fail:${failed.join(',')}`,
  ]
    .filter((part) => part !== '')
    .join(' ')
}

function fmt(result) {
  if (result.rejected) return `${result.label.padEnd(40)}  REJECTED  ${result.rejected}`
  const cells = result.stages.map(stageCell)
  for (const campaign of result.campaigns) {
    cells.push(`CAMP:${campaign.policy} done ${campaign.completed}/8 [${campaign.clearedBySeed.join('')}]`)
  }
  const label = result.relationBreaks ? `DIAG ${result.label}` : result.label
  return `${label.padEnd(40)}  ${cells.join('  |  ')}${result.relationBreaks ? `  <<${result.relationBreaks}` : ''}`
}

function failCount(result) {
  if (result.rejected) return 99
  let failed = 0
  for (const stage of result.stages) {
    for (const [name, held] of Object.entries(stage.verdict)) {
      if (name === 'I2 strict') continue
      if (!held) failed += 1
    }
  }
  return failed
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

// `--log` compacts the append-only JSONL to one line per candidate PER STAGE MEASURED: the label,
// the patch, and the numbers every gate is read off. It is generated rather than hand-written so
// it cannot disagree with what was measured.
if (args[0] === '--log') {
  const rows = readFileSync(args[1] ?? 'artifacts/tuning2-search-log.jsonl', 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const patchOf = (patches) =>
    Object.entries(patches)
      .map(([stageId, patch]) => {
        const { pressurePhases, ...rest } = patch
        const parts = Object.entries(rest).map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        if (pressurePhases) {
          parts.push(
            `phases=${pressurePhases.map((phase) => phase.engagedCap).join('-')}|` +
              `${pressurePhases.map((phase) => phase.requestInterval).join('-')}|` +
              `${pressurePhases.map((phase) => phase.meleeToShooter.join(':')).join('/')}`,
          )
        }
        return `s${stageId}{${parts.join(' ')}}`
      })
      .join(' ')
  const num = (value, digits = 3) => (value === null || value === undefined ? '' : value.toFixed(digits))
  console.log(
    [
      'label', 'patch', 'stage', 'sk', 'fl', 'no', 'cp', 'ig', 'I2', 'w0', 'w1', 'w2',
      'idle', 'meanEngaged', 'meanEnd', 'meanStanding', 'shooterShare', 'I4gap', 'campDone',
      'campCleared', 'failed',
    ].join('\t'),
  )
  for (const result of rows) {
    const camp = result.campaigns && result.campaigns.length > 0 ? result.campaigns[0] : null
    if (result.rejected) {
      console.log(
        [result.label, patchOf(result.patches), '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', `REJECTED ${result.rejected}`].join('\t'),
      )
      continue
    }
    for (const stage of result.stages) {
      const skilled = stage.policies['skilled']
      const cell = (id, field) => (stage.policies[id] ? stage.policies[id][field] : '')
      console.log(
        [
          result.label,
          patchOf(result.patches),
          stage.stageId,
          cell('skilled', 'wins'),
          cell('flees-always', 'wins'),
          cell('tactical-no-input', 'wins'),
          cell('camps-in-place', 'wins'),
          cell('ignores-range', 'wins'),
          num(skilled.damageRatio),
          ...skilled.windowRatios.map((ratio) => num(ratio)),
          skilled.longestIdleRun,
          num(skilled.meanEngaged, 2),
          Math.round(skilled.meanEndTick),
          num(skilled.meanStanding, 2),
          num(skilled.shooterShare, 3),
          stage.i4DamageGap === null ? '' : num(stage.i4DamageGap),
          camp ? camp.completed : '',
          camp ? camp.clearedBySeed.join('') : '',
          [
            ...Object.entries(stage.verdict)
              .filter(([name, held]) => !held && name !== 'I2 strict')
              .map(([name]) => name),
            ...(result.relationBreaks ? [`DIAGNOSTIC ${result.relationBreaks}`] : []),
          ].join(';'),
        ].join('\t'),
      )
    }
  }
  process.exit(0)
}

if (args[0] === '--print') {
  print(JSON.parse(readFileSync(args[1] ?? OUT, 'utf8')))
  process.exit(0)
}

const grid = args[0]
if (!grid) {
  console.error('usage: node scripts/tuning2.mjs <grid.json>')
  process.exit(2)
}

execFileSync(
  'npx',
  ['vitest', 'run', '--config', 'vitest.sweep.config.ts', 'tests/sweeps/tuning2-stage-search.sweep.ts'],
  { env: { ...process.env, TUNE2_GRID: grid }, stdio: ['ignore', 'ignore', 'inherit'] },
)

const data = JSON.parse(readFileSync(OUT, 'utf8'))
print(data)
console.log(`[tuning2] ${data.results.length} candidates in ${(data.elapsedMs / 1000).toFixed(1)}s`)
