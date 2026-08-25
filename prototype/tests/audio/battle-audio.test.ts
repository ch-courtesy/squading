// What can be tested about sound without listening to it.
//
// Three things, and they are the three that have gone wrong in real games: the audio path reaches
// into the simulation, a volley of fifteen rifles starts fifteen voices, and the whole thing
// throws in an environment with no `AudioContext`. None of them need an ear.

import { describe, expect, it, vi } from 'vitest'

import { createBattleAudio } from '../../src/audio/battle-audio'
import type { RenderActionEvent, RenderSnapshot } from '../../src/core/types'

/**
 * A recording `AudioContext`, thin enough to be obviously a fake and complete enough that the
 * engine's real code path runs against it.
 *
 * Only two things are counted: how many sources were started (every impact voice is one) and how
 * many oscillators (every pitched voice is one). That is what "how many voices did this frame
 * start" means, and counting it is the only way to test the budget.
 */
function fakeContext(): { Ctor: unknown; started: () => number; oscillators: () => number } {
  let sources = 0
  let oscillators = 0
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  })
  const node = () => ({ connect: vi.fn(function (this: unknown, next: unknown) { return next }) })

  class FakeContext {
    state = 'running'
    currentTime = 0
    sampleRate = 48000
    destination = node()
    createGain() {
      return { ...node(), gain: param() }
    }
    createBiquadFilter() {
      return { ...node(), type: 'lowpass', frequency: param(), Q: param() }
    }
    createBufferSource() {
      return {
        ...node(),
        buffer: null,
        playbackRate: param(),
        start: vi.fn(() => { sources += 1 }),
        stop: vi.fn(),
      }
    }
    createOscillator() {
      return {
        ...node(),
        type: 'sine',
        frequency: param(),
        start: vi.fn(() => { oscillators += 1 }),
        stop: vi.fn(),
      }
    }
    createBuffer(_channels: number, frames: number) {
      const data = new Float32Array(frames)
      return { getChannelData: () => data }
    }
    async resume() {
      this.state = 'running'
    }
    async close() {}
  }

  return { Ctor: FakeContext, started: () => sources, oscillators: () => oscillators }
}

/**
 * `async`, and the `await` is the point.
 *
 * A synchronous version returns the body's PROMISE and runs its `finally` immediately — so the
 * global is restored while the test is still awaiting inside it. The engine happens to capture the
 * constructor at creation, so the tests passed anyway; what they did NOT do is leave the global in
 * a known state between them, and one run in the suite came back with a failure that did not
 * reproduce. Restoring after the body has finished is the difference.
 */
async function withFakeAudio(
  body: (fake: ReturnType<typeof fakeContext>) => Promise<void> | void,
): Promise<void> {
  const fake = fakeContext()
  const holder = globalThis as { AudioContext?: unknown }
  const previous = holder.AudioContext
  holder.AudioContext = fake.Ctor
  try {
    await body(fake)
  } finally {
    if (previous === undefined) delete holder.AudioContext
    else holder.AudioContext = previous
  }
}

function action(kind: RenderActionEvent['kind'], targetId: number): RenderActionEvent {
  return {
    kind,
    tick: 100,
    sourceId: 1,
    sourceX: 0,
    sourceY: 0,
    targetId,
    targetX: 1,
    targetY: 1,
    strength01: 0.4,
  }
}

function snapshot(events: readonly RenderActionEvent[], tick = 100): RenderSnapshot {
  return {
    tick,
    elapsedMs: tick * 33,
    units: [],
    projectiles: [],
    effects: [],
    camera: { centerX: 0, centerY: 0, worldWidth: 56, worldHeight: 32 },
    actionEvents: events,
  }
}

