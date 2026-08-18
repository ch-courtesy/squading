// What the v2 shell prints, as one display-only value (§6).
//
// The shell never reads `BattleState`. It reads this and `projectBattleSnapshot`, and it sends
// §1.15's public commands back. That is the whole of the module boundary v1 lost: a shell that
// reaches into the authority ends up with a second copy of the rules inside it, and the second
// copy is the one that drifts.
//
// THE STANDARD FOR A FIELD HERE IS THE SAME ONE `core/harness/policy/view.ts` sets for a policy:
// not "is it useful" but "is it on the screen". The difference is that this file is the thing
// that PUTS it on the screen, so the standard is discharged by `battle-shell.ts` actually
// printing every field below — `tests/app/battle-shell.test.ts` walks the rendered DOM for the
// ones that carry a rule.
//
// WHAT IS DELIBERATELY ABSENT: enemy hit points, of any kind, for the elite included. §1 names
// no enemy hp bar, v1 printed one, and `view.ts`'s absence list would become false the moment
// this file printed one. `battle-hud.test.ts` pins that.

import {
  CARD_EFFECTS,
  COMBAT_TICK_LIMIT,
  DOWNED_TICKS,
  type CardId,
} from '../battle/constants'
import { nameOf } from '../battle/names'
import { rescueCandidateId, rescueTicksOf } from '../battle/rescue'
import { friendliesById } from '../battle/state'
import { pendingUpgradeRound } from '../battle/upgrades'
import type {
  BattleMode,
  BattleResult,
  BattleState,
  FailureReason,
  FriendlyUnit,
  LifeState,
} from '../battle/types'
import { BATTLE_TICKS_PER_SECOND } from './snapshot'

/** One body, as the roster strip shows it. */
export type RosterEntryView = {
  id: number
  /** §1.14: the name the run gave this body, kept through death. */
  name: string
  /** True for the body §1.5 currently has command of. */
  isCommand: boolean
  life: LifeState
  hp: number
  maxHp: number
  /** The hp bar's fill. Both halves are on screen, which is what licenses `hp` and `maxHp`. */
  hp01: number
  /** §1.11's countdown, or 0 for a body that is not downed. */
  downedTicksRemaining: number
  /** §1.11: the body `Space` would pick up right now. */
  isRescueCandidate: boolean
}

export type UpgradeCardView = {
  /** 1-based, matching the `1` `2` `3` keys §1.15 names. */
  slot: number
  id: CardId
  name: string
  effect: string
}

/** §1.14's 전사자 명단. */
export type CasualtyView = { name: string; deathTick: number }

/** §1.14's 구조 기록 — "구조된 이름 ← 구조자 이름". */
export type RescueRecordView = { name: string; rescuers: readonly string[] }

export type RescueProgressView = {
  targetId: number
  targetName: string
  progress: number
  /** §1.13's `firstaid` can shorten this, so it is read and not assumed. */
  total: number
}

