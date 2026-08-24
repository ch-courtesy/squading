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
  CARD_POOL,
  MAX_CARD_LEVEL,
  MAX_UPGRADES_PER_STAGE,
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
 * §1.13 v2: what level every card stands at — the carry, plus what was taken in this stage.
 *
 * The campaign hands this straight back as the next stage's `carriedLevels`, so it is the whole
 * of the inheritance. Every card has an entry; see `UpgradeState.carriedLevels` for why the
 * zeroes are written down rather than left absent.
 */
export function upgradeCardLevels(state: Readonly<BattleState>): Record<CardId, number> {
  const levels = { ...state.upgrades.carriedLevels }
  for (const round of state.upgrades.rounds) {
    if (round.chosen !== null) levels[round.chosen] += 1
  }
  return levels
}

/**
 * §1.13 v2: how many levels of one card this squad holds. Zero if it has never taken it.
 *
 * v1's `hasUpgrade` was a predicate, and it could be, because a card left the pool when taken.
 * Every effect function below multiplies by this count now, so a card taken twice is twice the
 * card — which is what "레벨은 가산된다" means and the only reading that keeps `CARD_EFFECTS` a
 * table of one scalar per card.
 */
export function cardLevelOf(state: Readonly<BattleState>, card: CardId): number {
  let level = state.upgrades.carriedLevels[card]
  for (const round of state.upgrades.rounds) {
    if (round.chosen === card) level += 1
  }
  return level
}

/**
 * §1.13 v2: the cards a round may offer — everything not yet at `MAX_CARD_LEVEL`.
 *
 * This replaces v1's `remainingPool` FIELD. Under v1 "may be offered" was a fact of its own
 * (a card left the pool when it was taken); under v2 it is a function of the levels, and §1.17
 * says a function of other state is not state. The order is `CARD_POOL`'s, which is what makes
 * the partial Fisher-Yates below reproducible.
 */
export function offerableCards(state: Readonly<BattleState>): CardId[] {
  return CARD_POOL.filter((card) => cardLevelOf(state, card) < MAX_CARD_LEVEL)
}

/**
 * §1.13 v2: the kill count the thresholds are measured against — THIS STAGE's.
 *
 * v1 measured the campaign's cumulative kills, on the argument that per-stage thresholds would
 * let stage 1 eat every card. Measured, cumulative did the same thing for the same reason: stage
 * 1 alone kills 229~246 and the last threshold was 145. The cap that actually stops stage 1 from
 * eating everything is `MAX_UPGRADES_PER_STAGE`, not the choice of counter.
 */
export function upgradeKills(state: Readonly<BattleState>): number {
  return state.stats.kills
}

/**
 * §1.13 v2: the two shapes a level takes, and why they are not the same shape.
 *
 * An ADDITIVE card adds its scalar once per level: firepower I/II/III is +30/60/90%. That is the
 * reading §1.13 v2 states, and the one the player can do arithmetic on.
 *
 * A MULTIPLICATIVE card compounds instead: rapid is x0.85, x0.7225, x0.614. Adding a reduction
 * per level would walk it towards zero and past it — three levels of a `-35%` card is `-105%`,
 * which is a unit that heals when shot. Compounding cannot cross zero however many levels exist,
 * so the shape is chosen by what the card DOES, not by taste.
 */
function additive(level: number, perLevel: number): number {
  return 1 + perLevel * level
}

function compounded(level: number, perLevel: number): number {
  return perLevel ** level
}

/** §1.13 `화력`: +30% per level on the damage a friendly deals. */
export function firepowerMultiplierOf(state: Readonly<BattleState>): number {
  return additive(cardLevelOf(state, 'firepower'), CARD_EFFECTS.firepower)
}

/** §1.13 `사수`: +1.0 metre of weapon range per level. */
export function rangeBonusOf(state: Readonly<BattleState>): number {
  return CARD_EFFECTS.marksman * cardLevelOf(state, 'marksman')
}

/** §1.13 `연사`: x0.85 attack interval, compounded per level. */
export function attackIntervalMultiplierOf(state: Readonly<BattleState>): number {
  return compounded(cardLevelOf(state, 'rapid'), CARD_EFFECTS.rapid)
}

/** §1.13 `기동`: +15% move speed per level, for the body the player is driving. */
export function moveSpeedMultiplierOf(state: Readonly<BattleState>): number {
  return additive(cardLevelOf(state, 'mobility'), CARD_EFFECTS.mobility)
}

/** §1.13 `결속`: x1.2 on §1.2's follow-speed cap, compounded per level. */
export function followSpeedMultiplierOf(state: Readonly<BattleState>): number {
  return compounded(cardLevelOf(state, 'cohesion'), CARD_EFFECTS.cohesion)
}

/** §1.13 `응급`: x0.7 rescue duration, compounded per level. */
export function rescueTicksMultiplierOf(state: Readonly<BattleState>): number {
  return compounded(cardLevelOf(state, 'firstaid'), CARD_EFFECTS.firstaid)
}

/** §1.13 `차폐`: -35% damage TAKEN per level, compounded. Applied by the damage step. */
export function damageTakenMultiplierFromCards(state: Readonly<BattleState>): number {
  return compounded(cardLevelOf(state, 'cover'), 1 - CARD_EFFECTS.cover)
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
  // §1.13 v2: the candidates are everything below the level cap, derived rather than stored.
  const pool = offerableCards(state)
  // Fewer candidates than the offer wants is REACHABLE now and is not an error: with the cap at
  // three levels and eight cards there are 24 levels to hand out, and a campaign that reaches the
  // last of them offers what is left. v1 threw here because its pool could only shrink to five.
  const count = Math.min(CARDS_OFFERED_PER_ROUND, pool.length)

  const offered: CardId[] = []
  for (let index = 0; index < count; index += 1) {
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

  // §1.2.1 first, and BEFORE the cap: a debt is a round that already happened, so paying it back
  // must not be blocked by this stage's own budget — a stage that owed one and earned three would
  // otherwise silently drop the debt, which is the accident the rule exists to prevent.
  if (state.upgrades.owedRounds > 0) {
    state.upgrades.owedRounds -= 1
    return pushRound(state, index)
  }

  if (index >= MAX_UPGRADES_PER_STAGE) return null
  // §1.13 v2: THIS STAGE's kills, and the index starts at zero in every stage.
  if (upgradeKills(state) < UPGRADE_KILL_THRESHOLDS[index]) return null
  state.upgrades.nextThresholdIndex = index + 1
  return pushRound(state, index)
}

/**
 * Append a round and hand it back. The round NUMBER is the count of rounds this stage has opened,
 * not the threshold index — §1.2.1's debt opens a round that no threshold paid for, so the two
 * stopped being the same number the moment debts existed.
 */
function pushRound(state: BattleState, _thresholdIndex: number): UpgradeRound {
  const round: UpgradeRound = {
    round: state.upgrades.rounds.length + 1,
    // This step runs before the tick increment, so this is the tick the kill landed on — which
    // is what I6 ("강화 마지막 회차가 tick 2400 이전에") replays against.
    tick: state.combatTick,
    offered: drawOfferedCards(state),
    chosen: null,
  }
  state.upgrades.rounds.push(round)
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
  // §1.13 v2: nothing leaves a pool. The card goes up a level, and `offerableCards` stops
  // offering it once that level reaches the cap.
  if (card === 'vitality') applyVitality(state)
  if (state.mode === 'awaiting-upgrade') state.mode = 'running'
}
