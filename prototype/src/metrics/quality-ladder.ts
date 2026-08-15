import type { QualityLevel } from '../renderers/contract'
import { FrameMetrics } from './frame-metrics'

export type QualityPhase = 'ready' | 'stabilizing' | 'recovery-window'
export type RecoveryOutcome = 'recovered' | 'needs-downgrade' | 'insufficient-samples' | null

export type QualityState = {
  readonly level: QualityLevel
  readonly phase: QualityPhase
  readonly stabilizationUntilMs: number | null
  readonly recoveryUntilMs: number | null
  readonly recoveryOutcome: RecoveryOutcome
  readonly recoveryP95Ms: number | null
}

export type QualityProfile = {
  readonly particleScale: number
  readonly shadowMapSize: number
  readonly dpr: number | null
}

const levels: readonly QualityLevel[] = [
  'full',
  'reduced-particles',
  'reduced-shadows',
  'low-dpr',
]

const profiles: Readonly<Record<QualityLevel, QualityProfile>> = {
  full: { particleScale: 1, shadowMapSize: 1024, dpr: null },
  'reduced-particles': { particleScale: 0.5, shadowMapSize: 1024, dpr: null },
  'reduced-shadows': { particleScale: 0.5, shadowMapSize: 512, dpr: null },
  'low-dpr': { particleScale: 0.5, shadowMapSize: 512, dpr: 1 },
}

const MAX_OBSERVATION_GAP_MS = 3_000

export function qualityProfile(level: QualityLevel): QualityProfile {
  return profiles[level]
}

export class QualityLadder {
  private levelIndex = 0
  private phase: QualityPhase = 'ready'
  private violationStartedAtMs: number | null = null
  private stabilizationUntilMs: number | null = null
  private recoveryUntilMs: number | null = null
  private lastObservedAtMs: number | null = null
  private recoveryMetrics = new FrameMetrics({ windowMs: 10_000 })
  private recoveryOutcome: RecoveryOutcome = null
  private recoveryP95Ms: number | null = null

  constructor(private readonly apply: (level: QualityLevel) => void) {}

  observe(p95Ms: number, nowMs: number): QualityState {
    if (this.advanceWindow(nowMs)) return this.state()
    if (this.phase !== 'ready' || this.levelIndex === levels.length - 1) return this.state()

    const uninterrupted = this.lastObservedAtMs === null || nowMs - this.lastObservedAtMs <= MAX_OBSERVATION_GAP_MS
    this.lastObservedAtMs = nowMs
    if (!uninterrupted || !Number.isFinite(p95Ms) || p95Ms <= 33) {
      this.violationStartedAtMs = null
    } else {
      this.violationStartedAtMs ??= nowMs
      if (nowMs - this.violationStartedAtMs >= 3_000) this.lowerQuality(nowMs)
    }
    return this.state()
  }

  observeFrame(durationMs: number, timestampMs: number): void {
    if (
      this.phase !== 'recovery-window' ||
      timestampMs < (this.stabilizationUntilMs ?? Infinity) ||
      timestampMs >= (this.recoveryUntilMs ?? -Infinity)
    ) return
    this.recoveryMetrics.recordFrame(durationMs, timestampMs)
  }

  state(): QualityState {
    return {
      level: levels[this.levelIndex],
      phase: this.phase,
      stabilizationUntilMs: this.stabilizationUntilMs,
      recoveryUntilMs: this.recoveryUntilMs,
      recoveryOutcome: this.recoveryOutcome,
      recoveryP95Ms: this.recoveryP95Ms,
    }
  }

  private lowerQuality(nowMs: number, preserveRecoveryResult = false): void {
    this.levelIndex += 1
    this.apply(levels[this.levelIndex])
    this.phase = 'stabilizing'
    this.stabilizationUntilMs = nowMs + 5_000
    this.recoveryUntilMs = null
    this.violationStartedAtMs = null
    this.recoveryMetrics = new FrameMetrics({ windowMs: 10_000 })
    if (!preserveRecoveryResult) {
      this.recoveryOutcome = null
      this.recoveryP95Ms = null
    }
  }

  private advanceWindow(nowMs: number): boolean {
    if (this.phase === 'stabilizing' && nowMs >= (this.stabilizationUntilMs ?? Infinity)) {
      this.phase = 'recovery-window'
      this.recoveryUntilMs = (this.stabilizationUntilMs ?? nowMs) + 10_000
      this.lastObservedAtMs = null
      return true
    }
    if (this.phase === 'recovery-window' && nowMs >= (this.recoveryUntilMs ?? Infinity)) {
      const summary = this.recoveryMetrics.summary(this.recoveryUntilMs ?? nowMs)
      this.recoveryP95Ms = summary.sampleCount > 0 ? summary.p95Ms : null
      this.phase = 'ready'
      this.stabilizationUntilMs = null
      this.recoveryUntilMs = null
      this.lastObservedAtMs = null
      if (this.recoveryP95Ms === null) {
        this.recoveryOutcome = 'insufficient-samples'
      } else if (this.recoveryP95Ms <= 33) {
        this.recoveryOutcome = 'recovered'
      } else {
        this.recoveryOutcome = 'needs-downgrade'
        if (this.levelIndex < levels.length - 1) this.lowerQuality(nowMs, true)
      }
      return true
    }
    return false
  }
}
