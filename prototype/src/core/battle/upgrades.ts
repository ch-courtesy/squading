// §1.13 성장 — the kill accounting, the card round, and where a chosen card is read.
//
// ---------------------------------------------------------------------------
// WHERE CARD EFFECTS ARE READ FROM — the one decision batches E–G depend on
// ---------------------------------------------------------------------------
// `state.upgrades.rounds[].chosen` is the ONLY record of what the player took, and every
// effect is derived from it at the moment it is used, through `hasUpgrade(state, card)` and
// the seven multiplier functions below. There is no `state.upgrades.effects`, no cached
// multiplier and no per-unit modifier list.
//
// Two rules force that shape:
//
//   * §1.13: "HP 배율 필드는 존재하지 않는다." The spec bans the one field a naive
//     implementation would add, and the reason generalises — `types.ts`'s no-scratch rule
//     says a field belongs in `BattleState` only if a LATER tick reads it, and a multiplier
//     recomputable from `rounds` is not that. So batch D adds NO field to `BattleState`:
//     every digest recorded before it stays valid, and the key-set pins in
//     `tests/battle/battle-state.test.ts` do not move.
//     CAMPAIGN STAGE 1 ADDS ONE, `upgrades.carriedCards`, and it is the same argument reaching
//     the opposite answer rather than an exception to it: the cards taken in EARLIER STAGES are
//     not recomputable from anything this battle holds, because this battle has no round for
//     them. The multiplier is still not stored — `hasUpgrade` simply has two places to look.
//   * Each card is in the pool exactly once and only the chosen card leaves it, so a card
//     can be chosen at most once in a run. `hasUpgrade` is therefore a predicate, not a
//     count, and no effect has to define what stacking with itself would mean.
//
// The SEVEN landing points, each a single call, and each taking `state`. Five of them already
// took it before batch D; the last two are marked, because "it already took `state`" is only
// true of the five and an earlier version of this header claimed it of all of them while
// counting them as six:
//
//   firepower  `attackDamageOf`      (targeting.ts)
//   marksman   `attackRangeOf`       (targeting.ts)
//   rapid      `attackIntervalOf`    (targeting.ts)
//   mobility   `moveSpeedOf`         (movement.ts) — GAINED its `state` parameter in batch D
//   cohesion   `followSpeedOf`       (movement.ts) — CREATED by batch D
//   firstaid   `rescueTicksOf`       (rescue.ts)
//   cover      `damageTakenMultiplierOf` (damage.ts) — defender-side, and the one card whose
//              name survived §1.6: 차폐 is damage-taken reduction and never had anything to do
//              with terrain.
//
// `vitality` is the exception, and §1.13 makes it one: with no HP multiplier field it can only
// be a one-shot multiplication of `maxHp` and `hp` together, applied when the card is chosen
// (`applyVitality` below). Reading it as a multiplier at use time would need exactly the field
// the spec forbids.
//
// ---------------------------------------------------------------------------
// The round
// ---------------------------------------------------------------------------
// The accounting step counts §1.13's kills ("정예 처치는 처치 수에 포함하지 않는다"), compares
// them against `UPGRADE_KILL_THRESHOLDS`, and opens at most one round per tick. The 승패 판정
// then reads `pendingUpgradeRound` and puts the battle into `awaiting-upgrade` — which is why
// "a round is pending" is derived from `rounds` (a trailing entry with `chosen: null`) instead
// of being a flag: two sources for one fact is how a battle ends up paused with no card on
// screen.

import {
  CARDS_OFFERED_PER_ROUND,
  CARD_EFFECTS,
  MAX_UPGRADES,
  UPGRADE_KILL_THRESHOLDS,
  type CardId,
} from './constants'
import { nextStreamFloat } from './streams'
// TYPE-ONLY, deliberately: `transitions.ts` reaches `damage.ts` and `rescue.ts`, both of which
// read the cards from this module. A type import is erased at build time, so the seam cannot
// become a runtime import cycle.
import type { TransitionOutcome } from './transitions'
import type { BattleState, UpgradeRound } from './types'

/** What the accounting step hands back; a return value, never state (see `types.ts`). */
export type UpgradeAccounting = {
  /** Kills added to `stats.kills` this tick — §1.13 excludes the elite's death. */
  killsCounted: number
  /** The round this tick opened, or null. At most one per tick. */
  openedRound: UpgradeRound | null
}

/**
 * §1.13: the cards this squad holds, in the order it took them (§1.14's result screen lists them).
 *
 * Campaign §1.2 puts the earlier stages' cards in front of this stage's: they were taken first,
 * and the campaign screens read this list as the squad's history.
 */
export function chosenUpgradeCards(state: Readonly<BattleState>): CardId[] {
  const chosen: CardId[] = [...state.upgrades.carriedCards]
  for (const round of [...state.upgrades.rounds].sort((left, right) => left.round - right.round)) {
    if (round.chosen !== null) chosen.push(round.chosen)
  }
  return chosen
}

