// The campaign replay digest (campaign design §3.2: "캠페인도 결정론적이어야 한다").
//
// SAME DISCIPLINE AS §1.17's, and the same hash: `fnv1aHex` and `normalizeForDigest` come from
// `core/battle/digest.ts` rather than being written twice, so "the digest" means one thing in this
// project. What differs is only the object walked.
//
// It walks the WHOLE campaign state for §1.17's reason: a hand-picked list falls behind the rules,
// and a field added to `CampaignState` that the digest cannot see is a field two replays may
// legally disagree about. The canonicalization sorts the roster by id and the casualty list by
// (stage, id) — array order is bookkeeping. `cardLevels` needs no canonicalization: §1.13 v2 made
// it a full table with one entry per card in `CARD_POOL` order, so two campaigns holding the same
// levels serialise identically without being sorted. v1's `cards` was a history array and was left
// alone for the opposite reason — the order it was taken in was data.
//
// WHAT A CAMPAIGN DIGEST IS EVIDENCE OF, stated narrowly: two campaigns that played the same
// stages with the same inputs from the same root seed end with the same roster, hp, levels, kill
// count and dead. It is NOT a digest of the battles — each battle has its own §1.17 digest, and a
// campaign digest agreeing while a battle digest differs would mean two different fights arrived
// at the same survivors, which is possible and is not a defect.

import { fnv1aHex, normalizeForDigest } from '../battle/digest'
import type { CampaignState } from './state'

export function canonicalizeCampaignState(state: Readonly<CampaignState>): unknown {
  return normalizeForDigest({
    ...state,
    squad: state.squad
      ? {
          ...state.squad,
          members: [...state.squad.members].sort((left, right) => left.id - right.id),
        }
      : null,
    fallen: [...state.fallen].sort(
      (left, right) => left.stageId - right.stageId || left.id - right.id,
    ),
  })
}

export function digestCampaignState(state: Readonly<CampaignState>): string {
  return fnv1aHex(JSON.stringify(canonicalizeCampaignState(state)))
}
