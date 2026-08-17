// §1.14: names.
//
// The pool is exactly 24 and the shuffle is exactly one Fisher-Yates pass over all
// 24 entries — 23 draws, never 16 and never 24. The count is part of the contract
// (§4.2 pins it) because it fixes where the `names` stream stops: any later use of
// that stream has to start from the same position or every seeded run diverges.
//
// 24 names for 16 bodies is deliberate: the surplus keeps two runs on neighbouring
// seeds from reading as the same roster, and the result screen (§1.14) is the whole
// reason the roster carries names at all.

import type { Prng } from '../prng'

export const NAME_POOL: readonly string[] = [
  '한서린',
  '남궁윤',
  '도경환',
  '류지안',
  '마해든',
  '박초원',
  '서다움',
  '선우진',
  '송가람',
  '신여울',
  '안하람',
  '양하율',
  '오시온',
  '유세하',
  '윤나래',
  '이든솔',
  '임초록',
  '장미르',
  '전한결',
  '정겨울',
  '조아라',
  '차보름',
  '최이레',
  '황도담',
]

export const NAME_POOL_SIZE = NAME_POOL.length

if (NAME_POOL_SIZE !== 24) {
  throw new Error('battle/names: the pool is exactly 24 names (§1.14)')
}
if (new Set(NAME_POOL).size !== NAME_POOL_SIZE) {
  throw new Error('battle/names: the pool has a duplicate')
}

/**
 * One Fisher-Yates pass over the 24 pool indices. Exactly `NAME_POOL_SIZE - 1`
 * draws: the last remaining element cannot move, so drawing for it would consume a
 * 24th value for nothing and shift every subsequent `names` draw.
 */
export function shuffleNamePool(prng: Prng): number[] {
  const order = Array.from({ length: NAME_POOL_SIZE }, (_, index) => index)
  for (let index = NAME_POOL_SIZE - 1; index >= 1; index -= 1) {
    const pick = Math.floor(prng.nextFloat() * (index + 1))
    const swap = order[index]
    order[index] = order[pick]
    order[pick] = swap
  }
  return order
}

/** §1.14: the first `count` of the shuffled pool, handed out in ascending unit id. */
export function assignNameIndices(prng: Prng, count: number): number[] {
  if (count > NAME_POOL_SIZE) {
    throw new Error('battle/names: asked for more names than the pool holds')
  }
  return shuffleNamePool(prng).slice(0, count)
}

export function nameOf(nameIndex: number): string {
  return NAME_POOL[nameIndex] ?? ''
}
