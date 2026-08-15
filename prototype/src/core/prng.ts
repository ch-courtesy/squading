function hashSeed(seed: string): number {
  let value = 2166136261

  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }

  return value >>> 0 || 0x9e3779b9
}

export type Prng = {
  getState(): number
  nextUint32(): number
  nextFloat(): number
  range(min: number, max: number): number
}

export function createPrng(seed: string): Prng {
  let state = hashSeed(seed)

  const nextUint32 = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }

  return {
    getState: () => state >>> 0,
    nextUint32,
    nextFloat: () => nextUint32() / 0x1_0000_0000,
    range: (min, max) => min + (max - min) * (nextUint32() / 0x1_0000_0000),
  }
}
