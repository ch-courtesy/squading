// `core/campaign/` — the seven-stage relay
// (`docs/superpowers/specs/2026-08-21-seven-stage-campaign-design.md`, v1).
//
// ---------------------------------------------------------------------------
// THE BOUNDARY — read this before adding an import
// ---------------------------------------------------------------------------
// The dependency runs ONE WAY: this directory reads `core/battle/`, and nothing under
// `core/battle/` may import anything from here. A battle that could see the campaign would start
// answering questions §1 does not give it — how many stages there are, what the next one is — and
// "전투는 여전히 90초 한 판만 안다" would stop being true.
//
// The two seams, and there are only two:
//
//   `CarriedSquad`   — what a campaign hands the next battle. Declared in `battle/types.ts`,
//                      because it is an INPUT to `createInitialBattleState`; built here by
//                      `carriedSquadOf`.
//   `completeStage`  — what a campaign reads off a finished battle. Reads, never writes.
//
// ---------------------------------------------------------------------------
// Implemented — §5 stage 1
// ---------------------------------------------------------------------------
//   §3.2  `CampaignState` .................................... state
//         Survivors with hp and names, the cards, the cumulative kills, the stage number, the
//         dead. Everything derivable is derived (`campaignOutcome`, `nextStageIdOf`).
//   §3.2  stage seeds ........................................ seed
//         `stageSeed(root, n)`, a pure string function. NO PRNG stream was added to the battle.
//   §3.2  the campaign digest ................................ digest
//         §1.17's hash and normalization, over the campaign object.
//   §1.1  the relay .......................................... transition
//         Roster, names, hp and cards cross; enemies, elite, backlog, rescue lock, clock and the
//         stage's kill count do not, because `CarriedSquad` has nowhere to put them.
//   §1.3  the downed are dead at the end of a stage .......... transition
//   §1.4  a lost stage ends the campaign ..................... transition
//   §1.5  a won stage with no survivors ends it too .......... transition
//   §5    the facade ......................................... campaign
//
// ---------------------------------------------------------------------------
// NOT implemented — and named so it is not mistaken for a gap
// ---------------------------------------------------------------------------
// THERE IS ONE STAGE. §5 stage 2 is what adds the other six rows to `STAGES`, and until it does,
// `nextStageIdOf` answers null after stage 1 and winning stage 1 completes the campaign. Nothing
// in this directory hardcodes the number: it reads `STAGES`.
//
// The consequence, stated plainly rather than glossed: `phase: 'stage-cleared'` and `advance()`
// are UNREACHABLE IN PLAY today. They are reached by the relay fixtures, which carry a survivor
// list into another stage-1 battle — which is what a stage boundary does, minus the different
// numbers §5 stage 2 will give the second stage.

export * from './campaign'
export * from './digest'
export * from './seed'
export * from './state'
export * from './transition'
