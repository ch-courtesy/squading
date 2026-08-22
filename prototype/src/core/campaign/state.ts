// The campaign's authoritative state (campaign design §3.2).
//
// ---------------------------------------------------------------------------
// IT IS NOT `BattleState`, AND IT IS NOT INSIDE IT
// ---------------------------------------------------------------------------
// "전투는 여전히 90초 한 판만 안다." A battle knows its stage's numbers and what it was handed to
// start with; it does not know how many stages there are, which one is next, or who died three
// stages ago. Everything that outlives one 90-second fight lives here, and the two modules meet at
// exactly two seams: `CarriedSquad` (what the campaign hands the next battle) and
// `completeStage` (what the campaign reads off a finished one).
//
// ---------------------------------------------------------------------------
// WHAT IS HERE AND WHAT IS DERIVED
// ---------------------------------------------------------------------------
// §3.2 asks for the survivors with their hp and names, the chosen cards, the cumulative kill
// count, the current stage number and the record of the dead. All six are below. Nothing else is:
//
//   * the campaign's WIN/LOSS is derived from `end` (`campaignOutcome`), not stored beside it;
//   * "is there a next stage" is derived from `STAGES` (`nextStageIdOf`);
//   * how many cards are due next is derived by the battle, from `kills` and §1.13's table.
//
// A campaign digest walks this object exactly as §1.17's walks the battle's, so a field that is a
// function of the others makes two campaigns that are the same campaign hash differently the day
// one of them is written inconsistently.

import type { CardId } from '../battle/constants'
import { FIRST_STAGE_ID, STAGES, type StageId } from '../battle/stages'
import type { CarriedMember, CarriedSquad } from '../battle/types'

/**
 * Where the campaign stands between battles.
 *
 *   `in-stage`      — a battle is being played (or is waiting to be started).
 *   `stage-cleared` — that battle was won, survivors remain, and another stage exists.
 *   `campaign-over` — nothing more will be played on this campaign. `end` says why.
 */
export type CampaignPhase = 'in-stage' | 'stage-cleared' | 'campaign-over'

/**
 * Why the campaign stopped, or null while it has not.
 *
 *   `complete`      — the last stage was won. §5 stage 1 has one stage, so winning it is this.
 *   `defeat`        — a stage was lost. Campaign §1.4: no stage retry, the campaign is over.
 *   `no-survivors`  — a stage was WON with nobody left standing (§1.5: "다음 스테이지를 시작할
 *                     분대가 없다").
 */
export type CampaignEnd = 'complete' | 'defeat' | 'no-survivors' | null

/** §1.14: a body the campaign lost, and the stage that took it. */
export type CampaignCasualty = {
  id: number
  /** Index into `NAME_POOL`. The transition and end screens print the NAME (§1.14). */
  nameIndex: number
  stageId: StageId
}

/** The squad as it stands between stages — §1.5's command included, because roles cannot say it. */
export type CampaignSquad = {
  commandUnitId: number
  members: CarriedMember[]
}

export type CampaignState = {
  schemaVersion: 1
  /** §3.2: the campaign root. Every stage's battle seed is derived from it (`stageSeed`). */
  rootSeed: string
  /** The stage being played, or — once `phase` has left `in-stage` — the one just finished. */
  stageId: StageId
  phase: CampaignPhase
  end: CampaignEnd
  /**
   * The squad carried into the current stage, or null.
   *
   * Null means there is nothing to carry, and it means that in both of the ways it can happen: no
   * stage has been played yet (the battle draws its own 16 and its own names, §1.14), or none of
   * them are left. The second never reaches a battle — `phase` is `campaign-over` there, and
   * `startStageBattle` is not called.
   */
  squad: CampaignSquad | null
  /** §1.14: everyone the campaign has lost, oldest stage first, ascending id within a stage. */
  fallen: CampaignCasualty[]
  /** §1.2: the cards held, in the order they were taken. At most one of each per campaign. */
  cards: CardId[]
  /** §1.2: kills across every finished stage. §1.13's thresholds are measured against this. */
  kills: number
}

export function createCampaignState(rootSeed: string): CampaignState {
  return {
    schemaVersion: 1,
    rootSeed,
    stageId: FIRST_STAGE_ID,
    phase: 'in-stage',
    end: null,
    squad: null,
    fallen: [],
    cards: [],
    kills: 0,
  }
}

/**
 * The next stage's id, or null when the one just finished was the last.
 *
 * DERIVED FROM `STAGES`, which has one row today — so this answers null after stage 1 and winning
 * stage 1 completes the campaign. §5 stage 2 widens the table and this function starts answering
 * 2..7 with nothing here changing.
 */
export function nextStageIdOf(stageId: StageId): StageId | null {
  const index = STAGES.findIndex((stage) => stage.id === stageId)
  if (index === -1) throw new Error(`campaign/state: no stage with id ${stageId}`)
  const next = STAGES[index + 1]
  return next ? next.id : null
}

/** How many stages a campaign is. One today (§5 stage 2 is what makes it seven). */
export function campaignStageCount(): number {
  return STAGES.length
}

/** Derived: a finished campaign is won only when it ran out of stages to play. */
export function campaignOutcome(state: Readonly<CampaignState>): 'won' | 'lost' | null {
  if (state.phase !== 'campaign-over') return null
  return state.end === 'complete' ? 'won' : 'lost'
}

/**
 * What the next battle is handed (§1.1), or null for a fresh squad.
 *
 * Built here rather than stored, so the four things a carried battle needs cannot drift apart:
 * they are read out of the one campaign state in one place.
 */
export function carriedSquadOf(state: Readonly<CampaignState>): CarriedSquad | null {
  if (!state.squad) return null
  return {
    commandUnitId: state.squad.commandUnitId,
    members: state.squad.members.map((member) => ({ ...member })),
    cards: [...state.cards],
    priorKills: state.kills,
  }
}
