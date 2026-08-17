// Batch D fixtures, part 2: §1.13 성장 — kill accounting, the card round, and the effects.
//
// The numbers are hand-computed from §1.2's anchors and the placeholder magnitudes in
// `constants.ts`:
//
//   draws     `seed-a:cards` yields 0.555171, 0.475053, 0.580581. A partial Fisher-Yates over
//             the 8-card pool that swaps the pick into position `i` therefore takes index
//             `0 + floor(0.555171 x 8) = 4` (firstaid), `1 + floor(0.475053 x 7) = 4`
//             (firepower, swapped into place by the first pick) and
//             `2 + floor(0.580581 x 6) = 5` (cover). Round 1 of `seed-a` offers exactly
//             [firstaid, firepower, cover].
//   effects   firepower 0.20 -> 0.26 and 0.12 -> 0.156; marksman 6.0 -> 7.0 and 5.0 -> 6.0;
//             rapid 10 -> round(8.5) = 9 and 12 -> round(10.2) = 10; firstaid 36 ->
//             round(25.2) = 25; cover x0.65; mobility 0.115 -> 0.13225; cohesion 0.130 ->
//             0.156; vitality x1.25 on maxHp AND hp.

import { describe, expect, it } from 'vitest'

import {
  CARDS_OFFERED_PER_ROUND,
  CARD_POOL,
  COMBAT_TICK_LIMIT,
  COMMANDER_ATTACK_INTERVAL,
  COMMANDER_DAMAGE,
  COMMANDER_MOVE_SPEED,
  COMMANDER_RANGE,
  ELITE_DAMAGE,
  FOLLOW_MAX_SPEED,
  MAX_UPGRADES,
  RESCUE_REVIVE_FRACTION,
  RESCUE_TICKS,
  SOLDIER_ATTACK_INTERVAL,
  SOLDIER_DAMAGE,
  SOLDIER_MOVE_SPEED,
  SOLDIER_RANGE,
  UPGRADE_KILL_THRESHOLDS,
  type CardId,
} from '../../src/core/battle/constants'
import { resolveFriendlyAttacks } from '../../src/core/battle/attacks'
import { applyDamage, damageTakenMultiplierOf } from '../../src/core/battle/damage'
import { resolveBattleOutcome } from '../../src/core/battle/outcome'
import {
  advanceCommandUnit,
  advanceFormationFollow,
  followSpeedOf,
  moveSpeedOf,
} from '../../src/core/battle/movement'
import {
  advanceRescueProgress,
  rescueTicksOf,
  resolveRescueLock,
  NO_RESCUE_INPUT_EVENTS,
} from '../../src/core/battle/rescue'
import {
  COMMANDER_ID,
  ELITE_ID,
  createEnemy,
  createInitialBattleState,
  findFriendly,
} from '../../src/core/battle/state'
import { createStreamStates, nextStreamFloat } from '../../src/core/battle/streams'
import {
  attackDamageOf,
  attackIntervalOf,
  attackRangeOf,
  selectFriendlyTargetId,
} from '../../src/core/battle/targeting'
import type { TransitionOutcome } from '../../src/core/battle/transitions'
import {
  chooseUpgradeCard,
  chosenUpgradeCards,
  hasUpgrade,
  pendingUpgradeRound,
  resolveKillAccounting,
} from '../../src/core/battle/upgrades'
import type { BattleState, FriendlyUnit } from '../../src/core/battle/types'

function fixture(seed = 'seed-a', tick = 100): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'running'
  state.combatTick = tick
  return state
}

function unit(state: BattleState, id: number): FriendlyUnit {
  const found = findFriendly(state, id)
  if (!found) throw new Error(`fixture has no friendly ${id}`)
  return found
}

function deaths(enemyDeaths: TransitionOutcome['enemyDeaths'] = []): TransitionOutcome {
  return {
    enemyDeaths,
    friendlyDowns: [],
    friendlyDeaths: [],
    previousCommandUnitId: COMMANDER_ID,
    commandUnitId: COMMANDER_ID,
    commandUnitChanged: false,
    allUnitsLost: false,
  }
}

