// What the campaign screens print, as one display-only value (§6, and campaign §5 stage 1's 셸).
//
// Same boundary as `battle-view/hud.ts`: the shell never sees `CampaignState`, it sees this. And
// the same standard for a field — not "is it useful" but "is it on the screen", discharged by
// `battle-shell.ts` actually printing every field below and by `tests/app/battle-shell.test.ts`
// walking the rendered DOM for the ones that carry a rule.
//
// THE NAMES ARE THE POINT OF THIS FILE. §1.14 gave the roster names so that a loss reads as a
// person, and the campaign screens are the only place that pays off across stages: a body lost in
// stage 3 is a name on the end screen in stage 7. So `fallen` resolves `nameIndex` to a NAME here
// and the shell prints it — an id would make the whole of §1.14 decorative.

import { nameOf } from '../battle/names'
import { upgradeCardViews, type UpgradeCardView } from '../battle-view/hud'
import {
  campaignOutcome,
  campaignStageCount,
  nextStageIdOf,
  type CampaignEnd,
  type CampaignPhase,
  type CampaignState,
} from '../campaign/state'

/** One survivor, as the transition and end screens show them. */
export type CampaignSurvivorView = {
  id: number
  name: string
  isCommand: boolean
  hp: number
  maxHp: number
  /** The hp bar's fill. §1.1 does not heal between stages, so this is what carried over. */
  hp01: number
}

/** §1.14: one of the dead, by name, and the stage that took them. */
export type CampaignFallenView = {
  id: number
  name: string
  stageId: number
}

export type CampaignHud = {
  /** The stage being played, or the one just finished once the campaign has left `in-stage`. */
  stageId: number
  /** How many stages there are. ONE today; §5 stage 2 is what makes it seven. */
  stageCount: number
  /** The stage the transition screen offers, or null when the campaign has run out of them. */
  nextStageId: number | null
  phase: CampaignPhase
  end: CampaignEnd
  /** Derived from `end`: a campaign is won only by running out of stages to play. */
  outcome: 'won' | 'lost' | null
  /** §1.2: kills across every finished stage. The battle HUD's `kills` is this stage's. */
  kills: number
  /** §1.2: the cards the squad holds, in the order it took them. */
  cards: readonly UpgradeCardView[]
  /** Who is left. Empty until a stage has been finished — the battle's own roster is on screen. */
  survivors: readonly CampaignSurvivorView[]
  fallen: readonly CampaignFallenView[]
}

export function projectCampaignHud(state: Readonly<CampaignState>): CampaignHud {
  const squad = state.squad
  return {
    stageId: state.stageId,
    stageCount: campaignStageCount(),
    nextStageId: nextStageIdOf(state.stageId),
    phase: state.phase,
    end: state.end,
    outcome: campaignOutcome(state),
    kills: state.kills,
    cards: upgradeCardViews(state.cards),
    survivors: squad
      ? [...squad.members]
          .sort((left, right) => left.id - right.id)
          .map((member) => ({
            id: member.id,
            name: nameOf(member.nameIndex),
            isCommand: member.id === squad.commandUnitId,
            hp: member.hp,
            maxHp: member.maxHp,
            hp01: member.maxHp > 0 ? Math.max(0, Math.min(1, member.hp / member.maxHp)) : 0,
          }))
      : [],
    fallen: [...state.fallen]
      .sort((left, right) => left.stageId - right.stageId || left.id - right.id)
      .map((entry) => ({
        id: entry.id,
        name: nameOf(entry.nameIndex),
        stageId: entry.stageId,
      })),
  }
}
