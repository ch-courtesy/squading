export type FrameSummary = {
  readonly sampleCount: number
  readonly invalidSampleCount: number
  readonly fps: number
  readonly p95Ms: number
}

export type FrameMetricsOptions = { readonly windowMs?: number }

export class FrameMetrics {
  private readonly samples: Array<{ durationMs: number; timestampMs: number }> = []
  private invalidSampleCount = 0
  private readonly windowMs: number
  private latestTimestampMs = 0

  constructor(options: FrameMetricsOptions = {}) {
    this.windowMs = options.windowMs ?? 3_000
  }

  recordFrame(durationMs: number, timestampMs = 0): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      this.invalidSampleCount += 1
      return
    }
    this.samples.push({ durationMs, timestampMs })
    this.latestTimestampMs = Math.max(this.latestTimestampMs, timestampMs)
    this.prune(timestampMs)
  }

  summary(nowMs = this.latestTimestampMs): FrameSummary {
    this.prune(nowMs)
    if (this.samples.length === 0) {
      return { sampleCount: 0, invalidSampleCount: this.invalidSampleCount, fps: 0, p95Ms: 0 }
    }
    const sorted = this.samples.map((sample) => sample.durationMs).sort((left, right) => left - right)
    const p95Index = Math.ceil(sorted.length * 0.95) - 1
    const average = sorted.reduce((total, sample) => total + sample, 0) / sorted.length
    return {
      sampleCount: sorted.length,
      invalidSampleCount: this.invalidSampleCount,
      fps: 1000 / average,
      p95Ms: sorted[p95Index],
    }
  }

  private prune(nowMs: number): void {
    const oldest = nowMs - this.windowMs
    while (this.samples[0]?.timestampMs < oldest) this.samples.shift()
  }
}
