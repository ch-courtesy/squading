// The public face of the campaign — one object a shell or a harness can drive (§3.2, §5 stage 1).
//
// It owns the CURRENT stage's `Battle` and hands it out; it never wraps the battle's verbs. §4.3
// compares a headless replay against a browser one through `createBattle`, and a campaign that
// proxied `step`/`enqueue` would put a second driver between them. So the six battle verbs stay
// where they are, and this object adds exactly three of its own: fold the finished stage in, step
// onto the next one, start over.
//
// STARTING OVER IS STAGE 1, ALWAYS. Campaign §1.4: "패배하면 캠페인이 끝난다. 스테이지 재시도 없음.
// 재시작은 스테이지 1부터." There is deliberately no verb here that rebuilds the stage that was
// just lost — `Battle.restart` can replay a stage, but nothing in this file calls it.

import { createBattle, type Battle } from '../battle/battle'
import { digestCampaignState } from './digest'
import { stageSeed } from './seed'
import { carriedSquadOf, createCampaignState, type CampaignState } from './state'
import { advanceStage, completeStage } from './transition'

export type Campaign = {
  /** §3.2's root seed. Every stage's battle seed is derived from it. */
  rootSeed(): string
  state(): CampaignState
  /** §3.2's replay digest of the campaign as it stands. */
  digest(): string
  /**
   * The current stage's battle.
   *
   * Call it again after `advance` or `restart` — those replace the object, and a reference held
   * across one is a reference to the stage before.
   */
  battle(): Battle
  /**
   * Fold the finished battle into the campaign (§1.1, §1.3, §1.4, §1.5).
   *
   * Throws if the battle has not ended, so a shell that calls it on a running stage fails where it
   * is wrong instead of recording a stage nobody finished.
   */
  finishStage(): void
  /** §1.1: start the next stage with the squad that survived. Only legal from `stage-cleared`. */
  advance(): void
  /** §1.4: a new campaign from stage 1, on the same root seed or on `rootSeed` if one is given. */
  restart(rootSeed?: string): void
}

/** The one place a stage's battle is built, so the seed derivation and the relay cannot disagree. */
export function startStageBattle(state: Readonly<CampaignState>): Battle {
  return createBattle(stageSeed(state.rootSeed, state.stageId), {
    stageId: state.stageId,
    carried: carriedSquadOf(state),
  })
}

export function createCampaign(rootSeed: string): Campaign {
  let state = createCampaignState(rootSeed)
  let battle = startStageBattle(state)

  return {
    rootSeed: () => state.rootSeed,
    state: () => state,
    digest: () => digestCampaignState(state),
    battle: () => battle,

    finishStage(): void {
      state = completeStage(state, battle.state())
    },

    advance(): void {
      state = advanceStage(state)
      battle = startStageBattle(state)
    },

    restart(nextRootSeed?: string): void {
      state = createCampaignState(nextRootSeed ?? state.rootSeed)
      battle = startStageBattle(state)
    },
  }
}