describe('the board’s sound', () => {
  it('is silent, and does not throw, where there is no AudioContext', () => {
    const holder = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown }
    const previous = holder.AudioContext
    const previousWebkit = holder.webkitAudioContext
    delete holder.AudioContext
    delete holder.webkitAudioContext
    try {
      const audio = createBattleAudio()
      // Every verb, in the order a shell calls them. The point is that none of them throws: the
      // vitest run and the capture harness both live here, and a shell that had to null-check
      // would eventually forget one.
      expect(audio.enabled()).toBe(false)
      expect(() => audio.playFrame(snapshot([action('shot', 2)]))).not.toThrow()
      expect(() => audio.cue('victory')).not.toThrow()
      expect(() => audio.dispose()).not.toThrow()
    } finally {
      if (previous !== undefined) holder.AudioContext = previous
      if (previousWebkit !== undefined) holder.webkitAudioContext = previousWebkit
    }
  })

  it('starts nothing before the gesture that resumes it', async () => {
    await withFakeAudio(async (fake) => {
      const audio = createBattleAudio()
      audio.playFrame(snapshot([action('shot', 2), action('melee', 3)]))
      // The autoplay rule is not an edge case: a context that was never resumed is `suspended`
      // and silent, so a frame played before it is a frame nobody hears. Making that a no-op is
      // what keeps the budget arithmetic below honest about the first audible frame.
      expect(fake.started()).toBe(0)
      await audio.resume()
      audio.playFrame(snapshot([action('shot', 2)], 101))
      expect(fake.started()).toBeGreaterThan(0)
      audio.dispose()
    })
  })

  it('thins a volley instead of starting a voice per shot', async () => {
    await withFakeAudio(async (fake) => {
      const audio = createBattleAudio()
      await audio.resume()
      const before = fake.started()
      // Fifteen rifles inside one frame is the MEASURED normal — the renderer caps its muzzle
      // puffs for the same reason. Without a budget this is fifteen simultaneous noise bursts,
      // which is not a volley, it is static.
      audio.playFrame(snapshot(Array.from({ length: 15 }, (_, index) => action('shot', index + 2)), 200))
      const voices = fake.started() - before
      expect(voices).toBeGreaterThan(0)
      expect(voices).toBeLessThanOrEqual(3)
      audio.dispose()
    })
  })

  it('holds a total budget across kinds, not only per kind', async () => {
    await withFakeAudio(async (fake) => {
      const audio = createBattleAudio()
      await audio.resume()
      const before = fake.started() + fake.oscillators()
      const events: RenderActionEvent[] = []
      for (let index = 0; index < 12; index += 1) {
        events.push(
          action('shot', index + 2),
          action('melee', index + 40),
          action('death', index + 80),
          // The per-kind caps sum to 14 (3+3+4+3+1), so a frame that touches EVERY kind is the
          // only one where the total binds — measured: with only three kinds in this list the
          // budget is nine and `scripts/mutate.mjs`'s "drop the total voice budget" was MISSED.
          action('blast', index + 120),
          action('revive', index + 160),
        )
      }
      audio.playFrame(snapshot(events, 300))
      // NODES, not events: a blast is a burst AND a tone, a revive is two tones, so ten events
      // are thirteen nodes here. What the number bounds is the frame, and the comparison that
      // matters is with the ungoverned one — without the total budget the same list plays all
      // fourteen per-kind slots and starts nineteen. Measured both ways; `scripts/mutate.mjs`'s
      // "drop the total voice budget" is what holds the gap open.
      expect(fake.started() + fake.oscillators() - before).toBeLessThanOrEqual(13)
      audio.dispose()
    })
  })

  it('plays the same frame once, however many times it is read', async () => {
    await withFakeAudio(async (fake) => {
      const audio = createBattleAudio()
      await audio.resume()
      const board = snapshot([action('death', 2)], 400)
      audio.playFrame(board)
      const afterFirst = fake.started()
      audio.playFrame(board)
      // `snapshot()` on the controller DRAINS its events, so a second read of the same tick is a
      // read from outside the loop — a test, the capture harness. Sounding it again would play
      // every blow of that tick twice.
      expect(fake.started()).toBe(afterFirst)
      audio.dispose()
    })
  })

  it('goes quiet on demand and comes back', async () => {
    await withFakeAudio(async (fake) => {
      const audio = createBattleAudio()
      await audio.resume()
      expect(audio.setEnabled(false)).toBe(false)
      const muted = fake.started()
      audio.playFrame(snapshot([action('shot', 2)], 500))
      audio.cue('victory')
      expect(fake.started()).toBe(muted)

      expect(audio.setEnabled(true)).toBe(true)
      audio.playFrame(snapshot([action('shot', 2)], 501))
      expect(fake.started()).toBeGreaterThan(muted)
      audio.dispose()
    })
  })
})