/**
 * Has this card been taken? The whole read side of §1.13, and of campaign §1.2.
 *
 * A predicate rather than a count: each card exists once in the pool and only the chosen one
 * leaves it, so no card can be taken twice — and §1.2 extends that from "한 판에 한 번" to "한
 * 캠페인에 한 번", which is why a card carried in from an earlier stage answers true here. That is
 * the whole of the inheritance: the effect functions below read this predicate, so a carried card
 * keeps working without anything being re-applied, and `drawOfferedCards` reads it too, so a
 * carried card is never offered again.
 */
export function hasUpgrade(state: Readonly<BattleState>, card: CardId): boolean {
  if (state.upgrades.carriedCards.includes(card)) return true
  for (const round of state.upgrades.rounds) {
    if (round.chosen === card) return true
  }
  return false
}

/**
 * §1.2: the kill count §1.13's thresholds are measured against — the CAMPAIGN's, not the stage's.
 *
 * "처치 임계 `[15, 45, 90, 145]`는 캠페인 누적 처치에 대해 적용한다. 스테이지마다 리셋하면
 * 스테이지 1에서 8장을 다 먹는다."
 */
export function campaignKills(state: Readonly<BattleState>): number {
  return state.stats.priorKills + state.stats.kills
}

/** §1.13 `화력`: +30% on the damage a friendly deals. */
export function firepowerMultiplierOf(state: Readonly<BattleState>): number {
  return hasUpgrade(state, 'firepower') ? 1 + CARD_EFFECTS.firepower : 1
}

/** §1.13 `사수`: +1.0 metre of weapon range. */
export function rangeBonusOf(state: Readonly<BattleState>): number {
  return hasUpgrade(state, 'marksman') ? CARD_EFFECTS.marksman : 0
}

/** §1.13 `연사`: x0.85 attack interval. */
export function attackIntervalMultiplierOf(state: Readonly<BattleState>): number {
  return hasUpgrade(state, 'rapid') ? CARD_EFFECTS.rapid : 1
}

/** §1.13 `기동`: +15% move speed for the body the player is driving. */
export function moveSpeedMultiplierOf(state: Readonly<BattleState>): number {
  return hasUpgrade(state, 'mobility') ? 1 + CARD_EFFECTS.mobility : 1
}

/** §1.13 `결속`: x1.2 on §1.2's follow-speed cap. */
export function followSpeedMultiplierOf(state: Readonly<BattleState>): number {
  return hasUpgrade(state, 'cohesion') ? CARD_EFFECTS.cohesion : 1
}

/** §1.13 `응급`: x0.7 rescue duration. */
export function rescueTicksMultiplierOf(state: Readonly<BattleState>): number {
  return hasUpgrade(state, 'firstaid') ? CARD_EFFECTS.firstaid : 1
}

/** §1.13 `차폐`: -35% damage TAKEN. Applied by the damage step, which owns defender-side. */
export function damageTakenMultiplierFromCards(state: Readonly<BattleState>): number {
  return hasUpgrade(state, 'cover') ? 1 - CARD_EFFECTS.cover : 1
}

/**
 * A duration in ticks, after a multiplier.
 *
 * Rounded to a whole tick because both durations it serves — the attack cooldown and the
 * rescue progress — are counted down one per tick. A fractional interval would leave a
 * negative remainder (`0.2 - 1`) sitting in the digest and make "how many ticks does a shot
 * take" unanswerable from the number itself. Never below 1: a zero interval is a unit that
 * fires every tick.
 */
export function tickDurationAfter(base: number, multiplier: number): number {
  return Math.max(1, Math.round(base * multiplier))
}

/**
 * §1.13's `생존`, applied once: "생존은 `maxHp`와 `hp`를 함께 곱한다."
 *
 * Bodies that are already dead are left alone — the card strengthens the squad, not its
 * casualties — while a DOWNED body is scaled, because §1.11 revives it at
 * `maxHp x RESCUE_REVIVE_FRACTION` off the live maximum and the v1 review found exactly that
 * fraction taken against a stale base.
 */
function applyVitality(state: BattleState): void {
  const factor = CARD_EFFECTS.vitality
  for (const unit of state.friendlies) {
    if (unit.life === 'dead') continue
    unit.maxHp *= factor
    unit.hp *= factor
  }
}

/**
 * §1.13: "매 회차 남은 풀에서 partial Fisher-Yates 3회로 3장을 뽑는다(`cards` draw 정확히 3회)."
 *
 * Three iterations over a COPY of the pool, each swapping its pick into the front section — the
 * standard partial shuffle, and the reason exactly three draws are consumed no matter how big
 * the pool is. The pool itself is untouched here: §1.13 removes only the chosen card, so the
 * two cards that were shown and refused have to be offerable again.
 */