/** Take the named cards through the real choice path, one round each. */
function withCards(state: BattleState, ...cards: readonly CardId[]): BattleState {
  for (const card of cards) {
    state.upgrades.rounds.push({
      round: state.upgrades.rounds.length + 1,
      tick: state.combatTick,
      offered: [card],
      chosen: null,
    })
    chooseUpgradeCard(state, card)
  }
  return state
}

describe('§1.13 kill accounting', () => {
  it('counts every enemy death except the elite\'s', () => {
    const state = fixture()

    const accounting = resolveKillAccounting(
      state,
      deaths([
        { id: 101, kind: 'melee' },
        { id: 102, kind: 'shooter' },
        { id: ELITE_ID, kind: 'elite' },
      ]),
    )

    expect(state.stats.kills).toBe(2)
    expect(accounting.killsCounted).toBe(2)
    expect(accounting.openedRound).toBeNull()
  })

  it('never lets the elite kill alone move the counter', () => {
    const state = fixture()
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0] - 1

    resolveKillAccounting(state, deaths([{ id: ELITE_ID, kind: 'elite' }]))

    expect(state.stats.kills).toBe(UPGRADE_KILL_THRESHOLDS[0] - 1)
    expect(state.upgrades.rounds).toEqual([])
  })
})

describe('§1.13 the card round', () => {
  it('opens no round below the threshold and exactly one at it', () => {
    const state = fixture()
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0] - 2

    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))
    expect(state.upgrades.rounds).toEqual([])
    expect(state.upgrades.nextThresholdIndex).toBe(0)

    const accounting = resolveKillAccounting(state, deaths([{ id: 102, kind: 'melee' }]))
    expect(state.stats.kills).toBe(UPGRADE_KILL_THRESHOLDS[0])
    expect(state.upgrades.rounds).toHaveLength(1)
    expect(state.upgrades.nextThresholdIndex).toBe(1)
    expect(accounting.openedRound).toBe(state.upgrades.rounds[0])
    expect(state.upgrades.rounds[0].round).toBe(1)
    expect(state.upgrades.rounds[0].tick).toBe(100)
    expect(state.upgrades.rounds[0].chosen).toBeNull()
  })

  it('draws exactly three cards on the cards stream and nowhere else', () => {
    const state = fixture()
    const untouched = { ...state.prng }
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0] - 1

    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))

    const reference = createStreamStates('seed-a')
    for (let draw = 0; draw < CARDS_OFFERED_PER_ROUND; draw += 1) nextStreamFloat(reference, 'cards')
    // The stream state after N draws is unique to N, so this IS the draw count.
    expect(state.prng.cards).toBe(reference.cards)
    expect(state.prng.spawn).toBe(untouched.spawn)
    expect(state.prng.names).toBe(untouched.names)

    // Hand-computed above from `seed-a:cards`'s first three floats.
    expect(state.upgrades.rounds[0].offered).toEqual(['firstaid', 'firepower', 'cover'])
  })

  it('offers three distinct cards out of the remaining pool, every round', () => {
    const state = fixture()

    for (let round = 1; round <= MAX_UPGRADES; round += 1) {
      state.stats.kills = UPGRADE_KILL_THRESHOLDS[round - 1]
      resolveKillAccounting(state, deaths([{ id: 100 + round, kind: 'melee' }]))
      const pending = pendingUpgradeRound(state)
      expect(pending).not.toBeNull()
      const offered = pending!.offered
      expect(offered).toHaveLength(CARDS_OFFERED_PER_ROUND)
      expect(new Set(offered).size).toBe(CARDS_OFFERED_PER_ROUND)
      for (const card of offered) expect(state.upgrades.remainingPool).toContain(card)
      chooseUpgradeCard(state, offered[1])
    }

    // Four rounds off an 8-card pool with only the chosen card leaving: the last round still
    // draws from 5, so three draws are always available.
    expect(state.upgrades.remainingPool).toHaveLength(CARD_POOL.length - MAX_UPGRADES)
  })

  it('removes only the chosen card from the pool', () => {
    const state = fixture()
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))
    const offered = [...state.upgrades.rounds[0].offered]

    chooseUpgradeCard(state, offered[1])

    expect(state.upgrades.rounds[0].chosen).toBe(offered[1])
    expect(state.upgrades.remainingPool).toHaveLength(CARD_POOL.length - 1)
    expect(state.upgrades.remainingPool).not.toContain(offered[1])
    // The two cards that were shown and not taken are still in the pool for a later round.
    expect(state.upgrades.remainingPool).toContain(offered[0])
    expect(state.upgrades.remainingPool).toContain(offered[2])
    expect(chosenUpgradeCards(state)).toEqual([offered[1]])
  })

  it('opens one round per tick even when the kill count jumps several thresholds', () => {
    const state = fixture()

    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[MAX_UPGRADES - 1] + 500
    resolveKillAccounting(state, deaths([{ id: 102, kind: 'melee' }]))

    expect(state.upgrades.rounds).toHaveLength(1)
    expect(state.upgrades.nextThresholdIndex).toBe(1)
  })

  it('never opens a second round while one is still waiting for a choice', () => {
    const state = fixture()
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[1]
    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))
    expect(state.upgrades.rounds).toHaveLength(1)

    resolveKillAccounting(state, deaths([{ id: 102, kind: 'melee' }]))

    expect(state.upgrades.rounds).toHaveLength(1)
    expect(state.upgrades.nextThresholdIndex).toBe(1)
  })

  it('stops at four rounds however far past the last threshold the kills run', () => {
    const state = fixture()

    // Ten ticks of a kill count far beyond every threshold, each with a choice taken.
    for (let tick = 0; tick < 10; tick += 1) {
      state.stats.kills = UPGRADE_KILL_THRESHOLDS[MAX_UPGRADES - 1] * 10
      resolveKillAccounting(state, deaths([{ id: 200 + tick, kind: 'melee' }]))
      const pending = pendingUpgradeRound(state)
      if (pending) chooseUpgradeCard(state, pending.offered[0])
    }

    expect(state.upgrades.rounds).toHaveLength(MAX_UPGRADES)
    expect(state.upgrades.rounds.map((round) => round.round)).toEqual([1, 2, 3, 4])
    expect(state.upgrades.nextThresholdIndex).toBe(MAX_UPGRADES)
    expect(state.upgrades.remainingPool).toHaveLength(CARD_POOL.length - MAX_UPGRADES)
    expect(chosenUpgradeCards(state)).toHaveLength(MAX_UPGRADES)
  })

  it('is the same offer for the same seed and a different one for another', () => {
    const offerFor = (seed: string): readonly CardId[] => {
      const state = fixture(seed)
      state.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
      resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))
      return state.upgrades.rounds[0].offered
    }

    expect(offerFor('seed-a')).toEqual(offerFor('seed-a'))
    expect(offerFor('seed-b')).not.toEqual(offerFor('seed-a'))
  })

  it('refuses a card that was not offered, and a second choice for the same round', () => {
    const state = fixture()
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))
    const offered = [...state.upgrades.rounds[0].offered]
    const notOffered = CARD_POOL.find((card) => !offered.includes(card))!

    expect(() => chooseUpgradeCard(state, notOffered)).toThrow()
    chooseUpgradeCard(state, offered[0])
    expect(() => chooseUpgradeCard(state, offered[1])).toThrow()
  })

  it('refuses a choice when no round is waiting', () => {
    const state = fixture()
    expect(() => chooseUpgradeCard(state, 'firepower')).toThrow()
  })
})

