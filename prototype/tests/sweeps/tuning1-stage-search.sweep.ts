// Tuning batch 1 (§5 stage 4) — THE STAGE SEARCH HARNESS.
//
//   TUNE_GRID=artifacts/tuning1-grid.json \
//     npx vitest run --config vitest.sweep.config.ts tests/sweeps/tuning1-stage-search.sweep.ts
//
// WHAT THIS IS FOR. `campaign2-stage-band.sweep.ts` measures the table as it stands. This file
// measures a table that does NOT stand — it takes a list of candidate rows, plays each one on the
// fixed eight-seed band, and writes every candidate's invariant numbers to one file. §5 stage 4 is
// a search over §2's ranges and a search needs to try combinations faster than a person can edit
// `stages.ts`, run a band, and read a report. One candidate over four policies is ~1.5 s here.
//
// IT CHANGES NO SOURCE FILE. The candidate row is injected by mocking `stageConfigOf`/`stageOf`,
// which is where every rule module reads its numbers from (`movement.ts`, `spawn.ts`, `enemy.ts`,
// `attacks.ts`, `elite.ts`, `state.ts`, and the policies' own view). The real table is still the
// fallback for every id a candidate does not name, so a candidate for stage 1 leaves stages 2-7
// exactly as written. Nothing here can leak into a `npm test` run: `.sweep.ts` is outside that
// include glob.
//
// THE CANDIDATE IS RANGE-CHECKED BEFORE IT IS PLAYED. §2 boxes most of the knobs and §1 relates
// the rest; a candidate outside either is a thrown error and not a measurement, because a number
// measured outside the box is a number that cannot be adopted and reporting it as a result would
// be reporting a solution that does not exist. `stages.ts`'s own module-load asserts cover the §1
// relations for the real table; this file repeats them for the candidates, which never reach it.
//
// WHAT IT DOES NOT DO: it does not pick. It writes numbers. The report argues.
//
// ---------------------------------------------------------------------------
// THE INVARIANTS IT READS OFF, AND HOW (§3)
// ---------------------------------------------------------------------------
//   I1   longest run of consecutive ticks with zero engaged enemies, on `skilled`. Must be < 60.
//        "Engaged" is `campaign2-stage-band.sweep.ts`'s definition, character for character: a
//        standing enemy holding a contact slot, or inside some standing friendly's attack range.
//   I2   `skilled`'s cumulative damage taken over the initial roster hp, in `[0.55, 0.80]`, and
//        the same fraction inside each of §1.10's three windows, each in `[0.10, 0.45]`.
//   I3   `tactical-no-input` wins == 0/8.
//   I8   `flees-always` wins == 0/8.
//   I10  `camps-in-place` wins <= 2/8.
//   I4   `skilled` vs `ignores-range`: damage gap AND the win bands (>=6/8 vs <=2/8). NOT a target
//        of this batch (`i4-inversion-diagnosis.md` §4 shows the damage half is arithmetically
//        unreachable at the current melee:shooter mix), but recorded on every candidate anyway —
//        a knob that moves the shooter share of incoming damage moves this, and that is exactly
//        what the campaign's stage 4 needs to know.
//   plus `skilled` wins == 8/8, which is the campaign design's §2.4 first check.
//
// The damage split by source is recorded too (`melee-contact` / `shooter-shot` / `elite-blast`),
// because I4's ceiling is a statement about that split and the only way to see a knob move it is
// to carry it on every row.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// The mock has to be declared before the modules that read it are imported. `vi.mock` is hoisted
// above these imports by the transform, so the order here is cosmetic — but the holder it reads
// is a `globalThis` slot rather than a module-level binding precisely because hoisting would
// otherwise run the factory before any `const` in this file exists.
vi.mock('../../src/core/battle/stages', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/battle/stages')>()
  const resolve = (stageId: number) => {
    const override = (globalThis as Record<string, unknown>).__TUNING1_STAGE__ as
      | { id: number }
      | undefined
    if (override && override.id === stageId) return override
    return actual.stageConfigOf(stageId as 1)
  }
  return {
    ...actual,
    stageConfigOf: resolve,
    stageOf: (state: { stageId: number }) => resolve(state.stageId),
  }
})

