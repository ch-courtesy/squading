// §1.17: the replay digest.
//
// The digest covers the ENTIRE authoritative state, not a hand-picked list. §1.17
// enumerates what must be included, and the state in `types.ts` is exactly that
// list, so walking the whole object is both the shortest implementation and the one
// that cannot fall behind the rules: a later batch that adds a field to the state
// gets it into the digest for free, and a field it forgets to add is a field the
// replay never depended on.
//
// Two normalizations make the digest a statement about the game rather than about
// the interpreter:
//
//   * floats to 6 decimal places (§1.1), so the last bits of a hypot do not decide
//     whether two runs "match";
//   * canonical ordering — object keys sorted, unit arrays sorted by id, backlog by
//     request sequence — so array order, which is an implementation detail of the
//     update loop, cannot change the digest.
//
// §1.6 removed terrain, so the digest no longer carries a terrain list and covers three
// streams rather than four. It is smaller than the v6 digest by construction: every
// recorded v6 digest value is void, which is stated in §1.16's own header.
//
// `rescuedByIds` is deliberately NOT sorted: it is a record of who rescued whom in
// what order (§1.14), so its order is data.

import { DIGEST_DECIMALS } from './constants'
import type { BattleState } from './types'

/**
 * The hash, exported so the CAMPAIGN digest is the same hash and not a second one.
 *
 * `core/campaign/digest.ts` records a campaign the way §1.17 records a battle, and two independent
 * implementations of "the digest" is how the two would come to disagree about what a digest even
 * is. The direction is one-way: campaign reads battle, never the other way round.
 */
export function fnv1aHex(value: string): string {
  return fnv1a(value)
}

/** The §1.17 normalization — 6-decimal floats, code-point-sorted keys — for the same reason. */
export function normalizeForDigest(value: unknown): unknown {
  return normalize(value)
}

function fnv1a(value: string): string {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalize(value: unknown): unknown {
  if (typeof value === 'number') {
    // `-0` and `0` are the same position; without this they serialize differently.
    const rounded = Number(value.toFixed(DIGEST_DECIMALS))
    return rounded === 0 ? 0 : rounded
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => [key, normalize(entry)]),
    )
  }
  return value
}

/**
 * Code-point order, NOT `localeCompare`.
 *
 * §4.3 requires the same seed and input log to produce the same result in a headless
 * replay and in a real browser. `localeCompare` answers to the host's locale and ICU
 * build, so the same state could canonicalize to two different key orders on two
 * machines and the digests would disagree with nothing wrong in the simulation.
 */
function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function byId<T extends { id: number }>(left: T, right: T): number {
  return left.id - right.id
}

export function canonicalizeBattleState(state: Readonly<BattleState>): unknown {
  return normalize({
    ...state,
    friendlies: [...state.friendlies].sort(byId),
    enemies: [...state.enemies].sort(byId),
    slotAssignments: [...state.slotAssignments].sort((left, right) => left.unitId - right.unitId),
    spawn: {
      ...state.spawn,
      // §1.10: backlog order is part of the rule (oldest first is what gets
      // discarded), so it is canonicalized rather than dropped.
      backlog: [...state.spawn.backlog].sort((left, right) => left.sequence - right.sequence),
    },
    upgrades: {
      ...state.upgrades,
      rounds: [...state.upgrades.rounds].sort((left, right) => left.round - right.round),
    },
  })
}

export function digestBattleState(state: Readonly<BattleState>): string {
  return fnv1a(JSON.stringify(canonicalizeBattleState(state)))
}