describe('§1.13 / §1.16 the battle waits in awaiting-upgrade for the choice', () => {
  it('enters awaiting-upgrade while a round is pending and resumes on the choice', () => {
    const state = fixture()
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))

    resolveBattleOutcome(state, deaths())
    expect(state.mode).toBe('awaiting-upgrade')
    expect(state.result).toBeNull()

    chooseUpgradeCard(state, state.upgrades.rounds[0].offered[0])
    expect(state.mode).toBe('running')
  })

  it('ranks won and lost above awaiting-upgrade (§1.16)', () => {
    const won = fixture()
    won.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
    resolveKillAccounting(won, deaths([{ id: 101, kind: 'melee' }]))
    resolveBattleOutcome(won, deaths([{ id: ELITE_ID, kind: 'elite' }]))
    expect(won.mode).toBe('won')

    const lost = fixture('seed-a', COMBAT_TICK_LIMIT)
    lost.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
    resolveKillAccounting(lost, deaths([{ id: 101, kind: 'melee' }]))
    resolveBattleOutcome(lost, deaths())
    expect(lost.mode).toBe('lost')
    expect(lost.failureReason).toBe('elite-survived')
    // The round is still on the record either way — §1.14's result screen lists it.
    expect(lost.upgrades.rounds).toHaveLength(1)
  })
})

