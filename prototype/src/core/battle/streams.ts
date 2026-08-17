// §1.17: the three named PRNG streams — `spawn`, `cards`, `names`.
//
// There was a fourth, `terrain`, until §1.6 removed cover from the game. It is gone
// rather than kept-and-unused: an idle stream still occupies a slot in the digest and
// would let a later batch quietly reintroduce terrain generation without touching this
// file. §1.17 now says "세 스트림".
//
// Naming and derivation follow `core/gameplay/state.ts`: each stream is a separate
// xorshift seeded from `${rootSeed}:${name}`, so consuming one can never disturb
// another. v1 additionally guaranteed that "changing only the card choice leaves
// the spawn draw sequence identical"; §1.17 withdraws that guard, but stream
// separation itself is what makes replay and the 8-seed bands meaningful.
//
// The live state is stored as three raw uint32s inside `BattleState.prng` (the
// representation `core/gameplay/progression.ts` already uses), because the digest
// has to see the stream position and a closure cannot be serialized. `streamPrng`
// hands out a `Prng` view over one of those slots for code — the name shuffle, the
// card draw — that wants the `Prng` interface.

import type { Prng } from '../prng'
import { createPrng } from '../prng'

export type StreamName = 'spawn' | 'cards' | 'names'

export const STREAM_NAMES: readonly StreamName[] = ['spawn', 'cards', 'names']

export type BattlePrngStates = Record<StreamName, number>

/** `${seed}:${name}` — the convention already used by `gameplay/state.ts`. */
export function streamSeed(rootSeed: string, name: StreamName): string {
  return `${rootSeed}:${name}`
}

export function createStreamStates(rootSeed: string): BattlePrngStates {
  return {
    spawn: createPrng(streamSeed(rootSeed, 'spawn')).getState(),
    cards: createPrng(streamSeed(rootSeed, 'cards')).getState(),
    names: createPrng(streamSeed(rootSeed, 'names')).getState(),
  }
}

/** One xorshift step on a single stream. Identical to `core/prng.ts`. */
export function nextStreamUint32(states: BattlePrngStates, name: StreamName): number {
  let value = states[name] >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  states[name] = value >>> 0
  return states[name]
}

export function nextStreamFloat(states: BattlePrngStates, name: StreamName): number {
  return nextStreamUint32(states, name) / 0x1_0000_0000
}

export function nextStreamRange(
  states: BattlePrngStates,
  name: StreamName,
  min: number,
  max: number,
): number {
  return min + (max - min) * nextStreamFloat(states, name)
}

/** A `Prng` view that reads and writes one slot of `states`. */
export function streamPrng(states: BattlePrngStates, name: StreamName): Prng {
  return {
    getState: () => states[name] >>> 0,
    nextUint32: () => nextStreamUint32(states, name),
    nextFloat: () => nextStreamFloat(states, name),
    range: (min, max) => nextStreamRange(states, name, min, max),
  }
}
