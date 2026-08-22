// The campaign's seed derivation (campaign design §3.2).
//
// "스테이지 seed는 캠페인 root seed에서 스테이지 번호로 파생한다 — `stage-seed(root, n)`. 그래야
// 같은 캠페인을 재생할 수 있다."
//
// IT IS A STRING FUNCTION, NOT A DRAW. Nothing here touches a PRNG: the battle's three streams
// (§1.17) are derived from whatever seed they are handed, so deriving the seed is enough and no
// fourth stream is added to the battle for the campaign's sake. `Math.random` appears nowhere in
// this module or any other in the campaign.
//
// WHY THE FIRST STAGE IS THE ROOT ITSELF. `stageSeed(root, 1)` is `root`, so `createBattle(s)` IS
// stage 1 of campaign `s` — every recorded seed band, every fixture and both §4.4 browser routes
// (each swept over 192 circuits to find the win and the wipe they drive) go on naming the run they
// have always named. Suffixing stage 1 as well would have re-rolled all of them for nothing: what
// §3.2 requires is that the derivation be a pure function of the root and the stage number and
// that two stages differ, and both hold either way.

import { FIRST_STAGE_ID, type StageId } from '../battle/stages'

/** The separator, spelled once. A campaign root seed containing it is still a distinct campaign. */
const STAGE_SEED_MARK = ':stage:'

export function stageSeed(rootSeed: string, stageId: StageId): string {
  if (stageId === FIRST_STAGE_ID) return rootSeed
  return `${rootSeed}${STAGE_SEED_MARK}${stageId}`
}
