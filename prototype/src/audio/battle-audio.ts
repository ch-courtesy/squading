// The sound of the board — effects and music, synthesised.
//
// ---------------------------------------------------------------------------
// WHY THERE ARE NO AUDIO FILES
// ---------------------------------------------------------------------------
// Every voice below is built out of oscillators and noise at runtime. That is not a technical
// preference, it is the same rule `docs/assets-license.md` states about art: a sample is someone
// else's work with a licence attached, and one that ships in the repository has to be tracked,
// attributed and re-checked. A waveform computed here belongs to this file.
//
// It also keeps the download at zero bytes and the first sound instant — there is nothing to
// fetch, decode or fail to fetch.
//
// ---------------------------------------------------------------------------
// WHAT IT IS ALLOWED TO READ
// ---------------------------------------------------------------------------
// `RenderSnapshot`, and nothing else. Audio is a DISPLAY path in exactly the sense the renderer
// is: it reads the projection §6 publishes and writes nothing back. It cannot reach `BattleState`,
// it cannot reach the campaign, and it takes no argument that would let it. A run's digest is the
// same whether this file is loaded or not, and that is checked by the fact that no import here
// points into `core/battle`.
//
// ---------------------------------------------------------------------------
// THE AUTOPLAY RULE IS NOT AN EDGE CASE
// ---------------------------------------------------------------------------
// Browsers refuse to start an `AudioContext` that no gesture asked for, and a refused context
// stays `suspended` silently — the game would simply have no sound and no error. So the context
// is created lazily, on `resume()`, which the shell calls from the click that starts the battle.
// Before that call this object is inert and every method is a no-op.

import type { RenderActionEvent, RenderSnapshot } from '../core/types'

/**
 * Master gain, well under 1. Sixteen rifles firing inside one frame is normal here, and a mix
 * that peaks with one voice clips with eight.
 */
const MASTER_GAIN = 0.32

/** How many voices of one kind may start in a single frame. See `playFrame`. */
const VOICE_BUDGET: Readonly<Record<RenderActionEvent['kind'], number>> = {
  // Rifles are the loud case: fifteen soldiers with a 9-tick interval land in clumps, and the
  // renderer already caps its muzzle puffs for the same reason. Three reads as a volley; fifteen
  // reads as static.
  shot: 3,
  melee: 3,
  // The elite's blast is rare and is the loudest thing on the board. It is never thinned.
  blast: 4,
  death: 3,
  // A revive is the one sound the player is waiting for (§1.11) and at most one can be in flight.
  revive: 1,
}

/** Voices per frame across every kind, so a pathological frame cannot stall the audio thread. */
const TOTAL_VOICE_BUDGET = 10

type Bgm = {
  readonly gain: GainNode
  readonly bass: OscillatorNode
  readonly pad: OscillatorNode
  readonly padGain: GainNode
  readonly bassGain: GainNode
  /** The pulse timer's next beat, in context time. */
  nextBeatAt: number
  beat: number
}

/**
 * The board's audio. One per shell; `dispose()` releases the context.
 *
 * Every method is safe to call before `resume()` and after `dispose()` — the shell drives this
 * from a render loop and a UI toggle, and a null check at each call site is a null check it will
 * eventually forget.
 */
export type BattleAudio = {
  /** Start (or restart) the context. Must be called from a user gesture. */
  resume(): Promise<void>
  /** Play everything that happened in one frame, and move the music with the board. */
  playFrame(snapshot: RenderSnapshot): void
  /** The one-shots the BOARD does not publish: a card screen, a verdict, a menu press. */
  cue(name: CueName): void
  /** True when sound is ON. */
  enabled(): boolean
  /** Turn sound on or off. Returns the new state, so a toggle button has one source of truth. */
  setEnabled(next: boolean): boolean
  dispose(): void
}

export type CueName = 'upgrade' | 'victory' | 'defeat' | 'ui'

/**
 * The music, in one sentence: a two-note bass pulse under a slow pad, whose TEMPO and BRIGHTNESS
 * follow the board.
 *
 * It is not a loop of recorded music and it deliberately has no melody. A melody is a thing the
 * player hears the second time and the tenth time, and this runs for seven stages; a pulse that
 * tightens as the board fills reads as pressure rather than as a track.
 */