import { createBattle } from '../../src/core/battle/battle'
import {
  COMBAT_TICK_LIMIT,
  COMMANDER_MELEE_RANGE,
  COMMANDER_MOVE_SPEED,
  SHOOTER_STANDOFF_RATIO,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import { FORMATION_MAX_SLOT_RADIUS } from '../../src/core/battle/formation'
import { STAGES, stageConfigOf, type StageConfig, type StageId } from '../../src/core/battle/stages'
import { attackRangeOf } from '../../src/core/battle/targeting'
import type { BattleState, DamageCause } from '../../src/core/battle/types'
import { policyFactory, type PolicyId } from '../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS } from '../../src/core/harness/policy/run'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const STEP_BUDGET = COMBAT_TICK_LIMIT * 2
const OUT = process.env.TUNE_OUT ?? 'artifacts/tuning1-search.json'
const LOG = process.env.TUNE_LOG ?? 'artifacts/tuning1-search-log.jsonl'
const GRID = process.env.TUNE_GRID ?? ''

/** The four policies a candidate is screened on. The order is the order the table prints in. */
const SCREEN_POLICIES: readonly PolicyId[] = [
  'skilled',
  'flees-always',
  'tactical-no-input',
  'camps-in-place',
]

/** Everything §3 names, for a finalist. */
const FULL_POLICIES: readonly PolicyId[] = [
  'skilled',
  'flees-always',
  'tactical-no-input',
  'camps-in-place',
  'ignores-range',
  'abandons-downed',
  'skilled-conservative',
  'skilled-aggressive',
]

const WINDOW_EDGES = [0, 900, 1800] as const

function windowIndexOf(tick: number): number {
  if (tick >= WINDOW_EDGES[2]) return 2
  if (tick >= WINDOW_EDGES[1]) return 1
  return 0
}

function engagedEnemies(state: BattleState): number {
  let engaged = 0
  for (const enemy of state.enemies) {
    if (enemy.life !== 'standing') continue
    if (enemy.contactSlotOwnerId !== null) {
      engaged += 1
      continue
    }
    for (const unit of state.friendlies) {
      if (unit.life !== 'standing') continue
      const distance = Math.hypot(
        enemy.position.x - unit.position.x,
        enemy.position.y - unit.position.y,
      )
      if (distance <= attackRangeOf(state, unit)) {
        engaged += 1
        break
      }
    }
  }
  return engaged
}

/**
 * A candidate: a stage id plus the fields that differ from that stage's written row.
 *
 * A PATCH and not a whole row, so that a grid file says what it is moving. A grid entry that
 * respelled all thirty fields would hide its own axis.
 */
type Candidate = {
  readonly label: string
  readonly stageId?: StageId
  readonly patch: Record<string, unknown>
}

/** §2's search ranges, and §1's relations, checked on the candidate before it is played. */
function assertWithinSpec(stage: StageConfig): void {
  const fail = (message: string): never => {
    throw new Error(`tuning1: candidate out of the box — ${message}`)
  }
  const box = (name: keyof StageConfig, low: number, high: number): void => {
    const value = stage[name] as number
    if (!(value >= low && value <= high)) fail(`§2 puts ${String(name)} in [${low}, ${high}], got ${value}`)
  }

  // §2's table, row by row.
  box('meleeMoveSpeed', 0.125, 0.17)
  box('shooterRange', 3.0, 4.9)
  box('spawnRadius', 6, 18)
  box('engageRadius', 6, 18)
  box('absoluteEnemyCap', 40, 120)
  box('backlogSize', 6, 24)
  box('backlogDrainPerTick', 1, 4)

  // §1's relations, which `stages.ts` asserts at module load for the written table and which a
  // candidate never passes through.
  if (!(stage.shooterRange < SOLDIER_RANGE)) fail('shooterRange must be < SOLDIER_RANGE (§1.9)')
  if (!(stage.rangeAdvantage > 0)) fail('rangeAdvantage must be positive (§1.6)')
  if (!(stage.meleeMoveSpeed > COMMANDER_MOVE_SPEED))
    fail('meleeMoveSpeed must be > COMMANDER_MOVE_SPEED (§1.3)')
  if (!(COMMANDER_MELEE_RANGE < stage.shooterRange))
    fail('COMMANDER_MELEE_RANGE must be < shooterRange (§1.4.2)')
  if (!(stage.leashRadius > FORMATION_MAX_SLOT_RADIUS))
    fail('leashRadius must be > FORMATION_MAX_SLOT_RADIUS (§2)')
  if (!(stage.leashRadius < SOLDIER_RANGE + stage.engageRadius))
    fail('leashRadius must be < SOLDIER_RANGE + engageRadius (§2)')
  if (!(stage.eliteApproachRange < SOLDIER_RANGE))
    fail('eliteApproachRange must be < SOLDIER_RANGE (§1.12)')
  if (!(stage.spawnRadius >= stage.engageRadius + 2.0))
    fail('spawnRadius must be >= engageRadius + 2.0 (§1.10)')
  if (stage.pressurePhases.length === 0) fail('the pressure curve needs at least one phase (§1.10)')
  if (stage.pressurePhases[0].fromTick !== 0) fail('the first pressure phase starts at tick 0 (§1.10)')
  for (let index = 0; index < stage.pressurePhases.length; index += 1) {
    const phase = stage.pressurePhases[index]
    if (index > 0 && !(phase.fromTick > stage.pressurePhases[index - 1].fromTick))
      fail('pressure phases must start on strictly ascending ticks (§1.10)')
    if (!(phase.requestInterval >= 1)) fail('every pressure phase needs requestInterval >= 1 (§1.10)')
    if (!(phase.engagedCap >= 1)) fail('every pressure phase needs engagedCap >= 1 (§1.10)')
    const [melee, shooter] = phase.meleeToShooter
    if (!(melee >= 0 && shooter >= 0 && melee + shooter >= 1))
      fail('every melee:shooter ratio needs a positive total weight (§1.10)')
  }
  if (!(stage.arenaWidth > 0 && stage.arenaHeight > 0)) fail('the arena must have area (§1.1)')
}

/**
 * §2.3's RELATIONS, as `tests/battle/battle-stages.test.ts` pins them, checked with the candidate
 * standing in for its row and the other six exactly as written.
 *
 * WHY THIS IS PART OF THE SEARCH AND NOT AN AFTERTHOUGHT. This batch may move stage 1 and may not
 * move stages 2-7, and stage 2 is DEFINED as "stage 1's bodies arriving faster" — its fixture
 * asserts `meleeHp`, `shooterHp`, `shooterRange` and `meleeDamage` are equal to stage 1's, so those
 * four are not free knobs on stage 1 at all: moving one moves stage 2. The rest of the relations
 * box stage 1 from both sides in the same way. A candidate that breaks any of them is not a
 * solution to this batch — it is a solution to a different batch that is also allowed to edit six
 * other rows — so the search rejects it instead of reporting it, exactly as it rejects a value
 * outside §2's ranges.
 */
function assertTableRelations(stage: StageConfig): void {
  if (stage.id !== 1) return
  const fail = (message: string): never => {
    throw new Error(`tuning1: candidate breaks a §2.3 relation — ${message}`)
  }
  const others = STAGES.filter((row) => row.id !== 1)
  const shooterShare = (row: StageConfig, phase: number): number => {
    const [melee, shooter] = row.pressurePhases[phase].meleeToShooter
    return shooter / (melee + shooter)
  }
  const two = stageConfigOf(2)
  const three = stageConfigOf(3)
  const four = stageConfigOf(4)
  const five = stageConfigOf(5)
  const six = stageConfigOf(6)
  const seven = stageConfigOf(7)

  // 1 빨강 — the most melee-heavy opening in the table.
  for (const row of others) {
    if (!(shooterShare(row, 0) > shooterShare(stage, 0)))
      fail(`stage ${row.id} opens no less melee-heavy than stage 1`)
  }
  // 2 주황 — density is stage 2's ONLY axis, so the bodies are stage 1's bodies.
  for (let phase = 0; phase < stage.pressurePhases.length; phase += 1) {
    if (!(two.pressurePhases[phase].requestInterval < stage.pressurePhases[phase].requestInterval))
      fail(`stage 2's requestInterval is not below stage 1's in phase ${phase}`)
    if (!(two.pressurePhases[phase].engagedCap > stage.pressurePhases[phase].engagedCap))
      fail(`stage 2's engagedCap is not above stage 1's in phase ${phase}`)
  }
  if (!(two.absoluteEnemyCap > stage.absoluteEnemyCap)) fail("stage 2's absoluteEnemyCap is not above stage 1's")
  if (two.meleeHp !== stage.meleeHp) fail('stage 2 pins meleeHp to stage 1')
  if (two.shooterHp !== stage.shooterHp) fail('stage 2 pins shooterHp to stage 1')
  if (two.shooterRange !== stage.shooterRange) fail('stage 2 pins shooterRange to stage 1')
  if (two.meleeDamage !== stage.meleeDamage) fail('stage 2 pins meleeDamage to stage 1')
  // 3 노랑 — the weakest bodies and the highest caps.
  if (!(three.meleeHp < stage.meleeHp)) fail("stage 3's meleeHp is not below stage 1's")
  if (!(three.shooterHp < stage.shooterHp)) fail("stage 3's shooterHp is not below stage 1's")
  for (let phase = 0; phase < stage.pressurePhases.length; phase += 1) {
    if (!(three.pressurePhases[phase].engagedCap > stage.pressurePhases[phase].engagedCap))
      fail(`stage 3's engagedCap is not above stage 1's in phase ${phase}`)
  }
  // 4 초록 — the highest shooter share in every phase, and the smallest range advantage.
  for (let phase = 0; phase < stage.pressurePhases.length; phase += 1) {
    if (!(shooterShare(four, phase) > shooterShare(stage, phase)))
      fail(`stage 1 phase ${phase} is at least as shooter-heavy as stage 4`)
  }
  if (!(four.rangeAdvantage < stage.rangeAdvantage)) fail("stage 4's rangeAdvantage is not below stage 1's")
  // 5 파랑 — the board opens and the leash does not follow it.
  if (!(five.arenaWidth * five.arenaHeight > stage.arenaWidth * stage.arenaHeight))
    fail("stage 5's arena is not larger than stage 1's")
  if (!(five.leashRadius < stage.leashRadius)) fail("stage 5's leash is not below stage 1's")
  if (!(five.leashRadius / five.arenaWidth < stage.leashRadius / stage.arenaWidth))
    fail("stage 5's leash-to-arena ratio is not below stage 1's")
  // 6 남색 — the elite arrives sooner, warns for less time and covers more ground.
  if (!(six.eliteTelegraphTicks < stage.eliteTelegraphTicks)) fail("stage 6's telegraph is not below stage 1's")
  if (!(six.eliteCooldownTicks < stage.eliteCooldownTicks)) fail("stage 6's cooldown is not below stage 1's")
  if (!(six.eliteBlastRadius > stage.eliteBlastRadius)) fail("stage 6's blast is not above stage 1's")
  if (!(six.eliteSpawnTick <= stage.eliteSpawnTick)) fail("stage 6's elite does not arrive by stage 1's tick")
  // 7 보라 — the largest population and the toughest elite.
  if (!(seven.absoluteEnemyCap > stage.absoluteEnemyCap)) fail("stage 7's absoluteEnemyCap is not above stage 1's")
  if (!(seven.eliteHp > stage.eliteHp)) fail("stage 7's eliteHp is not above stage 1's")
  if (!(seven.eliteBlastRadius > stage.eliteBlastRadius)) fail("stage 7's blast is not above stage 1's")
  for (let phase = 0; phase < stage.pressurePhases.length; phase += 1) {
    if (!(seven.pressurePhases[phase].requestInterval < stage.pressurePhases[phase].requestInterval))
      fail(`stage 7's requestInterval is not below stage 1's in phase ${phase}`)
  }
  // The elite ramps every stage, so stage 1 sits below stage 2.
  if (!(two.eliteHp > stage.eliteHp)) fail("stage 2's eliteHp is not above stage 1's")
  // And no two rows may be equal.
  const shape = JSON.stringify({ ...stage, id: 0 })
  for (const row of others) {
    if (JSON.stringify({ ...row, id: 0 }) === shape) fail(`the candidate is stage ${row.id} under another number`)
  }
}

/** The two derived fields, exactly as `buildStage` computes them. */
function materialise(candidate: Candidate): StageConfig {
  // CLEAR THE OVERRIDE FIRST. `stageConfigOf` here is the MOCKED one, so with a previous
  // candidate still installed the base would be that candidate and every patch would compose with
  // every patch before it. The first version of this file did exactly that and the resulting grid
  // read as if `absoluteEnemyCap` and `backlogSize` did nothing — they were being measured on top
  // of a leaked pressure curve. A patch is a patch against the WRITTEN row, always.
  ;(globalThis as Record<string, unknown>).__TUNING1_STAGE__ = undefined
  const base = stageConfigOf(candidate.stageId ?? 1)
  const merged = { ...base, ...candidate.patch } as StageConfig
  const stage: StageConfig = {
    ...merged,
    shooterStandoff: [
      SHOOTER_STANDOFF_RATIO[0] * merged.shooterRange,
      SHOOTER_STANDOFF_RATIO[1] * merged.shooterRange,
    ],
    rangeAdvantage: SOLDIER_RANGE - merged.shooterRange,
  }
  assertWithinSpec(stage)
  assertTableRelations(stage)
  return stage
}

type Run = {
  policy: PolicyId
  seed: string
  won: boolean
  endTick: number
  rosterHp: number
  damageTaken: number
  damageTakenByWindow: [number, number, number]
  damageByCause: Record<string, number>
  longestIdleRun: number
  meanEngaged: number
  standing: number
}

function runOne(stage: StageConfig, policyId: PolicyId, seed: string): Run {
  ;(globalThis as Record<string, unknown>).__TUNING1_STAGE__ = stage
  const battle = createBattle(seed, { stageId: stage.id })
  const policy = policyFactory(policyId)(seed)
  battle.start()

  const rosterHp = battle.state().friendlies.reduce((total, unit) => total + unit.hp, 0)

  let damageTaken = 0
  const damageTakenByWindow: [number, number, number] = [0, 0, 0]
  const damageByCause: Record<string, number> = {}
  let longestIdleRun = 0
  let idleRun = 0
  let engagedTotal = 0
  let ticks = 0
  let steps = 0

  while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
    if (steps >= STEP_BUDGET) {
      throw new Error(
        `tuning1: ${policyId} on ${seed} did not decide in ${STEP_BUDGET} steps ` +
          `(mode ${battle.mode()}, tick ${battle.state().combatTick})`,
      )
    }
    for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
    const result = battle.step()
    if (result.ran) {
      const window = windowIndexOf(result.tick)
      for (const applied of result.damage.applied) {
        if (applied.event.side === 'friendly') continue
        damageTaken += applied.dealt
        damageTakenByWindow[window] += applied.dealt
        const cause = applied.event.cause as DamageCause
        damageByCause[cause] = (damageByCause[cause] ?? 0) + applied.dealt
      }
      const engaged = engagedEnemies(battle.state())
      engagedTotal += engaged
      ticks += 1
      if (engaged === 0) {
        idleRun += 1
        if (idleRun > longestIdleRun) longestIdleRun = idleRun
      } else idleRun = 0
    }
    steps += 1
  }

  const state = battle.state()
  return {
    policy: policyId,
    seed,
    won: state.mode === 'won',
    endTick: state.combatTick,
    rosterHp,
    damageTaken,
    damageTakenByWindow,
    damageByCause,
    longestIdleRun,
    meanEngaged: ticks === 0 ? 0 : engagedTotal / ticks,
    standing: state.friendlies.filter((unit) => unit.life === 'standing').length,
  }
}