export type BattleHud = {
  tick: number
  mode: BattleMode
  result: BattleResult
  failureReason: FailureReason
  /** §1.1's 90 seconds, counted down, floored at zero. */
  secondsRemaining: number
  kills: number
  rescues: number
  command: RosterEntryView | null
  roster: readonly RosterEntryView[]
  standing: number
  downed: number
  dead: number
  rescue: RescueProgressView | null
  rescueCandidateId: number | null
  pendingUpgrade: { round: number; cards: readonly UpgradeCardView[] } | null
  chosenCards: readonly UpgradeCardView[]
  casualties: readonly CasualtyView[]
  rescueRecords: readonly RescueRecordView[]
  /** §1.14: whether the ORIGINAL commander is still standing, not whoever holds command. */
  commanderSurvived: boolean
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/**
 * §1.13's eight cards in Korean, with the MAGNITUDE read out of `CARD_EFFECTS`.
 *
 * The number is never written twice: a tuning pass that changes the constant changes the card
 * text with it, which is what stops the screen from advertising a bonus the game does not give.
 * `cover` is labelled 방호 rather than 엄폐 on purpose — §1.6 deleted cover from the design and a
 * card wearing its name would read as terrain coming back.
 */
export const UPGRADE_CARD_LABELS: Readonly<Record<CardId, { name: string; effect: string }>> = {
  firepower: { name: '화력', effect: `공격 피해 +${percent(CARD_EFFECTS.firepower)}` },
  mobility: { name: '기동', effect: `이동 속도 +${percent(CARD_EFFECTS.mobility)}` },
  vitality: { name: '체력', effect: `최대 체력 x${CARD_EFFECTS.vitality}` },
  marksman: { name: '사격술', effect: `사거리 +${CARD_EFFECTS.marksman}` },
  firstaid: { name: '응급처치', effect: `구조 시간 x${CARD_EFFECTS.firstaid}` },
  cover: { name: '방호', effect: `받는 피해 -${percent(CARD_EFFECTS.cover)}` },
  rapid: { name: '속사', effect: `공격 간격 x${CARD_EFFECTS.rapid}` },
  cohesion: { name: '결속', effect: `추종 속도 x${CARD_EFFECTS.cohesion}` },
}

function cardView(id: CardId, slot: number): UpgradeCardView {
  return { slot, id, name: UPGRADE_CARD_LABELS[id].name, effect: UPGRADE_CARD_LABELS[id].effect }
}

function rosterEntry(
  state: Readonly<BattleState>,
  unit: Readonly<FriendlyUnit>,
  candidateId: number | null,
): RosterEntryView {
  return {
    id: unit.id,
    name: nameOf(unit.nameIndex),
    isCommand: unit.id === state.commandUnitId,
    life: unit.life,
    hp: unit.hp,
    maxHp: unit.maxHp,
    hp01: unit.maxHp > 0 ? Math.max(0, Math.min(1, unit.hp / unit.maxHp)) : 0,
    downedTicksRemaining: unit.life === 'downed' ? DOWNED_TICKS - unit.downedTicks : 0,
    isRescueCandidate: unit.id === candidateId,
  }
}

export function projectBattleHud(state: Readonly<BattleState>): BattleHud {
  const candidateId = rescueCandidateId(state)
  const roster: RosterEntryView[] = []
  const casualties: CasualtyView[] = []
  const rescueRecords: RescueRecordView[] = []
  let command: RosterEntryView | null = null
  let standing = 0
  let downed = 0
  let dead = 0
  let commanderSurvived = false

  for (const unit of friendliesById(state)) {
    const entry = rosterEntry(state, unit, candidateId)
    roster.push(entry)
    if (entry.isCommand) command = entry
    if (unit.life === 'standing') standing += 1
    else if (unit.life === 'downed') downed += 1
    else dead += 1
    if (unit.id === state.originalCommanderId && unit.life === 'standing') commanderSurvived = true
    if (unit.life === 'dead' && unit.deathTick !== null) {
      casualties.push({ name: nameOf(unit.nameIndex), deathTick: unit.deathTick })
    }
    if (unit.rescuedByIds.length > 0) {
      rescueRecords.push({
        name: nameOf(unit.nameIndex),
        rescuers: unit.rescuedByIds.map((id) => {
          const rescuer = state.friendlies.find((body) => body.id === id)
          return rescuer ? nameOf(rescuer.nameIndex) : `#${id}`
        }),
      })
    }
  }

  casualties.sort((left, right) => left.deathTick - right.deathTick)

  const round = pendingUpgradeRound(state)
  const rescueTarget =
    state.rescue.active && state.rescue.targetId !== null
      ? state.friendlies.find((unit) => unit.id === state.rescue.targetId) ?? null
      : null

  return {
    tick: state.combatTick,
    mode: state.mode,
    result: state.result,
    failureReason: state.failureReason,
    secondsRemaining: Math.max(0, COMBAT_TICK_LIMIT - state.combatTick) / BATTLE_TICKS_PER_SECOND,
    kills: state.stats.kills,
    rescues: state.stats.rescues,
    command,
    roster,
    standing,
    downed,
    dead,
    rescue: rescueTarget
      ? {
          targetId: rescueTarget.id,
          targetName: nameOf(rescueTarget.nameIndex),
          progress: state.rescue.progress,
          total: rescueTicksOf(state),
        }
      : null,
    rescueCandidateId: candidateId,
    pendingUpgrade:
      round === null
        ? null
        : { round: round.round, cards: round.offered.map((id, index) => cardView(id, index + 1)) },
    chosenCards: state.upgrades.rounds
      .filter((entry) => entry.chosen !== null)
      .map((entry, index) => cardView(entry.chosen!, index + 1)),
    casualties,
    rescueRecords,
    commanderSurvived,
  }
}
