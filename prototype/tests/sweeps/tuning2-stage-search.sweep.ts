// Tuning batch 2 (§5 stage 4) — THE SEARCH HARNESS FOR STAGES 2-7 AND THE RELAY.
//
//   TUNE2_GRID=artifacts/tuning2-grid.json \
//     npx vitest run --config vitest.sweep.config.ts tests/sweeps/tuning2-stage-search.sweep.ts
//
// WHAT THIS IS, AND WHY IT IS NOT `tuning1-stage-search.sweep.ts`
// ---------------------------------------------------------------------------
// Batch 1 searched ONE row (stage 1) against a table whose other six rows were fixed, and its
// relation guard is written that way: `assertTableRelations` returns immediately unless the
// candidate is stage 1, and it reads the other six rows out of the REAL table. Batch 2 has to move
// six rows AT ONCE — §2.3's relations are relations BETWEEN rows, so a candidate that moves stage 3
// and stage 7 has to be checked as a whole table or the guard checks a table nobody will adopt.
//
// So a candidate here is a TABLE PATCH: `{ "3": {...}, "7": {...} }`. Every patched row is
// range-checked against §2, every row of the resulting virtual table is checked against §1's
// relations, and the whole virtual table is checked against §2.3's relations exactly as
// `tests/battle/battle-stages.test.ts` pins them. A candidate that fails any of the three is
// RECORDED AS REJECTED and never played, because a number measured outside the box is a number
// that cannot be adopted.
//
// AND IT MEASURES THE OTHER BAND TOO. Batch 2's target is not only "is each stage hard" but "is
// the relay survivable" — §2.4's monotonicity is per-stage and the campaign band is the thing that
// makes seven stages a game. `campaign: true` on a grid plays `createCampaign` (the production
// facade) end to end under the same virtual table, so one candidate can be judged on both bands
// without the table ever being written to disk.
//
// IT CHANGES NO SOURCE FILE. The virtual table is injected by mocking `stageConfigOf`/`stageOf`,
// which is where every rule module and the campaign transition read their numbers from. Nothing
// here can leak into `npm test`: `.sweep.ts` is outside that include glob.
//
// WHAT IT DOES NOT DO: it does not pick. It writes numbers. The report argues.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// Hoisted above the imports below by the transform. The holder is a `globalThis` slot rather than
// a module-level binding for exactly that reason.
vi.mock('../../src/core/battle/stages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/battle/stages')>()
  const resolve = (stageId: number) => {
    const table = (globalThis as Record<string, unknown>).__TUNING2_TABLE__ as
      | Record<number, { id: number }>
      | undefined
    const override = table ? table[stageId] : undefined
    if (override) return override
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
import type { BattleState } from '../../src/core/battle/types'
import { createCampaign } from '../../src/core/campaign/campaign'
import { policyFactory, type PolicyId } from '../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS } from '../../src/core/harness/policy/run'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const STEP_BUDGET = COMBAT_TICK_LIMIT * 2
const OUT = process.env.TUNE2_OUT ?? 'artifacts/tuning2-search.json'
const LOG = process.env.TUNE2_LOG ?? 'artifacts/tuning2-search-log.jsonl'
const GRID = process.env.TUNE2_GRID ?? ''

/** The four policies a candidate is screened on — the ones §4's per-stage invariants read. */
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

/** I1's engaged set, character for character as `campaign2-stage-band.sweep.ts` spells it. */
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
 * A candidate: a patch per stage id. Stages not named keep the row as written.
 *
 * PATCHES and not whole rows, so a grid file says what it is moving.
 */
type Candidate = {
  readonly label: string
  readonly patches: Record<string, Record<string, unknown>>
  /**
   * DIAGNOSTIC ONLY. §2.3's relation guard is still evaluated, but a break is RECORDED on the
   * result instead of rejecting it, and the candidate is played anyway.
   *
   * This exists because "what does the relation cost" is a question the guard cannot answer by
   * refusing — batch 1's most useful finding was a measurement of what its own guard was hiding.
   * §2's ranges and §1's relations are NOT diagnosable: those are the rules, not the campaign's
   * shape. A row measured this way carries `relationBreaks` in the log and in `--log`'s `failed`
   * column, so it can never be read as an adoptable result.
   */
  readonly diagnostic?: boolean
}

/** §2's search ranges and §1's relations, on one row of the virtual table. */
function assertWithinSpec(stage: StageConfig): void {
  const fail = (message: string): never => {
    throw new Error(`tuning2: stage ${stage.id} out of the box — ${message}`)
  }
  const box = (name: keyof StageConfig, low: number, high: number): void => {
    const value = stage[name] as number
    if (!(value >= low && value <= high))
      fail(`§2 puts ${String(name)} in [${low}, ${high}], got ${value}`)
  }

  box('meleeMoveSpeed', 0.125, 0.17)
  box('shooterRange', 3.0, 4.9)
  box('spawnRadius', 6, 18)
  box('engageRadius', 6, 18)
  box('absoluteEnemyCap', 40, 120)
  box('backlogSize', 6, 24)
  box('backlogDrainPerTick', 1, 4)

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
  if (stage.pressurePhases[0].fromTick !== 0)
    fail('the first pressure phase starts at tick 0 (§1.10)')
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

const shooterShare = (row: StageConfig, phase: number): number => {
  const [melee, shooter] = row.pressurePhases[phase].meleeToShooter
  return shooter / (melee + shooter)
}

/**
 * §2.3's RELATIONS over the WHOLE virtual table, mirroring `tests/battle/battle-stages.test.ts`.
 *
 * Batch 1's version of this took one candidate row and read the other six from the real table.
 * This one takes the table, because batch 2 moves several rows at once and a relation between two
 * moved rows is exactly the thing the one-row form could not see.
 *
 * ONE RELATION DIFFERS FROM BATCH 1'S, DELIBERATELY: stage 4's range advantage. Batch 1's guard
 * required stage 4 to hold the SMALLEST `rangeAdvantage` in the table, which was v1 of the campaign
 * spec's prescription. §2.3 records that prescription as SELF-CANCELLING and replaces it — "격차는
 * 유지하거나 넓힌다" — so the relation here is that stage 4's gap is at least stage 1's, and the
 * fixture was changed to match in the same commit. See the batch report.
 */
function assertTableRelations(table: readonly StageConfig[]): void {
  const fail = (message: string): never => {
    throw new Error(`tuning2: the table breaks a §2.3 relation — ${message}`)
  }
  const byId = (id: number): StageConfig => {
    const row = table.find((entry) => entry.id === id)
    if (!row) throw new Error(`tuning2: no row ${id}`)
    return row
  }
  const one = byId(1)
  const two = byId(2)
  const three = byId(3)
  const four = byId(4)
  const five = byId(5)
  const six = byId(6)
  const seven = byId(7)
  const phases = one.pressurePhases.length

  // 1 빨강 — the most melee-heavy opening in the table.
  for (const row of table) {
    if (row.id === 1) continue
    if (!(shooterShare(row, 0) > shooterShare(one, 0)))
      fail(`stage ${row.id} opens no less melee-heavy than stage 1`)
  }
  // 2 주황 — density, and the bodies are stage 1's bodies.
  for (let phase = 0; phase < phases; phase += 1) {
    if (!(two.pressurePhases[phase].requestInterval < one.pressurePhases[phase].requestInterval))
      fail(`stage 2's requestInterval is not below stage 1's in phase ${phase}`)
    if (!(two.pressurePhases[phase].engagedCap > one.pressurePhases[phase].engagedCap))
      fail(`stage 2's engagedCap is not above stage 1's in phase ${phase}`)
  }
  if (!(two.absoluteEnemyCap > one.absoluteEnemyCap))
    fail("stage 2's absoluteEnemyCap is not above stage 1's")
  for (const field of [
    'meleeHp',
    'meleeMoveSpeed',
    'meleeRange',
    'meleeAttackInterval',
    'meleeDamage',
    'shooterHp',
    'shooterMoveSpeed',
    'shooterRange',
    'shooterAttackInterval',
    'shooterDamage',
    'spawnRadius',
    'engageRadius',
    'arenaWidth',
    'arenaHeight',
    'leashRadius',
  ] as const) {
    if (two[field] !== one[field]) fail(`stage 2 pins ${field} to stage 1`)
  }
  // 3 노랑 — the weakest bodies in the table, behind the highest caps (stage 7 exempt on caps).
  for (const row of table) {
    if (row.id === 3) continue
    if (!(three.meleeHp < row.meleeHp)) fail(`stage 3's meleeHp is not below stage ${row.id}'s`)
    if (!(three.shooterHp < row.shooterHp)) fail(`stage 3's shooterHp is not below stage ${row.id}'s`)
    if (row.id === 7) continue
    for (let phase = 0; phase < phases; phase += 1) {
      if (!(three.pressurePhases[phase].engagedCap > row.pressurePhases[phase].engagedCap))
        fail(`stage 3's engagedCap is not above stage ${row.id}'s in phase ${phase}`)
    }
  }
  // 4 초록 — the highest shooter share in the table in EVERY phase, and a range gap that is held
  // or widened against stage 1 (§2.3, corrected).
  for (let phase = 0; phase < phases; phase += 1) {
    for (const row of table) {
      if (row.id === 4) continue
      if (!(shooterShare(four, phase) > shooterShare(row, phase)))
        fail(`stage ${row.id} phase ${phase} is at least as shooter-heavy as stage 4`)
    }
  }
  if (!(four.rangeAdvantage >= one.rangeAdvantage))
    fail("stage 4's rangeAdvantage is below stage 1's (§2.3: 격차는 유지하거나 넓힌다)")
  // 5 파랑 — the board opens and the leash does not follow it.
  if (!(five.arenaWidth * five.arenaHeight > one.arenaWidth * one.arenaHeight))
    fail("stage 5's arena is not larger than stage 1's")
  if (!(five.leashRadius < one.leashRadius)) fail("stage 5's leash is not below stage 1's")
  if (!(five.leashRadius / five.arenaWidth < one.leashRadius / one.arenaWidth))
    fail("stage 5's leash-to-arena ratio is not below stage 1's")
  // 6 남색 — the elite arrives sooner, warns for less time and covers more ground.
  for (const row of table) {
    if (row.id >= 6) continue
    if (!(six.eliteTelegraphTicks < row.eliteTelegraphTicks))
      fail(`stage 6's telegraph is not below stage ${row.id}'s`)
    if (!(six.eliteCooldownTicks < row.eliteCooldownTicks))
      fail(`stage 6's cooldown is not below stage ${row.id}'s`)
    if (!(six.eliteBlastRadius > row.eliteBlastRadius))
      fail(`stage 6's blast is not above stage ${row.id}'s`)
    if (!(six.eliteSpawnTick <= row.eliteSpawnTick))
      fail(`stage 6's elite does not arrive by stage ${row.id}'s tick`)
  }
  // 7 보라 — the largest population and the toughest elite.
  for (const row of table) {
    if (row.id === 7) continue
    if (!(seven.absoluteEnemyCap > row.absoluteEnemyCap))
      fail(`stage 7's absoluteEnemyCap is not above stage ${row.id}'s`)
    if (!(seven.eliteHp > row.eliteHp)) fail(`stage 7's eliteHp is not above stage ${row.id}'s`)
    if (!(seven.eliteBlastRadius > row.eliteBlastRadius))
      fail(`stage 7's blast is not above stage ${row.id}'s`)
    for (let phase = 0; phase < phases; phase += 1) {
      if (!(seven.pressurePhases[phase].requestInterval < row.pressurePhases[phase].requestInterval))
        fail(`stage 7's requestInterval is not below stage ${row.id}'s in phase ${phase}`)
    }
  }
  // The elite ramps every stage.
  for (let index = 1; index < table.length; index += 1) {
    if (!(table[index].eliteHp > table[index - 1].eliteHp))
      fail(`stage ${table[index].id}'s eliteHp is not above stage ${table[index - 1].id}'s`)
  }
  // And no two rows may be equal.
  const shapes = table.map((row) => JSON.stringify({ ...row, id: 0 }))
  if (new Set(shapes).size !== table.length) fail('two rows of the table are the same stage')
}

/** The virtual table, with the two derived fields computed exactly as `buildStage` computes them. */
function materialise(candidate: Candidate): StageConfig[] {
  // CLEAR THE OVERRIDE FIRST — `stageConfigOf` here is the MOCKED one, so a table left installed
  // by the previous candidate would become the base and every patch would compose with every patch
  // before it. Batch 1's harness recorded that defect; this is the same fix.
  ;(globalThis as Record<string, unknown>).__TUNING2_TABLE__ = undefined
  const table = STAGES.map((written) => {
    const patch = candidate.patches[String(written.id)]
    const base = stageConfigOf(written.id)
    const merged = { ...base, ...(patch ?? {}) } as StageConfig
    return {
      ...merged,
      shooterStandoff: [
        SHOOTER_STANDOFF_RATIO[0] * merged.shooterRange,
        SHOOTER_STANDOFF_RATIO[1] * merged.shooterRange,
      ] as readonly [number, number],
      rangeAdvantage: SOLDIER_RANGE - merged.shooterRange,
    }
  })
  for (const row of table) assertWithinSpec(row)
  if (candidate.diagnostic) {
    try {
      assertTableRelations(table)
    } catch (error) {
      relationBreak = error instanceof Error ? error.message : String(error)
    }
  } else assertTableRelations(table)
  return table
}

/** Set by `materialise` for a diagnostic candidate whose table breaks a §2.3 relation. */
let relationBreak: string | null = null

function install(table: readonly StageConfig[]): void {
  const byId: Record<number, StageConfig> = {}
  for (const row of table) byId[row.id] = row
  ;(globalThis as Record<string, unknown>).__TUNING2_TABLE__ = byId
}

type Run = {
  won: boolean
  endTick: number
  rosterHp: number
  damageTaken: number
  damageTakenByWindow: [number, number, number]
  shooterDamage: number
  longestIdleRun: number
  meanEngaged: number
  standing: number
  kills: number
}

function runOne(stageId: StageId, policyId: PolicyId, seed: string): Run {
  const battle = createBattle(seed, { stageId })
  const policy = policyFactory(policyId)(seed)
  battle.start()

  const rosterHp = battle.state().friendlies.reduce((total, unit) => total + unit.hp, 0)

  let damageTaken = 0
  let shooterDamage = 0
  const damageTakenByWindow: [number, number, number] = [0, 0, 0]
  let longestIdleRun = 0
  let idleRun = 0
  let engagedTotal = 0
  let ticks = 0
  let steps = 0

  while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
    if (steps >= STEP_BUDGET) {
      throw new Error(
        `tuning2: ${policyId} on ${seed} stage ${stageId} did not decide in ${STEP_BUDGET} steps ` +
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
        if (applied.event.cause === 'shooter-shot') shooterDamage += applied.dealt
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
    won: state.mode === 'won',
    endTick: state.combatTick,
    rosterHp,
    damageTaken,
    damageTakenByWindow,
    shooterDamage,
    longestIdleRun,
    meanEngaged: ticks === 0 ? 0 : engagedTotal / ticks,
    standing: state.friendlies.filter((unit) => unit.life === 'standing').length,
    kills: state.stats.kills,
  }
}

type PolicySummary = {
  wins: number
  wonSeeds: string[]
  damageRatio: number
  windowRatios: [number, number, number]
  longestIdleRun: number
  meanEngaged: number
  meanEndTick: number
  meanStanding: number
  meanKills: number
  shooterShare: number
}

function summarise(runs: readonly Run[], seeds: readonly string[]): PolicySummary {
  const rosterHp = runs.reduce((total, run) => total + run.rosterHp, 0)
  const taken = runs.reduce((total, run) => total + run.damageTaken, 0)
  const byWindow: [number, number, number] = [0, 0, 0]
  let shooter = 0
  for (const run of runs) {
    for (let index = 0; index < 3; index += 1) byWindow[index] += run.damageTakenByWindow[index]
    shooter += run.shooterDamage
  }
  return {
    wins: runs.filter((run) => run.won).length,
    wonSeeds: seeds.filter((_, index) => runs[index].won),
    damageRatio: taken / rosterHp,
    windowRatios: [byWindow[0] / rosterHp, byWindow[1] / rosterHp, byWindow[2] / rosterHp],
    longestIdleRun: Math.max(...runs.map((run) => run.longestIdleRun)),
    meanEngaged: runs.reduce((total, run) => total + run.meanEngaged, 0) / runs.length,
    meanEndTick: runs.reduce((total, run) => total + run.endTick, 0) / runs.length,
    meanStanding: runs.reduce((total, run) => total + run.standing, 0) / runs.length,
    meanKills: runs.reduce((total, run) => total + run.kills, 0) / runs.length,
    shooterShare: taken === 0 ? 0 : shooter / taken,
  }
}

type StageReport = {
  stageId: number
  policies: Record<string, PolicySummary>
  verdict: Record<string, boolean>
  i4DamageGap: number | null
}

function measureStage(stageId: StageId, policies: readonly PolicyId[]): StageReport {
  const byPolicy: Record<string, PolicySummary> = {}
  for (const policyId of policies) {
    byPolicy[policyId] = summarise(
      POLICY_BAND_SEEDS.map((seed) => runOne(stageId, policyId, seed)),
      POLICY_BAND_SEEDS,
    )
  }
  const skilled = byPolicy['skilled']
  const ignores = byPolicy['ignores-range'] ?? null
  return {
    stageId,
    policies: byPolicy,
    verdict: {
      I1: skilled.longestIdleRun < 60,
      // §3's relaxed ceiling: the first step of the relaxation order (80% -> 85%) was taken by
      // batch 1 for stage 1 and every stage is measured against the same ceiling.
      I2: skilled.damageRatio >= 0.55 && skilled.damageRatio <= 0.85,
      'I2 strict': skilled.damageRatio >= 0.55 && skilled.damageRatio <= 0.8,
      'I2 windows': skilled.windowRatios.every((ratio) => ratio >= 0.1 && ratio <= 0.45),
      I3: (byPolicy['tactical-no-input']?.wins ?? -1) === 0,
      I8: (byPolicy['flees-always']?.wins ?? -1) === 0,
      I10: (byPolicy['camps-in-place']?.wins ?? 99) <= 2,
    },
    i4DamageGap: ignores === null ? null : ignores.damageRatio - skilled.damageRatio,
  }
}

type CampaignSummary = {
  policy: string
  /** How many of the eight root seeds finished all seven stages. */
  completed: number
  /** Per seed, the highest stage id the campaign CLEARED (0 = died on stage 1). */
  clearedBySeed: number[]
  /** How many campaigns died on each stage. */
  diedOnStage: Record<string, number>
  meanFinalSurvivors: number
  /**
   * One row per stage actually PLAYED, over all eight root seeds.
   *
   * The relay's whole question is what the squad is carrying when it arrives, and a `cleared`
   * count cannot answer it: "died on stage 3" is a different fact when the squad entered with
   * fourteen bodies than when it entered with two, and only one of the two is the stage's fault.
   */
  legs: {
    stageId: number
    played: number
    won: number
    meanEntered: number
    meanStanding: number
    meanEndTick: number
    /** Fraction of the ENTERING squad's current hp that came off during the stage. */
    meanDamageRatio: number
  }[]
}

function measureCampaign(policyId: PolicyId): CampaignSummary {
  const clearedBySeed: number[] = []
  const diedOnStage: Record<string, number> = {}
  const legs = new Map<
    number,
    { played: number; won: number; entered: number; standing: number; endTick: number; ratio: number }
  >()
  let completed = 0
  let survivors = 0

  for (const rootSeed of POLICY_BAND_SEEDS) {
    const campaign = createCampaign(rootSeed)
    let cleared = 0
    for (;;) {
      const battle = campaign.battle()
      const stageId = campaign.state().stageId
      const policy = policyFactory(policyId)(`${rootSeed}:stage:${stageId}`)
      battle.start()
      const entered = battle.state().friendlies.length
      const enteringHp = battle.state().friendlies.reduce((total, unit) => total + unit.hp, 0)
      let taken = 0
      let steps = 0
      while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
        if (steps >= STEP_BUDGET) {
          throw new Error(
            `tuning2/campaign: ${policyId} on ${rootSeed} stage ${stageId} did not decide in ` +
              `${STEP_BUDGET} steps (mode ${battle.mode()})`,
          )
        }
        for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
        const result = battle.step()
        if (result.ran) {
          for (const applied of result.damage.applied) {
            if (applied.event.side !== 'friendly') taken += applied.dealt
          }
        }
        steps += 1
      }
      const ended = battle.state()
      const won = ended.mode === 'won'
      const leg = legs.get(stageId) ?? { played: 0, won: 0, entered: 0, standing: 0, endTick: 0, ratio: 0 }
      leg.played += 1
      leg.won += won ? 1 : 0
      leg.entered += entered
      leg.standing += ended.friendlies.filter((unit) => unit.life === 'standing').length
      leg.endTick += ended.combatTick
      leg.ratio += enteringHp === 0 ? 0 : taken / enteringHp
      legs.set(stageId, leg)
      campaign.finishStage()
      if (won) cleared = stageId
      else diedOnStage[String(stageId)] = (diedOnStage[String(stageId)] ?? 0) + 1
      if (campaign.state().phase !== 'stage-cleared') break
      campaign.advance()
    }
    const final = campaign.state()
    if (final.end === 'complete') completed += 1
    survivors += final.squad ? final.squad.members.length : 0
    clearedBySeed.push(cleared)
  }

  return {
    policy: policyId,
    completed,
    clearedBySeed,
    diedOnStage,
    meanFinalSurvivors: survivors / POLICY_BAND_SEEDS.length,
    legs: [...legs.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([stageId, leg]) => ({
        stageId,
        played: leg.played,
        won: leg.won,
        meanEntered: leg.entered / leg.played,
        meanStanding: leg.standing / leg.played,
        meanEndTick: leg.endTick / leg.played,
        meanDamageRatio: leg.ratio / leg.played,
      })),
  }
}

type CandidateResult = {
  label: string
  patches: Record<string, Record<string, unknown>>
  stages: StageReport[]
  campaigns: CampaignSummary[]
  elapsedMs: number
  rejected?: string
  /** Set only on a `diagnostic` candidate: the §2.3 relation the played table broke. */
  relationBreaks?: string
}

type Grid = {
  policies?: 'screen' | 'full' | PolicyId[]
  /** Which stages to run the per-stage band on. Defaults to the stages the patch names. */
  stages?: number[]
  /** Run the campaign band too, for these policies (`true` means `['skilled']`). */
  campaign?: boolean | PolicyId[]
  candidates: Candidate[]
}

function loadGrid(): Grid {
  if (GRID === '') return { candidates: [{ label: 'baseline (as written)', patches: {} }] }
  return JSON.parse(readFileSync(GRID, 'utf8')) as Grid
}

function policiesOf(grid: Grid): readonly PolicyId[] {
  if (grid.policies === 'full') return FULL_POLICIES
  if (grid.policies === undefined || grid.policies === 'screen') return SCREEN_POLICIES
  return grid.policies
}

function stagesOf(grid: Grid, candidate: Candidate): StageId[] {
  const named = grid.stages ?? Object.keys(candidate.patches).map(Number)
  return (named.length === 0 ? [1] : named) as StageId[]
}

function line(result: CandidateResult): string {
  if (result.rejected) return `${result.label.padEnd(38)}  REJECTED  ${result.rejected}`
  const parts = [(result.relationBreaks ? `DIAG ${result.label}` : result.label).padEnd(38)]
  for (const stage of result.stages) {
    const skilled = stage.policies['skilled']
    const wins = (id: string) => stage.policies[id]?.wins ?? '-'
    const failed = Object.entries(stage.verdict)
      .filter(([name, held]) => !held && name !== 'I2 strict')
      .map(([name]) => name)
    parts.push(
      `S${stage.stageId} sk ${wins('skilled')} fl ${wins('flees-always')} ` +
        `no ${wins('tactical-no-input')} cp ${wins('camps-in-place')} ` +
        `I2 ${skilled.damageRatio.toFixed(3)} [${skilled.windowRatios.map((r) => r.toFixed(2)).join('/')}] ` +
        `eng ${skilled.meanEngaged.toFixed(1)} end ${Math.round(skilled.meanEndTick)} ` +
        (stage.i4DamageGap === null ? '' : `I4 ${stage.i4DamageGap >= 0 ? '+' : ''}${stage.i4DamageGap.toFixed(3)} `) +
        (failed.length === 0 ? 'PASS' : `fail:${failed.join(',')}`),
    )
  }
  for (const campaign of result.campaigns) {
    parts.push(
      `CAMP ${campaign.policy} done ${campaign.completed}/8 cleared[${campaign.clearedBySeed.join('')}]`,
    )
  }
  return parts.join('  |  ')
}

describe('tuning 2 — the stage and campaign search', () => {
  it('plays every candidate table on the fixed eight-seed bands', () => {
    const grid = loadGrid()
    const policies = policiesOf(grid)
    const campaignPolicies: PolicyId[] =
      grid.campaign === true ? ['skilled'] : Array.isArray(grid.campaign) ? grid.campaign : []
    const results: CandidateResult[] = []
    const startedAt = Date.now()

    for (const candidate of grid.candidates) {
      const candidateStartedAt = Date.now()
      let result: CandidateResult
      try {
        relationBreak = null
        const table = materialise(candidate)
        install(table)
        const stages = stagesOf(grid, candidate).map((stageId) => measureStage(stageId, policies))
        const campaigns = campaignPolicies.map((policyId) => measureCampaign(policyId))
        result = {
          label: candidate.label,
          patches: candidate.patches,
          stages,
          campaigns,
          elapsedMs: Date.now() - candidateStartedAt,
          ...(relationBreak === null ? {} : { relationBreaks: relationBreak }),
        }
      } catch (error) {
        result = {
          label: candidate.label,
          patches: candidate.patches,
          stages: [],
          campaigns: [],
          elapsedMs: Date.now() - candidateStartedAt,
          rejected: error instanceof Error ? error.message : String(error),
        }
      }
      results.push(result)
      console.log(line(result))
    }

    const elapsedMs = Date.now() - startedAt
    expect(results.length).toBe(grid.candidates.length)

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, `${JSON.stringify({ policies, elapsedMs, results }, null, 2)}\n`)
    // Append-only: the log is the record of what the search TRIED, and a search that overwrites
    // its own history cannot be audited.
    const stamp = new Date().toISOString()
    writeFileSync(
      LOG,
      `${results.map((result) => JSON.stringify({ at: stamp, grid: GRID, ...result })).join('\n')}\n`,
      { flag: 'a' },
    )
    console.log(`[tuning2] ${results.length} candidates in ${(elapsedMs / 1000).toFixed(1)}s -> ${OUT}`)
  })
})