type PolicySummary = {
  wins: number
  /** Which of the eight seeds were won, in `POLICY_BAND_SEEDS` order. A count hides WHICH one. */
  wonSeeds: string[]
  damageRatio: number
  windowRatios: [number, number, number]
  longestIdleRun: number
  meanEngaged: number
  meanEndTick: number
  shooterShare: number
}

function summarise(runs: readonly Run[]): PolicySummary {
  const rosterHp = runs.reduce((total, run) => total + run.rosterHp, 0)
  const taken = runs.reduce((total, run) => total + run.damageTaken, 0)
  const byWindow: [number, number, number] = [0, 0, 0]
  let shooter = 0
  for (const run of runs) {
    for (let index = 0; index < 3; index += 1) byWindow[index] += run.damageTakenByWindow[index]
    shooter += run.damageByCause['shooter-shot'] ?? 0
  }
  return {
    wins: runs.filter((run) => run.won).length,
    wonSeeds: runs.filter((run) => run.won).map((run) => run.seed),
    damageRatio: taken / rosterHp,
    windowRatios: [byWindow[0] / rosterHp, byWindow[1] / rosterHp, byWindow[2] / rosterHp],
    longestIdleRun: Math.max(...runs.map((run) => run.longestIdleRun)),
    meanEngaged: runs.reduce((total, run) => total + run.meanEngaged, 0) / runs.length,
    meanEndTick: runs.reduce((total, run) => total + run.endTick, 0) / runs.length,
    shooterShare: taken === 0 ? 0 : shooter / taken,
  }
}

