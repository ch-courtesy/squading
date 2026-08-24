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
  COMMANDER_MELEE_DAMAGE,
  COMMANDER_MELEE_INTERVAL,
  COMMANDER_MELEE_RANGE,
  COMMANDER_MOVE_SPEED,
  COMMANDER_RANGE,
  FOLLOW_MAX_SPEED,
  MAX_CARD_LEVEL,
  MAX_UPGRADES_PER_STAGE,
  RESCUE_REVIVE_FRACTION,
  RESCUE_TICKS,
  SOLDIER_ATTACK_INTERVAL,
  SOLDIER_DAMAGE,
  SOLDIER_MOVE_SPEED,
  SOLDIER_RANGE,
  UPGRADE_KILL_THRESHOLDS,
  type CardId,

  SOLDIER_HP,
} from '../../src/core/battle/constants'
import { stageConfigOf } from '../../src/core/battle/stages'
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
  RIFLEMAN_IDS,
  createEnemy,
  createInitialBattleState,
  findFriendly,
} from '../../src/core/battle/state'

/**
 * §1.2.1 split the squad; every fixture here that says "soldier" means a RIFLEMAN.
 *
 * Id 2 was the generic soldier because before the split there was only one kind. It now holds
 * §1.4's front rank, so it carries the skirmisher's reach, hp and damage — which is the class
 * these fixtures are not about.
 */
const RIFLE = RIFLEMAN_IDS[0]
import { createStreamStates, nextStreamFloat } from '../../src/core/battle/streams'
import {
  attackDamageOf,
  attackIntervalOf,
  attackRangeOf,
  meleeDamageOf,
  meleeIntervalOf,
  selectFriendlyTargetId,
} from '../../src/core/battle/targeting'
import type { TransitionOutcome } from '../../src/core/battle/transitions'
import {
  chooseUpgradeCard,
  cardLevelOf,
  offerableCards,
  upgradeCardLevels,
  pendingUpgradeRound,
  resolveKillAccounting,
} from '../../src/core/battle/upgrades'
import type { BattleState, FriendlyUnit } from '../../src/core/battle/types'

/**
 * The stage numbers this fixture pins, read off the one stage there is.
 *
 * Campaign stage 0 moved these out of `constants.ts` (§2.2's per-stage axes). Aliased back to
 * their old spellings so the assertions below are the same assertions, against the same values.
 */