function drawOfferedCards(state: BattleState): CardId[] {
  // §1.2: a card the squad already holds is not offered again, and the pool is filtered rather
  // than emptied at construction — see `UpgradeState.carriedCards`. On a first stage the filter
  // removes NOTHING: every card this battle has handed out has already left the pool, so the array
  // below is `remainingPool` element for element, in the same order, and the partial Fisher-Yates
  // that follows draws exactly what it drew before this batch existed.
  const pool = state.upgrades.remainingPool.filter((card) => !hasUpgrade(state, card))
  if (pool.length < CARDS_OFFERED_PER_ROUND) {
    // Unreachable: 8 cards, at most 4 rounds, one card leaving per round, so the last round
    // still draws from 5. It throws rather than offering two, because an offer of the wrong
    // size would silently change the `cards` draw count and desynchronise every replay.
    throw new Error(
      `battle/upgrades: the pool holds ${pool.length} cards, fewer than the ${CARDS_OFFERED_PER_ROUND} §1.13 offers`,
    )
  }

  const offered: CardId[] = []
  for (let index = 0; index < CARDS_OFFERED_PER_ROUND; index += 1) {
    const pick = index + Math.floor(nextStreamFloat(state.prng, 'cards') * (pool.length - index))
    const swap = pool[index]
    pool[index] = pool[pick]
    pool[pick] = swap
    offered.push(pool[index])
  }
  return offered
}

/** §1.13: the round waiting for a choice, or null. Derived, so it cannot disagree. */
export function pendingUpgradeRound(state: Readonly<BattleState>): UpgradeRound | null {
  for (const round of state.upgrades.rounds) {
    if (round.chosen === null) return round
  }
  return null
}

/** True while §1.16's 승패 판정 should hold the battle in `awaiting-upgrade`. */
export function upgradeIsPending(state: Readonly<BattleState>): boolean {
  return pendingUpgradeRound(state) !== null
}

/**
 * The 처치 집계와 강화 임계 판정 step: count the kills, then open a round if one is due.
 *
 * §1.13 excludes the elite ("정예 처치는 처치 수에 포함하지 않는다"), which is why
 * `TransitionOutcome.enemyDeaths` carries the kind alongside the id and why the transition
 * step deliberately does not write `stats.kills` itself.
 *
 * At most ONE round opens per tick, and none while a round is still waiting for its card:
 * §1.13 caps a run at `MAX_UPGRADES` rounds and the battle pauses on each one, so a kill count
 * that vaults two thresholds in a single tick owes the player two rounds in sequence, not two
 * simultaneous card screens. The threshold index advances when the round OPENS, so the same
 * threshold cannot fire twice.
 */
export function resolveKillAccounting(
  state: BattleState,
  transitions: Readonly<TransitionOutcome>,
): UpgradeAccounting {
  let killsCounted = 0
  for (const death of transitions.enemyDeaths) {
    if (death.kind === 'elite') continue
    killsCounted += 1
  }
  state.stats.kills += killsCounted

  const openedRound = openUpgradeRoundIfDue(state)
  return { killsCounted, openedRound }
}

function openUpgradeRoundIfDue(state: BattleState): UpgradeRound | null {
  if (pendingUpgradeRound(state) !== null) return null
  const index = state.upgrades.nextThresholdIndex
  if (index >= MAX_UPGRADES) return null
  // §1.2: CAMPAIGN kills, not this stage's. Twenty kills carried in means the next card lands at
  // the 45 threshold, not at 15, and `nextThresholdIndex` was built from the same number.
  if (campaignKills(state) < UPGRADE_KILL_THRESHOLDS[index]) return null

  const round: UpgradeRound = {
    round: index + 1,
    // This step runs before the tick increment, so this is the tick the kill landed on — which
    // is what I6 ("강화 4회차가 tick 2400 이전에") replays against.
    tick: state.combatTick,
    offered: drawOfferedCards(state),
    chosen: null,
  }
  state.upgrades.rounds.push(round)
  state.upgrades.nextThresholdIndex = index + 1
  return round
}

/**
 * §1.13: take one of the three offered cards, and resume the battle.
 *
 * Only the chosen card leaves the pool. `vitality` is applied here for the reason in this
 * file's header; every other card is read at its point of use.
 *
 * The mode is returned to `running` only if it was `awaiting-upgrade`, so a choice that
 * arrives while the battle is paused (§1.15's `Escape`) does not un-pause it. Throwing on a
 * card that was not offered is deliberate: the input layer (§1.15) maps `1` `2` `3` onto
 * `offered`, and a mapping that has drifted must fail where it is wrong rather than hand out
 * a card the player never saw.
 */
export function chooseUpgradeCard(state: BattleState, card: CardId): void {
  const round = pendingUpgradeRound(state)
  if (!round) throw new Error('battle/upgrades: no upgrade round is waiting for a choice (§1.13)')
  if (!round.offered.includes(card)) {
    throw new Error(`battle/upgrades: ${card} was not offered in round ${round.round} (§1.13)`)
  }

  round.chosen = card
  state.upgrades.remainingPool = state.upgrades.remainingPool.filter((entry) => entry !== card)
  if (card === 'vitality') applyVitality(state)
  if (state.mode === 'awaiting-upgrade') state.mode = 'running'
}