type CandidateResult = {
  label: string
  stageId: number
  patch: Record<string, unknown>
  policies: Record<string, PolicySummary>
  /** The gates this batch is aimed at, each as a boolean beside the number that decided it. */
  verdict: Record<string, boolean>
  i4DamageGap: number | null
  elapsedMs: number
  /** Set when the candidate was outside §2's box and was therefore never played. */
  rejected?: string
}

function evaluate(candidate: Candidate, policies: readonly PolicyId[]): CandidateResult {
  const stage = materialise(candidate)
  const startedAt = Date.now()
  const byPolicy: Record<string, PolicySummary> = {}
  for (const policyId of policies) {
    byPolicy[policyId] = summarise(POLICY_BAND_SEEDS.map((seed) => runOne(stage, policyId, seed)))
  }
  const skilled = byPolicy['skilled']
  const ignores = byPolicy['ignores-range'] ?? null
  const verdict: Record<string, boolean> = {
    'skilled 8/8': skilled.wins === 8,
    I1: skilled.longestIdleRun < 60,
    I2: skilled.damageRatio >= 0.55 && skilled.damageRatio <= 0.8,
    'I2 windows': skilled.windowRatios.every((ratio) => ratio >= 0.1 && ratio <= 0.45),
    I3: (byPolicy['tactical-no-input']?.wins ?? -1) === 0,
    I8: (byPolicy['flees-always']?.wins ?? -1) === 0,
    I10: (byPolicy['camps-in-place']?.wins ?? 99) <= 2,
  }
  return {
    label: candidate.label,
    stageId: stage.id,
    patch: candidate.patch,
    policies: byPolicy,
    verdict,
    i4DamageGap: ignores === null ? null : ignores.damageRatio - skilled.damageRatio,
    elapsedMs: Date.now() - startedAt,
  }
}