const {
  eliteDamage: ELITE_DAMAGE,
} = stageConfigOf(1)

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

  it('offers three distinct cards out of the offerable set, every round', () => {
    const state = fixture()

    for (let round = 1; round <= MAX_UPGRADES_PER_STAGE; round += 1) {
      state.stats.kills = UPGRADE_KILL_THRESHOLDS[round - 1]
      resolveKillAccounting(state, deaths([{ id: 100 + round, kind: 'melee' }]))
      const pending = pendingUpgradeRound(state)
      expect(pending).not.toBeNull()
      const offered = pending!.offered
      expect(offered).toHaveLength(CARDS_OFFERED_PER_ROUND)
      expect(new Set(offered).size).toBe(CARDS_OFFERED_PER_ROUND)
      for (const card of offered) expect(offerableCards(state)).toContain(card)
      chooseUpgradeCard(state, offered[1])
    }

    // §1.13 v2: a chosen card does NOT leave — it goes up a level and stays offerable until the
    // level cap. Three rounds of a fresh squad cannot take anything to level 3, so every card in
    // the pool is still a candidate.
    expect(offerableCards(state)).toHaveLength(CARD_POOL.length)
  })

  it('raises the chosen card a level and leaves it offerable (§1.13 v2)', () => {
    // THE INVERSION. v1 asserted the chosen card LEFT the pool, because a card could be taken at
    // most once in a run. v2 stacks levels instead, so the same card being offerable again is the
    // rule rather than a leak — and the thing that must still be true is that ONE round raises ONE
    // level, on the card that was actually taken.
    const state = fixture()
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))
    const offered = [...state.upgrades.rounds[0].offered]

    chooseUpgradeCard(state, offered[1])

    expect(state.upgrades.rounds[0].chosen).toBe(offered[1])
    expect(cardLevelOf(state, offered[1])).toBe(1)
    // Still a candidate — one level short of the cap, not out of the pool.
    expect(offerableCards(state)).toContain(offered[1])
    // And the two that were shown and refused gained nothing. Without this the test would pass
    // for a rule that raised every offered card.
    expect(cardLevelOf(state, offered[0])).toBe(0)
    expect(cardLevelOf(state, offered[2])).toBe(0)
    expect(upgradeCardLevels(state)[offered[1]]).toBe(1)
  })

  it('stops offering a card once it reaches the level cap (§1.13 v2)', () => {
    // The other half of the level rule, and the one that keeps the offer honest: a card at the cap
    // is not a choice, so it must not take a slot on the screen.
    const state = fixture()
    state.upgrades.carriedLevels.firepower = MAX_CARD_LEVEL

    expect(offerableCards(state)).not.toContain('firepower')
    expect(offerableCards(state)).toHaveLength(CARD_POOL.length - 1)
    // One below the cap is still a choice — the boundary is closed on the right side only.
    state.upgrades.carriedLevels.firepower = MAX_CARD_LEVEL - 1
    expect(offerableCards(state)).toContain('firepower')
  })

  it('opens one round per tick even when the kill count jumps several thresholds', () => {
    const state = fixture()

    resolveKillAccounting(state, deaths([{ id: 101, kind: 'melee' }]))
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[MAX_UPGRADES_PER_STAGE - 1] + 500
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

  it('stops at the per-stage cap however far past the last threshold the kills run', () => {
    const state = fixture()

    // Ten ticks of a kill count far beyond every threshold, each with a choice taken.
    for (let tick = 0; tick < 10; tick += 1) {
      state.stats.kills = UPGRADE_KILL_THRESHOLDS[MAX_UPGRADES_PER_STAGE - 1] * 10
      resolveKillAccounting(state, deaths([{ id: 200 + tick, kind: 'melee' }]))
      const pending = pendingUpgradeRound(state)
      if (pending) chooseUpgradeCard(state, pending.offered[0])
    }

    expect(state.upgrades.rounds).toHaveLength(MAX_UPGRADES_PER_STAGE)
    expect(state.upgrades.rounds.map((round) => round.round)).toEqual([1, 2, 3])
    expect(state.upgrades.nextThresholdIndex).toBe(MAX_UPGRADES_PER_STAGE)
    // Three rounds, three levels handed out — and the cap is on ROUNDS, so it holds however the
    // levels landed. This is the assertion that would fail if the cap counted distinct cards.
    const levels = upgradeCardLevels(state)
    const total = CARD_POOL.reduce((sum, card) => sum + levels[card], 0)
    expect(total).toBe(MAX_UPGRADES_PER_STAGE)
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
    const soldier = unit(state, RIFLE)

    expect(Object.values(upgradeCardLevels(state))).toEqual(new Array(CARD_POOL.length).fill(0))
    expect(cardLevelOf(state, 'firepower')).toBe(0)
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
    // 31, NOT 29. §1.4.2 (batch N) gave the command unit a melee inside
    // `COMMANDER_MELEE_RANGE`, and at 29 this fixture stopped measuring `attackDamageOf` at all —
    // it measured `meleeDamageOf`, and read 0.65 where it asserts 0.26. Moving the body out to
    // 3.0 (still well inside `COMMANDER_RANGE` 6.0) puts the rifle back in its hands. The melee's
    // own composition with the same card is measured by its own fixture below.
    const state = withCards(fixture(), 'firepower')
    state.enemies.push(createEnemy(state, 101, 'melee', { x: 31, y: 16 }))
    const commander = unit(state, COMMANDER_ID)
    commander.targetId = 101

    expect(cardLevelOf(state, 'firepower')).toBe(1)
    expect(attackDamageOf(state, commander)).toBeCloseTo(0.26, 12)
    expect(attackDamageOf(state, unit(state, RIFLE))).toBeCloseTo(0.156, 12)

    const events = resolveFriendlyAttacks(state)
    expect(events[0].attackerId).toBe(COMMANDER_ID)
    expect(events[0].amount).toBeCloseTo(0.26, 12)
  })

  it('marksman adds a metre of range, which reaches a target the base range cannot', () => {
    const state = withCards(fixture(), 'marksman')
    const commander = unit(state, COMMANDER_ID)
    state.enemies.push(createEnemy(state, 101, 'melee', { x: 28 + 6.5, y: 16 }))

    expect(attackRangeOf(state, commander)).toBeCloseTo(COMMANDER_RANGE + 1, 12)
    expect(attackRangeOf(state, unit(state, RIFLE))).toBeCloseTo(SOLDIER_RANGE + 1, 12)
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
    expect(attackIntervalOf(state, unit(state, RIFLE))).toBe(10)
  })

  it('composes firepower and rapid with §1.4.2’s melee, and marksman deliberately not', () => {
    // A DECISION, PINNED, because §1.4.2 does not state it and `targeting.ts` had to choose.
    //   firepower / rapid — the melee upgrades exactly as the shot does, through the same two
    //     functions. Otherwise a fully upgraded rifle would eventually out-damage the swing that
    //     §1.4.2 requires to be the stronger of the two, and the trade would silently invert.
    //   marksman — deliberately NOT applied. It is §1.6's card: it widens the range advantage,
    //     and buying reach for the attack whose whole cost is being close would refund the trade.
    // 0.5 x 1.3 = 0.65, and 8 x 0.85 = 6.8 -> round 7.
    const boosted = withCards(fixture(), 'firepower', 'rapid')
    expect(meleeDamageOf(boosted)).toBeCloseTo(0.65, 12)
    expect(meleeIntervalOf(boosted)).toBe(7)

    const bare = fixture()
    expect(meleeDamageOf(bare)).toBe(COMMANDER_MELEE_DAMAGE)
    expect(meleeIntervalOf(bare)).toBe(COMMANDER_MELEE_INTERVAL)

    // The range card moves the rifle's reach and leaves the melee envelope alone; the two live
    // in the same file, so the difference has to be asserted rather than assumed.
    const reaching = withCards(fixture(), 'marksman')
    expect(attackRangeOf(reaching, unit(reaching, COMMANDER_ID))).toBeCloseTo(COMMANDER_RANGE + 1, 12)
    // A `shooter`, not a melee-class body: §1.4.2's v13 clause would refuse the swing on class
    // alone, and this line is about the RANGE card not reaching the melee envelope.
    reaching.enemies.push(createEnemy(reaching, 101, 'shooter', { x: 28 + COMMANDER_MELEE_RANGE + 0.01, y: 16 }))
    unit(reaching, COMMANDER_ID).targetId = 101
    expect(resolveFriendlyAttacks(reaching)[0]!.cause).toBe('friendly-attack')
  })

  it('firstaid shortens the rescue (x0.7, rounded to ticks)', () => {
    // Derived, not the literal 25 this used to hold. That number was `36 * 0.7` rounded, and it
    // named §1.11's lock length as much as it named the card's effect — so when v15 took the
    // lock to 20 it failed for a reason that had nothing to do with firstaid. The card's
    // contract is the multiplier and the rounding; the base belongs to §1.11.
    const state = withCards(fixture(), 'firstaid')
    expect(rescueTicksOf(state)).toBe(Math.round(RESCUE_TICKS * 0.7))
    // Non-vacuous: a multiplier of 1 would pass a bare "is a number" check.
    expect(rescueTicksOf(state)).toBeLessThan(RESCUE_TICKS)
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
    const follower = unit(state, RIFLE)
    follower.position = { x: follower.position.x - 1, y: follower.position.y }

    expect(followSpeedOf(state)).toBeCloseTo(0.156, 12)

    advanceFormationFollow(state)
    expect(follower.lastDisplacement).toBeCloseTo(0.156, 12)
  })

  it('vitality multiplies maxHp and hp together — there is no HP multiplier field', () => {
    const state = fixture()
    const commander = unit(state, COMMANDER_ID)
    commander.hp = 3.0
    const soldier = unit(state, RIFLE)
    // §1.2.1: another RIFLEMAN, because the assertion below names `SOLDIER_HP`. Id 3 holds the
    // front rank now and would carry the skirmisher's 2.6.
    const dead = unit(state, RIFLEMAN_IDS[1])
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
    expect(dead.maxHp).toBe(SOLDIER_HP)
    expect(dead.hp).toBe(0)
    // The state carries no multiplier — the numbers themselves moved. `carriedLevels` is not one
    // either: it counts ROUNDS taken in earlier stages, and `cardLevelOf` reads it exactly as it
    // reads `rounds[].chosen`.
    expect(Object.keys(state.upgrades).sort()).toEqual(
      ['rounds', 'nextThresholdIndex', 'carriedLevels', 'owedRounds'].sort(),
    )
  })

  it('leaves a rescue reviving at half of whatever vitality made the maximum', () => {
    const state = fixture()
    const fallen = unit(state, RIFLE)
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
    expect(cardLevelOf(state, 'firepower')).toBe(1)
    expect(cardLevelOf(state, 'marksman')).toBe(1)
  })

  it('adds a level rather than repeating it, for both shapes of card (§1.13 v2)', () => {
    // The v2 rule the whole redesign turns on, and the two shapes have to be measured separately
    // because they are not the same arithmetic. An ADDITIVE card adds its scalar per level; a
    // MULTIPLICATIVE one compounds, because three levels of a `-35%` card added would be `-105%`
    // — a unit that heals when it is shot.
    const state = withCards(fixture(), 'firepower', 'firepower', 'rapid', 'rapid')
    const commander = unit(state, COMMANDER_ID)

    expect(cardLevelOf(state, 'firepower')).toBe(2)
    // +30% per level: x1.6, not x1.69 and not x1.3.
    expect(attackDamageOf(state, commander)).toBeCloseTo(COMMANDER_DAMAGE * 1.6, 12)
    // x0.85 compounded: 0.7225, applied to the interval and rounded to whole ticks.
    expect(cardLevelOf(state, 'rapid')).toBe(2)
    expect(attackIntervalOf(state, commander)).toBe(
      Math.max(1, Math.round(COMMANDER_ATTACK_INTERVAL * 0.85 ** 2)),
    )
  })
})

/** The same board as the marksman fixture, minus the card. */
function fixtureWithEnemy(): BattleState {
  const state = fixture()
  state.enemies.push(createEnemy(state, 101, 'melee', { x: 28 + 6.5, y: 16 }))
  return state
}
