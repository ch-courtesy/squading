import type { SimulationInput } from './types'

export type InputLog = {
  at(tick: number): SimulationInput
}

export function createInputLog(
  entries: Readonly<Record<number, Readonly<SimulationInput>>>,
): InputLog {
  const copiedEntries = Object.fromEntries(
    Object.entries(entries).map(([tick, input]) => [tick, { ...input }]),
  )
  return {
    at(tick) {
      return { ...(copiedEntries[tick] ?? {}) }
    },
  }
}
