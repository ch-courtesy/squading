import { createInputLog, type InputLog } from '../core/input-log'
import type { SimulationConfig } from '../core/types'

export type RendererBenchmarkOptions = SimulationConfig

export type RendererBenchmark = {
  config: SimulationConfig
  inputLog: InputLog
}

export function createRendererBenchmark(
  options: RendererBenchmarkOptions,
): RendererBenchmark {
  return {
    config: { ...options },
    inputLog: createInputLog({
      0: { rescue: true },
      60: { moveX: 1 },
      90: { switchSquad: true },
      150: { moveY: -1 },
    }),
  }
}
