// I4 inversion diagnosis (§1.4.2 vs §3 I4) — a MEASUREMENT TOOL, not a regression test.
//
//   npx vitest run --config vitest.sweep.config.ts tests/sweeps/i4-melee-diagnosis.sweep.ts
//
// It asserts only that the runs happened and writes everything it saw to a JSON file
// (`I4_DIAG_OUT`, default `artifacts/i4-diagnosis.json`) so the same file can be run against a
// tree WITHOUT §1.4.2 (where `friendly-melee` simply never appears) and the two JSONs diffed.
//
// It changes no rule and no constant. Every number below is read off `TickResult`, which §1.16
// already hands to any driver.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import {
  COMMANDER_RANGE,
  MELEE_RANGE,
  SHOOTER_RANGE,
  SHOOTER_STANDOFF,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import {
  POLICY_IDS,
  SKILLED_MODEL_IDS,
  policyFactory,
  type PolicyId,
} from '../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS } from '../../src/core/harness/policy/run'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const ALL_POLICIES: readonly PolicyId[] = [...POLICY_IDS, ...SKILLED_MODEL_IDS]
const STEP_BUDGET = 5400

const OUT = process.env.I4_DIAG_OUT ?? 'artifacts/i4-diagnosis.json'
/**
 * §4.1's band is eight seeds. `I4_DIAG_EXTRA_SEEDS=N` appends N MORE seeds, which are not a
 * band and are not §4.1: they exist only to say how much of a one-seed win/loss flip is seed
 * noise. They are named deterministically so the two trees draw the same set.
 */
const EXTRA_SEEDS = Number(process.env.I4_DIAG_EXTRA_SEEDS ?? '0')
// `COMMANDER_MELEE_RANGE` does not exist in a tree without §1.4.2, so it is read defensively
// rather than imported: the same file has to load on both sides of the rule.
const MELEE_BAND = Number(process.env.I4_DIAG_MELEE_RANGE ?? '1.2')

type CauseTally = Record<string, { blows: number; dealt: number }>

function bump(tally: CauseTally, cause: string, dealt: number): void {
  const row = (tally[cause] ??= { blows: 0, dealt: 0 })
  row.blows += 1
  row.dealt += dealt
}

