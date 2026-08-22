// The relay: what crosses a stage boundary and what does not (campaign design §1.1, §1.3–§1.5).
//
// ---------------------------------------------------------------------------
// THE THREE THINGS THAT MUST NOT RESET
// ---------------------------------------------------------------------------
// §1.1: "스테이지를 넘을 때 초기화되지 않는 것: 생존자 명단과 이름(§1.14), 각자의 HP, 선택한 강화
// 카드, 누가 죽었는지의 기록." And: "이 셋이 이어달리기를 성립시킨다. 하나라도 초기화되면 일곱
// 판이 아니라 같은 판 일곱 번이다."
//
// Each of the three is carried by exactly one thing here, and each has a fixture named after it in
// `tests/campaign/campaign-relay.test.ts`:
//
//   the roster and its names ... `CarriedMember.id` / `.role` / `.nameIndex`
//   each body's hp ............. `CarriedMember.hp` / `.maxHp`, copied and never refilled
//   the cards .................. `CampaignState.cards` -> `upgrades.carriedCards`
//
// ---------------------------------------------------------------------------
// AND THE ONE RULING THAT COSTS SOMETHING (§1.3)
// ---------------------------------------------------------------------------
// "쓰러진(downed) 병사는 사망 처리한다." A body still on the ground when the stage ends does not
// come back. §1.3 gives the reason and it is a design reason rather than a bookkeeping one: if the
// end of a stage revived everyone for free, then "구조하러 갈지 말지" would stop being a question
// in the second half of every stage — nobody would ever go back for anyone, because waiting is
// cheaper. So the rule below is one clause, `life !== 'standing'`, and it is deliberately the same
// clause for a lost stage as for a won one: a stage ends, and whoever is not on their feet is
// gone.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE DOES NOT DO
// ---------------------------------------------------------------------------
// It does not reset anything. The enemies, the elite, the spawn backlog, the rescue lock, the
// clock and the stage's own kill count are not carried BECAUSE `CarriedSquad` has no room for
// them — the next battle is built from scratch by `createInitialBattleState` and inherits only
// what it is handed. There is no "reset" step that could be forgotten.

import { chosenUpgradeCards } from '../battle/upgrades'
import { friendliesById } from '../battle/state'
import type { BattleState, CarriedMember } from '../battle/types'
import {
  nextStageIdOf,
  type CampaignCasualty,
  type CampaignState,
} from './state'

/**
 * Fold a finished stage into the campaign.
 *
 * PURE: it reads the battle and returns the next campaign state. The battle it read is finished
 * and is never touched — a stage boundary that wrote back into a battle would be writing into the
 * object §1.17's digest has already recorded.
 */
export function completeStage(
  campaign: Readonly<CampaignState>,
  battle: Readonly<BattleState>,
): CampaignState {
  if (battle.result === null) {
    throw new Error('campaign/transition: the stage has not ended (§1.16 has set no result)')
  }
  if (battle.stageId !== campaign.stageId) {
    throw new Error(
      `campaign/transition: stage ${battle.stageId} finished while the campaign is on ${campaign.stageId}`,
    )
  }

  const won = battle.result === 'won'
  const survivors: CarriedMember[] = []
  const fallen: CampaignCasualty[] = [...campaign.fallen]

  for (const unit of friendliesById(battle)) {
    // §1.3, and the whole cost of the ruling: `standing` is the only life state that carries.
    // A `downed` body at the moment of victory is a casualty, exactly like a `dead` one.
    if (unit.life === 'standing') {
      survivors.push({
        id: unit.id,
        role: unit.role,
        nameIndex: unit.nameIndex,
        // §1.1: no healing. These two numbers are the fight's ending values, and `maxHp` is where
        // §1.13's `vitality` lives, so copying them is what carries both facts.
        hp: unit.hp,
        maxHp: unit.maxHp,
      })
      continue
    }
    fallen.push({ id: unit.id, nameIndex: unit.nameIndex, stageId: battle.stageId })
  }

  const kills = campaign.kills + battle.stats.kills
  // Carried cards first, this stage's after them — `chosenUpgradeCards` already answers in that
  // order, so the campaign's list IS the battle's read of what the squad holds.
  const cards = chosenUpgradeCards(battle)

  // §1.5: whoever ends the stage in command leads the next one. The battle has already run §1.5
  // on the winning tick, so `commandUnitId` names a standing body unless nothing is standing; the
  // fallback is the ascending-id rule §1.5 itself breaks ties with, and it is here so this
  // function cannot hand back a squad whose leader is a corpse.
  const commandUnitId = survivors.some((member) => member.id === battle.commandUnitId)
    ? battle.commandUnitId
    : survivors.length > 0
      ? survivors[0].id
      : null

  const squad =
    commandUnitId === null ? null : { commandUnitId, members: survivors }

  const next = nextStageIdOf(battle.stageId)
  // §1.4 first: a lost stage ends the campaign whatever else is true. Then `complete`, because
  // winning the LAST stage is a finished campaign even if it cost the last body — there is no next
  // stage for §1.5's "분대가 없다" to be about. Only then §1.5's empty squad.
  const { phase, end } = !won
    ? ({ phase: 'campaign-over', end: 'defeat' } as const)
    : next === null
      ? ({ phase: 'campaign-over', end: 'complete' } as const)
      : squad === null
        ? ({ phase: 'campaign-over', end: 'no-survivors' } as const)
        : ({ phase: 'stage-cleared', end: null } as const)

  return {
    ...campaign,
    phase,
    end,
    squad,
    fallen,
    cards,
    kills,
  }
}

/**
 * Step onto the next stage. Only legal from `stage-cleared`, which is the only phase that has one.
 *
 * The stage number is advanced HERE rather than in `completeStage`, so that the transition screen
 * has a state to render in which the stage just finished is still the current one and the next one
 * is a fact about it (`nextStageIdOf`).
 */
export function advanceStage(campaign: Readonly<CampaignState>): CampaignState {
  if (campaign.phase !== 'stage-cleared') {
    throw new Error(`campaign/transition: cannot advance from ${campaign.phase}`)
  }
  const next = nextStageIdOf(campaign.stageId)
  if (next === null) {
    throw new Error('campaign/transition: `stage-cleared` with no next stage is unreachable')
  }
  return { ...campaign, stageId: next, phase: 'in-stage' }
}
