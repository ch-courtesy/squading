#!/usr/bin/env node
// Tuning batch 2 (§5 stage 4) — the grid generator.
//
//   TUNE2_AXES=artifacts/tuning2-axes-S3.json node scripts/tuning2-grid.mjs random 120 s3a > grid.json
//   TUNE2_AXES=... node scripts/tuning2-grid.mjs full > grid.json
//
// Writes a grid file for `tests/sweeps/tuning2-stage-search.sweep.ts`. `random` draws from a NAMED
// SEED with the PRNG written out here, so a grid regenerates character for character; `full` is the
// complete cross product and refuses above 400 points rather than quietly truncating.
//
// THE AXES FILE
//   stage      the stage id the axes patch
//   hold       patches applied to EVERY candidate (the rows already chosen this batch, held fixed
//              so the relation guard sees the table the batch is actually building)
//   axes       plain `StageConfig` field names -> list of values, plus four composites:
//                spawnOffset  `spawnRadius = engageRadius + offset` (§1.10 wants >= +2.0)
//                caps         the three `engagedCap`s as one triple
//                intervals    the three `requestInterval`s as one triple
//                mix          the three `meleeToShooter` pairs, by name in `MIXES`
//   grid       the grid's own options: `policies`, `stages`, `campaign` (passed through)
//
// The sweep re-checks §2's ranges AND §2.3's table relations on every candidate, so a draw that
// cannot be adopted is rejected there rather than silently measured. This file is a convenience,
// not the guard.

import { readFileSync } from 'node:fs'

/** mulberry32, seeded by name. The only randomness in the search. */
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

/** The named melee:shooter curves. A name is shorter than three pairs and reads in a label. */
const MIXES = {
  '9:1/5:1/4:1': [[9, 1], [5, 1], [4, 1]],
  '8:1/5:1/3:1': [[8, 1], [5, 1], [3, 1]],
  '6:1/4:1/3:1': [[6, 1], [4, 1], [3, 1]],
  '5:1/3:1/2:1': [[5, 1], [3, 1], [2, 1]],
  '4:1/3:1/2:1': [[4, 1], [3, 1], [2, 1]],
  '4:1/3:1/3:2': [[4, 1], [3, 1], [3, 2]],
  '4:1/2:1/3:2': [[4, 1], [2, 1], [3, 2]],
  '3:1/2:1/3:2': [[3, 1], [2, 1], [3, 2]],
  '3:1/2:1/1:1': [[3, 1], [2, 1], [1, 1]],
  '2:1/3:2/1:1': [[2, 1], [3, 2], [1, 1]],
  '2:1/2:1/3:2': [[2, 1], [2, 1], [3, 2]],
  '2:1/1:1/1:2': [[2, 1], [1, 1], [1, 2]],
  '3:2/1:1/1:2': [[3, 2], [1, 1], [1, 2]],
  '1:1/1:2/1:3': [[1, 1], [1, 2], [1, 3]],
  '1:1/1:1/1:2': [[1, 1], [1, 1], [1, 2]],
  '1:2/1:3/1:4': [[1, 2], [1, 3], [1, 4]],
  '1:2/1:2/1:3': [[1, 2], [1, 2], [1, 3]],
  '1:3/1:4/1:5': [[1, 3], [1, 4], [1, 5]],
}

const COMPOSITE = new Set(['spawnOffset', 'caps', 'intervals', 'mix'])

const spec = JSON.parse(readFileSync(process.env.TUNE2_AXES, 'utf8'))
const STAGE = String(spec.stage)
const HOLD = spec.hold ?? {}
const AXES = spec.axes ?? {}
const GRID_OPTIONS = spec.grid ?? {}

/** Turn one draw of the axes into a `StageConfig` patch. */
function patchOf(draw) {
  const patch = {}
  for (const [name, value] of Object.entries(draw)) {
    if (COMPOSITE.has(name)) continue
    patch[name] = value
  }
  if (draw.spawnOffset !== undefined) {
    const engage = draw.engageRadius ?? null
    if (engage === null) throw new Error('spawnOffset needs engageRadius on the same axes file')
    patch.spawnRadius = Number((engage + draw.spawnOffset).toFixed(4))
  }
  if (draw.caps || draw.intervals || draw.mix) {
    const caps = draw.caps ?? null
    const intervals = draw.intervals ?? null
    const mix = draw.mix ? MIXES[draw.mix] : null
    if (!caps || !intervals || !mix)
      throw new Error('caps, intervals and mix must be given together (a pressure curve is one object)')
    patch.pressurePhases = [0, 900, 1800].map((fromTick, index) => ({
      fromTick,
      engagedCap: caps[index],
      requestInterval: intervals[index],
      meleeToShooter: mix[index],
    }))
  }
  return patch
}

function labelOf(draw) {
  const parts = []
  for (const [name, value] of Object.entries(draw)) {
    if (name === 'mix') parts.push(value)
    else if (name === 'caps') parts.push(`c${value.join('-')}`)
    else if (name === 'intervals') parts.push(`i${value.join('-')}`)
    else if (name === 'spawnOffset') parts.push(`so${value}`)
    else parts.push(`${name.replace(/[a-z]/g, '')}${value}`)
  }
  return `S${STAGE} ${parts.join(' ')}`
}

const names = Object.keys(AXES)
const [mode, countArg, seedArg = 'tuning2'] = process.argv.slice(2)
const candidates = []
const seen = new Set()

function push(draw) {
  const key = JSON.stringify(draw)
  if (seen.has(key)) return
  seen.add(key)
  candidates.push({
    label: labelOf(draw),
    patches: { ...HOLD, [STAGE]: patchOf(draw) },
    ...(spec.diagnostic ? { diagnostic: true } : {}),
  })
}

if (mode === 'full') {
  const total = names.reduce((product, name) => product * AXES[name].length, 1)
  if (total > 400) {
    console.error(`tuning2-grid: full cross product is ${total} points; use \`random\` instead`)
    process.exit(2)
  }
  const walk = (index, draw) => {
    if (index === names.length) {
      push({ ...draw })
      return
    }
    for (const value of AXES[names[index]]) walk(index + 1, { ...draw, [names[index]]: value })
  }
  walk(0, {})
} else if (mode === 'random') {
  const random = rngFrom(seedArg)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const count = Number(countArg ?? 100)
  let attempts = 0
  while (candidates.length < count && attempts < count * 400) {
    attempts += 1
    const draw = {}
    for (const name of names) draw[name] = pick(AXES[name])
    push(draw)
  }
} else {
  console.error('usage: TUNE2_AXES=<axes.json> node scripts/tuning2-grid.mjs random <n> [seed] | full')
  process.exit(2)
}

process.stdout.write(`${JSON.stringify({ ...GRID_OPTIONS, candidates }, null, 1)}\n`)