describe('§1.13 card effects, read off the chosen cards', () => {
  it('changes nothing until a card is chosen', () => {
    const state = fixture()
    const commander = unit(state, COMMANDER_ID)
    const soldier = unit(state, 2)

    expect(chosenUpgradeCards(state)).toEqual([])
    expect(hasUpgrade(state, 'firepower')).toBe(false)
    expect(attackDamageOf(state, commander)).toBe(COMMANDER_DAMAGE)
    expect(attackDamageOf(state, soldier)).toBe(SOLDIER_DAMAGE)
    expect(attackRangeOf(state, commander)).toBe(COMMANDER_RANGE)
    expect(attackRangeOf(state, soldier)).toBe(SOLDIER_RANGE)
    expect(attackIntervalOf(state, commander)).toBe(COMMANDER_ATTACK_INTERVAL)
    expect(attackIntervalOf(state, soldier)).toBe(SOLDIER_ATTACK_INTERVAL)
    expect(rescueTicksOf(state)).toBe(RESCUE_TICKS)
    expect(damageTakenMultiplierOf(state, commander)).toBe(1)
    expect(moveSpeedOf(state, commander)).toBe(COMMANDER_MOVE_SPEED)
    expect(moveSpeedOf(state, soldier)).toBe(SOLDIER_MOVE_SPEED)
    expect(followSpeedOf(state)).toBe(FOLLOW_MAX_SPEED)
  })

  it('firepower scales the damage a friendly deals (+30%)', () => {
    const state = withCards(fixture(), 'firepower')
    state.enemies.push(createEnemy(101, 'melee', { x: 29, y: 16 }))
    const commander = unit(state, COMMANDER_ID)
    commander.targetId = 101

    expect(hasUpgrade(state, 'firepower')).toBe(true)
    expect(attackDamageOf(state, commander)).toBeCloseTo(0.26, 12)
    expect(attackDamageOf(state, unit(state, 2))).toBeCloseTo(0.156, 12)

    const events = resolveFriendlyAttacks(state)
    expect(events[0].attackerId).toBe(COMMANDER_ID)
    expect(events[0].amount).toBeCloseTo(0.26, 12)
  })

  it('marksman adds a metre of range, which reaches a target the base range cannot', () => {
    const state = withCards(fixture(), 'marksman')
    const commander = unit(state, COMMANDER_ID)
    state.enemies.push(createEnemy(101, 'melee', { x: 28 + 6.5, y: 16 }))

    expect(attackRangeOf(state, commander)).toBeCloseTo(COMMANDER_RANGE + 1, 12)
    expect(attackRangeOf(state, unit(state, 2))).toBeCloseTo(SOLDIER_RANGE + 1, 12)
    expect(selectFriendlyTargetId(state, commander)).toBe(101)
    // Without the card the same enemy is out of reach.
    const bare = fixtureWithEnemy()
    expect(selectFriendlyTargetId(bare, unit(bare, COMMANDER_ID))).toBeNull()
  })

  it('rapid shortens the attack interval to whole ticks', () => {
    const state = withCards(fixture(), 'rapid')

    // 10 x 0.85 = 8.5 -> 9, and 12 x 0.85 = 10.2 -> 10. Whole ticks, because the cooldown is
    // counted down by 1 per tick and a fractional remainder would sit in the digest.
    expect(attackIntervalOf(state, unit(state, COMMANDER_ID))).toBe(9)
    expect(attackIntervalOf(state, unit(state, 2))).toBe(10)
  })

  it('firstaid shortens the rescue (x0.7, rounded to ticks)', () => {
    const state = withCards(fixture(), 'firstaid')
    expect(rescueTicksOf(state)).toBe(25)
  })

  it('cover reduces the damage a friendly takes by 35%', () => {
    const state = withCards(fixture(), 'cover')
    const commander = unit(state, COMMANDER_ID)

    expect(damageTakenMultiplierOf(state, commander)).toBeCloseTo(0.65, 12)

    const outcome = applyDamage(state, [
      {
        side: 'enemy',
        attackerId: ELITE_ID,
        targetId: COMMANDER_ID,
        amount: ELITE_DAMAGE,
        cause: 'elite-blast',
      },
    ])
    expect(outcome.damageToFriendlies).toBeCloseTo(ELITE_DAMAGE * 0.65, 12)
    expect(commander.hp).toBeCloseTo(commander.maxHp - ELITE_DAMAGE * 0.65, 12)
  })

  it('mobility speeds up the body the player is driving (+15%)', () => {
    const state = withCards(fixture(), 'mobility')
    const commander = unit(state, COMMANDER_ID)
    state.input.move = { x: 1, y: 0 }

    expect(moveSpeedOf(state, commander)).toBeCloseTo(0.13225, 12)

    const displacement = advanceCommandUnit(state)
    expect(displacement).toBeCloseTo(0.13225, 12)
    expect(commander.position.x).toBeCloseTo(28 + 0.13225, 12)
  })

  it('cohesion raises the follow speed cap (x1.2)', () => {
    const state = withCards(fixture(), 'cohesion')
    const follower = unit(state, 2)
    follower.position = { x: follower.position.x - 1, y: follower.position.y }

    expect(followSpeedOf(state)).toBeCloseTo(0.156, 12)

    advanceFormationFollow(state)
    expect(follower.lastDisplacement).toBeCloseTo(0.156, 12)
  })

  it('vitality multiplies maxHp and hp together — there is no HP multiplier field', () => {
    const state = fixture()
    const commander = unit(state, COMMANDER_ID)
    commander.hp = 3.0
    const soldier = unit(state, 2)
    const dead = unit(state, 3)
    dead.life = 'dead'
    dead.hp = 0
    dead.deathTick = 50

    withCards(state, 'vitality')

    expect(commander.maxHp).toBeCloseTo(6.25, 12)
    expect(commander.hp).toBeCloseTo(3.75, 12)
    expect(commander.hp / commander.maxHp).toBeCloseTo(0.6, 12)
    expect(soldier.maxHp).toBeCloseTo(1.75, 12)
    expect(soldier.hp).toBeCloseTo(1.75, 12)
    // A body that is already gone is not strengthened.
    expect(dead.maxHp).toBe(1.4)
    expect(dead.hp).toBe(0)
    // The state carries no multiplier — the numbers themselves moved.
    expect(Object.keys(state.upgrades).sort()).toEqual(
      ['remainingPool', 'rounds', 'nextThresholdIndex'].sort(),
    )
  })

  it('leaves a rescue reviving at half of whatever vitality made the maximum', () => {
    const state = fixture()
    const fallen = unit(state, 2)
    fallen.life = 'downed'
    fallen.hp = 0
    fallen.position = { x: 28.5, y: 16 }
    withCards(state, 'vitality')
    expect(fallen.maxHp).toBeCloseTo(1.75, 12)

    state.input.spaceHeld = true
    resolveRescueLock(state, NO_RESCUE_INPUT_EVENTS)
    expect(state.rescue.active).toBe(true)

    for (let tick = 0; tick < rescueTicksOf(state); tick += 1) {
      advanceRescueProgress(state, applyDamage(state, []))
    }

    expect(fallen.life).toBe('standing')
    expect(fallen.hp).toBeCloseTo(1.75 * RESCUE_REVIVE_FRACTION, 12)
  })

  it('stacks two cards without either one reaching into the other', () => {
    const state = withCards(fixture(), 'firepower', 'marksman')
    const commander = unit(state, COMMANDER_ID)

    expect(attackDamageOf(state, commander)).toBeCloseTo(0.26, 12)
    expect(attackRangeOf(state, commander)).toBeCloseTo(7, 12)
    expect(attackIntervalOf(state, commander)).toBe(COMMANDER_ATTACK_INTERVAL)
    expect(chosenUpgradeCards(state)).toEqual(['firepower', 'marksman'])
  })
})

/** The same board as the marksman fixture, minus the card. */
function fixtureWithEnemy(): BattleState {
  const state = fixture()
  state.enemies.push(createEnemy(101, 'melee', { x: 28 + 6.5, y: 16 }))
  return state
}
