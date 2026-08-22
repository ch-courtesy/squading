#!/usr/bin/env node
import { readFileSync } from 'node:fs'
// Tuning batch 1 (§5 stage 4) — the grid generator.
//
//   TUNE_AXES=artifacts/axes.json node scripts/tuning1-grid.mjs random <n> <seed> > grid.json
//
// Writes a grid file for `tests/sweeps/tuning1-stage-search.sweep.ts`. The draw is from a NAMED
// SEED with the PRNG written out here, so a grid can be regenerated character for character and
// the search is reproducible rather than remembered.
//
// EVERY AXIS IS A PLAIN `StageConfig` FIELD NAME with a list of values to draw from, plus four
// composite ones the shape of the row does not let you write flat:
//
//   spawnOffset   `spawnRadius = engageRadius + offset` (§1.10 wants >= +2.0 and the pair is
//                 what matters, not the absolute radius)
//   caps          the three `engagedCap`s, as one triple
//   intervals     the three `requestInterval`s, as one triple
//   mix           the three `meleeToShooter` pairs, by the name in `MIXES`
//
// The sweep re-checks §2's ranges AND §2.3's table relations on every candidate, so a draw that
// cannot be adopted is rejected there rather than silently measured. This file is a convenience,
// not the guard.

/** mulberry32, seeded by name. Small, and it is the only randomness in the search. */
function rngFrom(name) {
  let hash = 2166136261
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  let state = hash >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The named melee:shooter curves.
 *
 * Stage 1's identity in the campaign design is the most melee-heavy OPENING in the table, and
 * stages 2 and 3 open at `4:1`, so an opening below `5:1` is not a stage-1 curve at all. The later
 * two phases are freer: stage 4 only has to stay above stage 1 phase by phase, and it sits at
 * `1:1 / 1:2 / 1:3`.
 */
const MIXES = {
  '5:1/3:1/2:1': [[5, 1], [3, 1], [2, 1]],
  '5:1/3:1/3:2': [[5, 1], [3, 1], [3, 2]],
  '5:1/3:1/1:1': [[5, 1], [3, 1], [1, 1]],
  '5:1/2:1/1:1': [[5, 1], [2, 1], [1, 1]],
  '5:1/2:1/3:2': [[5, 1], [2, 1], [3, 2]],
  '5:1/3:2/1:1': [[5, 1], [3, 2], [1, 1]],
  '5:1/3:2/2:3': [[5, 1], [3, 2], [2, 3]],
  '5:1/2:1/2:3': [[5, 1], [2, 1], [2, 3]],
  '6:1/3:1/2:1': [[6, 1], [3, 1], [2, 1]],
  '6:1/2:1/1:1': [[6, 1], [2, 1], [1, 1]],
  '7:1/3:1/1:1': [[7, 1], [3, 1], [1, 1]],
  '9:2/3:1/2:1': [[9, 2], [3, 1], [2, 1]],
}

const DEFAULT_AXES = {
  engageRadius: [10, 11, 12],
  spawnOffset: [3, 4, 5],
  leashRadius: [8.5, 9, 9.5, 10, 10.5, 11],
  eliteHp: [19, 20, 21, 22],
  mix: Object.keys(MIXES),
  caps: [[12, 18, 24], [14, 20, 26], [16, 22, 28]],
  intervals: [[10, 8, 6], [9, 7, 5], [9, 8, 6], [8, 7, 5]],
  meleeMoveSpeed: [0.14],
  meleeAttackInterval: [15],
  shooterMoveSpeed: [0.06],
  shooterAttackInterval: [30],
}

const AXES = process.env.TUNE_AXES
  ? { ...DEFAULT_AXES, ...JSON.parse(readFileSync(process.env.TUNE_AXES, 'utf8')) }
  : DEFAULT_AXES

const COMPOSITE = new Set(['spawnOffset', 'caps', 'intervals', 'mix'])

const [mode, countArg, seed = 'tuning1'] = process.argv.slice(2)
if (mode !== 'random') {
  console.error('usage: TUNE_AXES=<axes.json> node scripts/tuning1-grid.mjs random <n> [seed]')
  process.exit(2)
}

const random = rngFrom(seed)
const pick = (list) => list[Math.floor(random() * list.length)]
const count = Number(countArg ?? 100)
const seen = new Set()
const candidates = []
let attempts = 0

while (candidates.length < count && attempts < count * 400) {
  attempts += 1
  const draw = {}
  const shown = []
  for (const [name, values] of Object.entries(AXES)) {
    if (COMPOSITE.has(name)) continue
    draw[name] = pick(values)
  }
  const engageRadius = draw.engageRadius ?? 10
  draw.spawnRadius = engageRadius + pick(AXES.spawnOffset)
  const mix = pick(AXES.mix)
  const caps = pick(AXES.caps)
  const intervals = pick(AXES.intervals)
  draw.pressurePhases = [0, 900, 1800].map((fromTick, index) => ({
    fromTick,
    engagedCap: caps[index],
    requestInterval: intervals[index],
    meleeToShooter: MIXES[mix][index],
  }))
  // §1.12's cooldown is not an independent axis here: it tracks the telegraph, because a stage
  // whose telegraph and cooldown drift apart is measuring two things under one name.
  if (draw.eliteTelegraphTicks !== undefined && AXES.eliteCooldownTicks === undefined) {
    draw.eliteCooldownTicks = draw.eliteTelegraphTicks + 2
  }

  const key = JSON.stringify(draw)
  if (seen.has(key)) continue
  seen.add(key)

  for (const [name, value] of Object.entries(draw)) {
    if (name === 'pressurePhases') continue
    shown.push(`${name.replace(/[a-z]/g, '')}${value}`)
  }
  candidates.push({
    label: `R e${engageRadius}/s${draw.spawnRadius} ${mix} c${caps.join('-')} i${intervals.join('-')} ${shown.join(' ')}`,
    patch: draw,
  })
}

process.stdout.write(`${JSON.stringify({ policies: 'screen', candidates }, null, 1)}\n`)