function line(result: CandidateResult): string {
  const skilled = result.policies['skilled']
  const wins = (id: string) => result.policies[id]?.wins ?? '-'
  const pass = Object.entries(result.verdict)
    .filter(([, held]) => !held)
    .map(([name]) => name)
  return [
    result.label.padEnd(34),
    `sk ${wins('skilled')}/8`,
    `fl ${wins('flees-always')}/8`,
    `no ${wins('tactical-no-input')}/8`,
    `cp ${wins('camps-in-place')}/8`,
    `I2 ${skilled.damageRatio.toFixed(3)}`,
    `[${skilled.windowRatios.map((ratio) => ratio.toFixed(2)).join('/')}]`,
    `idle ${skilled.longestIdleRun}`,
    `eng ${skilled.meanEngaged.toFixed(1)}`,
    `shr ${(skilled.shooterShare * 100).toFixed(1)}%`,
    result.i4DamageGap === null ? 'I4 -' : `I4 ${result.i4DamageGap >= 0 ? '+' : ''}${result.i4DamageGap.toFixed(3)}`,
    pass.length === 0 ? 'ALL PASS' : `fail: ${pass.join(',')}`,
  ].join('  ')
}

/**
 * The grid. A JSON file at `TUNE_GRID` when there is one; otherwise the single row that is the
 * table as written, which makes a bare run of this file a reproduction of the baseline.
 */