const BGM_ROOT_HZ = 55 // A1
const BGM_FIFTH_HZ = 82.41 // E2
const BGM_MIN_BEAT_MS = 300
const BGM_MAX_BEAT_MS = 620
/** Enemy count at which the pulse is at its fastest. Above this it does not tighten further. */
const BGM_PRESSURE_ENEMIES = 26

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * A dead object with the same shape, for every environment that has no `AudioContext` — the
 * vitest run, a headless capture, an old browser. Returning this rather than `null` is what keeps
 * the call sites free of null checks; see `BattleAudio`.
 */
function silentAudio(): BattleAudio {
  return {
    resume: async () => {},
    playFrame: () => {},
    cue: () => {},
    enabled: () => false,
    setEnabled: () => false,
    dispose: () => {},
  }
}

export function createBattleAudio(): BattleAudio {
  const Ctor: typeof AudioContext | undefined =
    typeof globalThis !== 'undefined'
      ? ((globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext
          ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined
  if (!Ctor) return silentAudio()

  let context: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null
  let bgm: Bgm | null = null
  let on = true
  let disposed = false
  /** The last tick this frame's events were played for, so a re-read of the same frame is silent. */
  let lastTick = -1

  /**
   * One second of white noise, made once and shared.
   *
   * Every percussive voice here is noise through a filter, and allocating a buffer per shot is
   * how a game with fifteen rifles allocates fifteen buffers per volley.
   */
  const noiseBuffer = (ctx: AudioContext): AudioBuffer => {
    if (noise) return noise
    const frames = Math.floor(ctx.sampleRate)
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // A fixed, self-contained LCG rather than `Math.random`: the noise is the same every run, so
    // two recordings of the same battle sound identical. Nothing here can reach the `spawn`,
    // `cards` or `names` streams (§1.17) — this is a display-side generator with its own seed.
    let seed = 0x9e3779b9
    for (let index = 0; index < frames; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      data[index] = (seed / 0xffffffff) * 2 - 1
    }
    noise = buffer
    return buffer
  }

  const ready = (): AudioContext | null => {
    if (disposed || !on || !context || !master) return null
    if (context.state !== 'running') return null
    return context
  }

  /** A filtered burst of noise: every impact sound on the board is one of these. */
  const burst = (
    ctx: AudioContext,
    at: number,
    options: {
      duration: number
      gain: number
      type: BiquadFilterType
      frequency: number
      q?: number
      sweepTo?: number
    },
  ): void => {
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)
    source.playbackRate.value = 1
    const filter = ctx.createBiquadFilter()
    filter.type = options.type
    filter.frequency.setValueAtTime(options.frequency, at)
    if (options.sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.sweepTo), at + options.duration)
    }
    filter.Q.value = options.q ?? 1
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(options.gain, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration)
    source.connect(filter).connect(gain).connect(master!)
    // A random offset into the shared buffer, so two shots in the same frame are not the same
    // sample twice — which is audible as a flange rather than as two rifles.
    source.start(at, (at * 37) % 0.9, options.duration + 0.02)
    source.stop(at + options.duration + 0.02)
  }

  /** A pitched blip: the tones that are not impacts — the revive, the card, the verdicts. */
  const tone = (
    ctx: AudioContext,
    at: number,
    options: {
      duration: number
      gain: number
      from: number
      to?: number
      type?: OscillatorType
    },
  ): void => {
    const osc = ctx.createOscillator()
    osc.type = options.type ?? 'triangle'
    osc.frequency.setValueAtTime(options.from, at)
    if (options.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), at + options.duration)
    }
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(options.gain, at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration)
    osc.connect(gain).connect(master!)
    osc.start(at)
    osc.stop(at + options.duration + 0.02)
  }

  /**
   * One blow, as a sound.
   *
   * `strength01` is the fraction of the target's health the blow took, and it is the ONLY thing
   * that varies a voice — the same quantity the renderer scales its flash by, so an ear and an eye
   * are told the same thing about the same hit.
   */
  const playAction = (ctx: AudioContext, event: RenderActionEvent, at: number): void => {
    const strength = clamp01(event.strength01 ?? 0)
    switch (event.kind) {
      case 'shot':
        burst(ctx, at, { duration: 0.09, gain: 0.14 + strength * 0.1, type: 'bandpass', frequency: 1750, q: 1.1, sweepTo: 620 })
        break
      case 'melee':
        // Lower and shorter than a shot, with no crack: §액션 피드백 forbids a muzzle on a swing,
        // and the ear reads the same distinction the muzzle puff draws.
        burst(ctx, at, { duration: 0.13, gain: 0.17 + strength * 0.12, type: 'lowpass', frequency: 900, q: 0.8, sweepTo: 180 })
        break
      case 'blast':
        burst(ctx, at, { duration: 0.7, gain: 0.36, type: 'lowpass', frequency: 620, q: 0.7, sweepTo: 70 })
        tone(ctx, at, { duration: 0.5, gain: 0.16, from: 110, to: 34, type: 'sawtooth' })
        break
      case 'death':
        burst(ctx, at, { duration: 0.26, gain: 0.13, type: 'lowpass', frequency: 420, q: 0.6, sweepTo: 90 })
        break
      case 'revive':
        // UP, where everything else falls. It is the opposite of a death and it is the only
        // rising figure in the whole set, so it is recognisable without being loud.
        tone(ctx, at, { duration: 0.22, gain: 0.2, from: 392, to: 784 })
        tone(ctx, at + 0.1, { duration: 0.34, gain: 0.16, from: 587.33, to: 1174.66 })
        break
    }
  }

  const startBgm = (ctx: AudioContext): void => {
    if (bgm) return
    const gain = ctx.createGain()
    gain.gain.value = 0.0001
    gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.6)
    gain.connect(master!)

    const padGain = ctx.createGain()
    padGain.gain.value = 0.06
    const pad = ctx.createOscillator()
    pad.type = 'sawtooth'
    pad.frequency.value = BGM_FIFTH_HZ
    const padFilter = ctx.createBiquadFilter()
    padFilter.type = 'lowpass'
    padFilter.frequency.value = 220
    padFilter.Q.value = 3
    pad.connect(padGain).connect(padFilter).connect(gain)
    pad.start()

    const bassGain = ctx.createGain()
    bassGain.gain.value = 0.0001
    const bass = ctx.createOscillator()
    bass.type = 'triangle'
    bass.frequency.value = BGM_ROOT_HZ
    bass.connect(bassGain).connect(gain)
    bass.start()

    bgm = { gain, bass, pad, padGain, bassGain, nextBeatAt: ctx.currentTime, beat: 0 }
  }

  /**
   * Move the music with the board: the pulse tightens as enemies fill it, and the pad opens as the
   * squad thins.
   *
   * Both readings come off the snapshot the renderer just drew, so the music cannot describe a
   * board that is not on screen.
   */
  const driveBgm = (ctx: AudioContext, snapshot: RenderSnapshot): void => {
    if (!bgm) return
    let enemies = 0
    let friendlyDown = 0
    let friendlyStanding = 0
    for (const unit of snapshot.units) {
      if (unit.team === 'enemy') {
        if (unit.state !== 'dead') enemies += 1
        continue
      }
      if (unit.state === 'downed') friendlyDown += 1
      else if (unit.state !== 'dead') friendlyStanding += 1
    }
    const pressure = clamp01(enemies / BGM_PRESSURE_ENEMIES)
    const beatMs = BGM_MAX_BEAT_MS - (BGM_MAX_BEAT_MS - BGM_MIN_BEAT_MS) * pressure
    // A body on the ground is the loudest thing the music can say without a voice: the pad opens
    // and the fifth bends, so "someone is down" is audible with the eyes elsewhere (§1.11).
    const urgency = friendlyDown > 0 ? 1 : 0
    bgm.padGain.gain.setTargetAtTime(0.05 + urgency * 0.07 + pressure * 0.03, ctx.currentTime, 0.4)
    bgm.pad.frequency.setTargetAtTime(urgency ? BGM_FIFTH_HZ * 1.06 : BGM_FIFTH_HZ, ctx.currentTime, 0.6)
    // A squad down to its last few is a quieter board, not a busier one.
    const thin = friendlyStanding <= 4 ? 0.6 : 1
    bgm.gain.gain.setTargetAtTime(0.5 * thin, ctx.currentTime, 0.8)

    // Schedule the beats that fall inside the next second. Scheduling AHEAD rather than on the
    // frame is what keeps the pulse steady while frames jitter — a beat placed at `currentTime`
    // arrives whenever the frame did.
    const horizon = ctx.currentTime + 1
    while (bgm.nextBeatAt < horizon) {
      const at = Math.max(bgm.nextBeatAt, ctx.currentTime + 0.01)
      const strong = bgm.beat % 4 === 0
      bgm.bass.frequency.setValueAtTime(strong ? BGM_ROOT_HZ : BGM_ROOT_HZ * 1.5, at)
      bgm.bassGain.gain.cancelScheduledValues(at)
      bgm.bassGain.gain.setValueAtTime(0.0001, at)
      bgm.bassGain.gain.exponentialRampToValueAtTime(strong ? 0.5 : 0.28, at + 0.02)
      bgm.bassGain.gain.exponentialRampToValueAtTime(0.0001, at + (strong ? 0.34 : 0.2))
      bgm.beat += 1
      bgm.nextBeatAt = at + beatMs / 1000
    }
  }

  const stopBgm = (): void => {
    if (!bgm || !context) return
    const at = context.currentTime
    bgm.gain.gain.cancelScheduledValues(at)
    bgm.gain.gain.setValueAtTime(Math.max(0.0001, bgm.gain.gain.value), at)
    bgm.gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25)
    bgm.bass.stop(at + 0.3)
    bgm.pad.stop(at + 0.3)
    bgm = null
  }

  return {
    async resume(): Promise<void> {
      if (disposed || !on) return
      if (!context) {
        context = new Ctor()
        master = context.createGain()
        master.gain.value = MASTER_GAIN
        master.connect(context.destination)
      }
      if (context.state === 'suspended') await context.resume()
      if (context.state === 'running') startBgm(context)
    },

    playFrame(snapshot: RenderSnapshot): void {
      const ctx = ready()
      if (!ctx) return
      driveBgm(ctx, snapshot)

      // A frame that re-reads the same tick plays nothing. `snapshot()` drains its events, so this
      // only fires for the callers that read the board without stepping it — a test, a capture —
      // and playing a frame's volley twice is exactly what that would sound like.
      if (snapshot.tick === lastTick) return
      lastTick = snapshot.tick

      const events = snapshot.actionEvents
      if (!events || events.length === 0) return

      const spent: Partial<Record<RenderActionEvent['kind'], number>> = {}
      let total = 0
      const at = ctx.currentTime + 0.005
      for (const event of events) {
        if (total >= TOTAL_VOICE_BUDGET) break
        const used = spent[event.kind] ?? 0
        if (used >= VOICE_BUDGET[event.kind]) continue
        spent[event.kind] = used + 1
        total += 1
        // A few milliseconds apart, so a volley is a volley and not one thick click. The offset
        // comes from the position in the list rather than from a clock: the same frame sounds the
        // same way twice.
        playAction(ctx, event, at + total * 0.011)
      }
    },

    cue(name: CueName): void {
      const ctx = ready()
      if (!ctx) return
      const at = ctx.currentTime + 0.005
      switch (name) {
        case 'upgrade':
          tone(ctx, at, { duration: 0.18, gain: 0.18, from: 523.25 })
          tone(ctx, at + 0.09, { duration: 0.3, gain: 0.16, from: 783.99 })
          break
        case 'victory':
          tone(ctx, at, { duration: 0.3, gain: 0.2, from: 392 })
          tone(ctx, at + 0.14, { duration: 0.3, gain: 0.2, from: 523.25 })
          tone(ctx, at + 0.28, { duration: 0.7, gain: 0.22, from: 659.25 })
          break
        case 'defeat':
          tone(ctx, at, { duration: 0.5, gain: 0.2, from: 220, to: 138.59, type: 'sawtooth' })
          tone(ctx, at + 0.18, { duration: 0.9, gain: 0.16, from: 164.81, to: 98, type: 'sawtooth' })
          break
        case 'ui':
          tone(ctx, at, { duration: 0.07, gain: 0.12, from: 880 })
          break
      }
    },

    enabled(): boolean {
      return on
    },

    setEnabled(next: boolean): boolean {
      on = next
      if (!on) stopBgm()
      else if (context && context.state === 'running') startBgm(context)
      return on
    },

    dispose(): void {
      disposed = true
      stopBgm()
      void context?.close()
      context = null
      master = null
      noise = null
    },
  }
}