type RunRecord = {
  policy: PolicyId
  seed: string
  outcome: 'won' | 'lost'
  endTick: number
  kills: number
  standing: number
  digest: string
  /** Damage the friendlies DEALT, split by the cause that produced it. */
  friendlyOut: CauseTally
  /** Damage the friendlies TOOK, split by the cause that produced it. */
  friendlyIn: CauseTally
  /** Damage taken by whoever held command on the tick the blow landed. */
  commandIn: CauseTally
  /** Damage taken by the ORIGINAL commander body, whether or not it held command. */
  originalCommanderIn: CauseTally
  /** Ticks the command unit spent standing (denominator for every exposure number). */
  standingTicks: number
  /** Exposure histogram: standing ticks by distance from the command unit to the nearest enemy. */
  nearestBands: Record<string, number>
  /**
   * §1.9's shooter band has TWO edges. This histogram is over the distance from the command
   * unit to the NEAREST standing shooter, so "inside the lower edge" is visible as its own
   * bucket rather than folded into "close".
   */
  shooterBands: Record<string, number>
  /** Ticks with at least one standing enemy inside the melee band. */
  ticksWithEnemyInMeleeBand: number
  /** Sum over ticks of the number of standing enemies inside the melee band. */
  enemyInMeleeBandTickSum: number
  /** Ticks where at least one standing shooter had the command unit inside its firing band. */
  ticksUnderShooterFire: number
  /** Sum over ticks of the number of shooters with the command unit inside their firing band. */
  shootersOnCommandTickSum: number
  /** Ticks where at least one standing melee enemy was within its own contact range. */
  ticksInEnemyContact: number
  meleeContactTickSum: number
  /**
   * WHO the melee blows landed on, by enemy class.
   *
   * §1.4.2's claim is that the melee is bought by walking inside `SHOOTER_RANGE`. A swing that
   * lands on a `melee` enemy was not bought by anything: §1.3 makes that enemy FASTER than the
   * command unit, so it arrives on its own whatever the command unit does. This tally is what
   * separates the two.
   */
  meleeTargetKinds: Record<string, number>
  /** First tick a friendly-melee blow landed, and the total swing count. */
  firstMeleeTick: number | null
  commanderDeathTick: number | null
  commanderDownedCount: number
  upgradeTicks: number[]
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function drive(id: PolicyId, seed: string): RunRecord {
  const battle = createBattle(seed)
  const policy = policyFactory(id)(seed)
  battle.start()

  const record: RunRecord = {
    policy: id,
    seed,
    outcome: 'lost',
    endTick: 0,
    kills: 0,
    standing: 0,
    digest: '',
    friendlyOut: {},
    friendlyIn: {},
    commandIn: {},
    originalCommanderIn: {},
    standingTicks: 0,
    nearestBands: {
      'le-0.75': 0,
      'le-melee-band': 0,
      'le-standoff-high': 0,
      'le-shooter-range': 0,
      'le-soldier-range': 0,
      'gt-soldier-range': 0,
      'no-enemy': 0,
    },
    shooterBands: {
      'no-shooter': 0,
      'inside-standoff-low': 0,
      'in-firing-band': 0,
      'outside-band-le-soldier-range': 0,
      'beyond-soldier-range': 0,
    },
    ticksWithEnemyInMeleeBand: 0,
    enemyInMeleeBandTickSum: 0,
    ticksUnderShooterFire: 0,
    shootersOnCommandTickSum: 0,
    ticksInEnemyContact: 0,
    meleeContactTickSum: 0,
    meleeTargetKinds: { melee: 0, shooter: 0, elite: 0 },
    firstMeleeTick: null,
    commanderDeathTick: null,
    commanderDownedCount: 0,
    upgradeTicks: [],
  }

  let steps = 0
  let commanderWasDowned = false

  while (battle.mode() !== 'won' && battle.mode() !== 'lost' && steps < STEP_BUDGET) {
    const before = battle.state()
    // Succession (step 13) happens AFTER damage (step 11), so the holder at the top of the tick
    // is the body that took this tick's blows.
    const commandIdThisTick = before.commandUnitId
    const originalId = before.originalCommanderId

    for (const command of policy.decide(projectPolicyView(before))) battle.enqueue(command)
    const result = battle.step()

    if (result.ran) {
      for (const applied of result.damage.applied) {
        const { event, dealt } = applied
        if (event.side === 'friendly') {
          bump(record.friendlyOut, event.cause, dealt)
          if (event.cause === 'friendly-melee') {
            if (record.firstMeleeTick === null) record.firstMeleeTick = result.tick
            const victim = before.enemies.find((enemy) => enemy.id === event.targetId)
            if (victim) record.meleeTargetKinds[victim.kind] += 1
          }
        } else {
          bump(record.friendlyIn, event.cause, dealt)
          if (event.targetId === commandIdThisTick) bump(record.commandIn, event.cause, dealt)
          if (event.targetId === originalId) bump(record.originalCommanderIn, event.cause, dealt)
        }
      }

      // Exposure, sampled on the state AFTER the tick resolved (positions are this tick's).
      const state = battle.state()
      const holder = state.friendlies.find((unit) => unit.id === state.commandUnitId)
      if (holder && holder.life === 'standing') {
        record.standingTicks += 1
        let nearest = Infinity
        let nearestShooter = Infinity
        let inMeleeBand = 0
        let shootersOn = 0
        let contacts = 0
        for (const enemy of state.enemies) {
          if (enemy.life !== 'standing') continue
          const d = dist(enemy.position, holder.position)
          if (d < nearest) nearest = d
          if (enemy.kind === 'shooter' && d < nearestShooter) nearestShooter = d
          if (d <= MELEE_BAND) inMeleeBand += 1
          if (enemy.kind === 'melee' && d <= MELEE_RANGE) contacts += 1
          if (enemy.kind === 'shooter' && d >= SHOOTER_STANDOFF[0] && d <= SHOOTER_STANDOFF[1]) {
            shootersOn += 1
          }
        }
        if (nearest === Infinity) record.nearestBands['no-enemy'] += 1
        else if (nearest <= MELEE_RANGE) record.nearestBands['le-0.75'] += 1
        else if (nearest <= MELEE_BAND) record.nearestBands['le-melee-band'] += 1
        else if (nearest <= SHOOTER_STANDOFF[1]) record.nearestBands['le-standoff-high'] += 1
        else if (nearest <= SHOOTER_RANGE) record.nearestBands['le-shooter-range'] += 1
        else if (nearest <= SOLDIER_RANGE) record.nearestBands['le-soldier-range'] += 1
        else record.nearestBands['gt-soldier-range'] += 1

        if (nearestShooter === Infinity) record.shooterBands['no-shooter'] += 1
        else if (nearestShooter < SHOOTER_STANDOFF[0]) record.shooterBands['inside-standoff-low'] += 1
        else if (nearestShooter <= SHOOTER_STANDOFF[1]) record.shooterBands['in-firing-band'] += 1
        else if (nearestShooter <= SOLDIER_RANGE) {
          record.shooterBands['outside-band-le-soldier-range'] += 1
        } else record.shooterBands['beyond-soldier-range'] += 1

        if (inMeleeBand > 0) record.ticksWithEnemyInMeleeBand += 1
        record.enemyInMeleeBandTickSum += inMeleeBand
        if (shootersOn > 0) record.ticksUnderShooterFire += 1
        record.shootersOnCommandTickSum += shootersOn
        if (contacts > 0) record.ticksInEnemyContact += 1
        record.meleeContactTickSum += contacts
      }

      const commander = battle
        .state()
        .friendlies.find((unit) => unit.id === battle.state().originalCommanderId)
      if (commander) {
        if (commander.life === 'downed' && !commanderWasDowned) record.commanderDownedCount += 1
        commanderWasDowned = commander.life === 'downed'
        if (commander.deathTick !== null && record.commanderDeathTick === null) {
          record.commanderDeathTick = commander.deathTick
        }
      }
      if (result.accounting && result.accounting.openedRound !== null) {
        record.upgradeTicks.push(result.tick)
      }
    }
    steps += 1
  }

  const final = battle.state()
  record.outcome = final.mode === 'won' ? 'won' : 'lost'
  record.endTick = final.combatTick
  record.kills = final.stats.kills
  record.standing = final.friendlies.filter((unit) => unit.life === 'standing').length
  record.digest = battle.digest()
  return record
}

describe('I4 inversion diagnosis', () => {
  it('records the melee, the exposure and the outcome for every policy on every band seed', () => {
    const seeds = [
      ...POLICY_BAND_SEEDS,
      ...Array.from({ length: EXTRA_SEEDS }, (_, index) => `wide-${String(index).padStart(2, '0')}`),
    ]
    const runs: RunRecord[] = []
    for (const id of ALL_POLICIES) {
      for (const seed of seeds) runs.push(drive(id, seed))
    }

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(
      OUT,
      `${JSON.stringify(
        {
          constants: {
            COMMANDER_RANGE,
            SHOOTER_RANGE,
            SOLDIER_RANGE,
            MELEE_RANGE,
            SHOOTER_STANDOFF,
            MELEE_BAND,
          },
          runs,
        },
        null,
        1,
      )}\n`,
    )
    expect(runs.length).toBe(ALL_POLICIES.length * seeds.length)
  })
})