function loadGrid(): { candidates: Candidate[]; policies: readonly PolicyId[] } {
  if (GRID === '') return { candidates: [{ label: 'baseline (as written)', patch: {} }], policies: SCREEN_POLICIES }
  const parsed = JSON.parse(readFileSync(GRID, 'utf8')) as {
    policies?: 'screen' | 'full' | PolicyId[]
    candidates: Candidate[]
  }
  const policies =
    parsed.policies === 'full'
      ? FULL_POLICIES
      : parsed.policies === undefined || parsed.policies === 'screen'
        ? SCREEN_POLICIES
        : parsed.policies
  return { candidates: parsed.candidates, policies }
}

describe('tuning 1 — the stage search', () => {
  it('plays every candidate on the eight-seed band', () => {
    const { candidates, policies } = loadGrid()
    const results: CandidateResult[] = []
    const startedAt = Date.now()

    for (const candidate of candidates) {
      // A candidate outside §2 is RECORDED as rejected rather than thrown, so that one bad point
      // does not discard the fifty good measurements beside it — and so that the log says which
      // points the box refused, which is part of the answer to "what did the search try".
      let result: CandidateResult
      try {
        result = evaluate(candidate, policies)
      } catch (error) {
        result = {
          label: candidate.label,
          stageId: candidate.stageId ?? 1,
          patch: candidate.patch,
          policies: {},
          verdict: {},
          i4DamageGap: null,
          elapsedMs: 0,
          rejected: error instanceof Error ? error.message : String(error),
        }
      }
      results.push(result)
      console.log(result.rejected ? `${result.label.padEnd(34)}  REJECTED  ${result.rejected}` : line(result))
    }

    const elapsedMs = Date.now() - startedAt
    expect(results.length).toBe(candidates.length)

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, `${JSON.stringify({ policies, elapsedMs, results }, null, 2)}\n`)
    // The log is append-only across invocations: it is the record of what the search TRIED, and a
    // search that overwrites its own history cannot be audited.
    const stamp = new Date().toISOString()
    const appended = results
      .map((result) => JSON.stringify({ at: stamp, grid: GRID, ...result }))
      .join('\n')
    writeFileSync(LOG, `${appended}\n`, { flag: 'a' })
    console.log(
      `[tuning1] ${results.length} candidates x ${policies.length} policies x ` +
        `${POLICY_BAND_SEEDS.length} seeds in ${(elapsedMs / 1000).toFixed(1)}s -> ${OUT}`,
    )
  })
})
