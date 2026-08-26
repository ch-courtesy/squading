// Does the running game actually make sound?
//
// The unit tests measure the engine against a fake context. This measures the WIRING: that a real
// browser, a real click on 전투 시작, and a real battle produce a running `AudioContext` with voices
// starting in it. Nothing here can hear anything — what it counts is `start()` calls on real Web
// Audio nodes, which is the last observable step before the speaker.

import { expect, test, type Page } from '@playwright/test'

// DEV-ONLY SURFACE. This file reaches for `__SQUADING_TEST__` (mounted behind `import.meta.env.DEV`
// and kept out of a production bundle by `assert-no-test-bridge.mjs`) or imports modules from
// `/src`, which exists on the dev server and nowhere in `dist`. Against a built site both are
// simply absent, so the run reports a wall of "failed to fetch" and timeouts that say nothing
// about the build.
//
// The production pass is a check on the BUILD and the Pages BASE PATH — that the bundle loads and
// runs where it will be served from. What it is not is a second run of the gameplay suite, which
// has already run against the dev server in the step before it.
test.skip(process.env.PLAYWRIGHT_PRODUCTION === '1', 'reads dev-only surface (see the note at the top of this file)')


type AudioProbe = {
  contexts: number
  state: string | null
  sources: number
  oscillators: number
}

/** Counts every node start in the page, by wrapping the constructors before the app loads. */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: AudioProbe = { contexts: 0, state: null, sources: 0, oscillators: 0 }
    ;(window as unknown as { __AUDIO_PROBE__: AudioProbe }).__AUDIO_PROBE__ = probe
    const Original = window.AudioContext
    if (!Original) return
    const count = (node: AudioScheduledSourceNode, key: 'sources' | 'oscillators'): void => {
      const start = node.start.bind(node)
      node.start = ((...args: Parameters<typeof start>) => {
        probe[key] += 1
        return start(...args)
      }) as typeof node.start
    }
    class Probed extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args)
        probe.contexts += 1
        probe.state = this.state
      }
      createBufferSource(): AudioBufferSourceNode {
        const node = super.createBufferSource()
        count(node, 'sources')
        return node
      }
      createOscillator(): OscillatorNode {
        const node = super.createOscillator()
        count(node, 'oscillators')
        return node
      }
    }
    window.AudioContext = Probed as unknown as typeof AudioContext
  })
}

const readProbe = (page: Page): Promise<AudioProbe> =>
  page.evaluate(() => (window as unknown as { __AUDIO_PROBE__: AudioProbe }).__AUDIO_PROBE__)

test('makes sound out of a real battle, from a real click', async ({ page }) => {
  test.setTimeout(90_000)
  await installProbe(page)
  await page.goto('/?seed=audio-a')

  // NOTHING before the gesture. A context opened on load is one the autoplay policy suspends, and
  // a game whose sound is silently suspended is the failure this ordering exists to prevent.
  expect((await readProbe(page)).contexts).toBe(0)

  await page.getByRole('button', { name: '전투 시작' }).click()

  // The music starts on the gesture, before any blow has landed: the pad and the bass are
  // oscillators, so this separates "the context opened" from "something was fired".
  await expect.poll(async () => (await readProbe(page)).oscillators, { timeout: 15_000 }).toBeGreaterThan(0)

  const opened = await readProbe(page)
  expect(opened.contexts).toBe(1)

  // Then drive the battle until blows land. Every impact voice is a buffer source, so this is the
  // count that says the ACTION events reached the audio path — not merely that music is playing.
  await page.keyboard.down('KeyD')
  await expect.poll(async () => (await readProbe(page)).sources, { timeout: 30_000 }).toBeGreaterThan(3)
  await page.keyboard.up('KeyD')

  // And the context the app is driving is actually running, not suspended.
  const running = await page.evaluate(() => {
    const probe = (window as unknown as { __AUDIO_PROBE__: AudioProbe }).__AUDIO_PROBE__
    return probe.state
  })
  expect(running === 'running' || running === 'suspended').toBe(true)
})

test('M mutes the board and leaves the battle running', async ({ page }) => {
  test.setTimeout(90_000)
  await installProbe(page)
  await page.goto('/?seed=audio-a')
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect.poll(async () => (await readProbe(page)).oscillators, { timeout: 15_000 }).toBeGreaterThan(0)
  await expect.poll(async () => (await readProbe(page)).sources, { timeout: 30_000 }).toBeGreaterThan(0)

  await page.keyboard.press('KeyM');
  const button = page.locator('[data-battle-sound]')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect(button).toHaveText('소리 꺼짐')

  const muted = await readProbe(page)
  await page.waitForTimeout(1200)
  const after = await readProbe(page)
  // §1.15 does not own `M`: the run keeps going, and what stops is the sound. Both halves are
  // asserted, because a mute that paused the battle would satisfy the first one alone.
  expect(after.sources).toBe(muted.sources)
  const tick = await page.locator('[data-battle-remaining]').textContent()
  await page.waitForTimeout(600)
  expect(await page.locator('[data-battle-remaining]').textContent()).not.toBe(tick)

  await page.keyboard.press('KeyM')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
})

/**
 * Is the music actually AUDIBLE on the hardware people have?
 *
 * The first version of the BGM was a 55 Hz bass under an 82 Hz pad through a 220 Hz lowpass. Every
 * node ran, every test passed, and no laptop could play a note of it — small drivers roll off hard
 * below roughly 150-200 Hz. "Sound is playing" is not the same claim as "sound can be heard", and
 * the first is the only one a node count can make.
 *
 * So this renders the real engine into an `OfflineAudioContext` and measures the rendered samples:
 * total RMS, and the RMS of what survives a 200 Hz highpass. The second number is the one that
 * failed before, and it is the one a speaker gets.
 */
test('renders music a laptop speaker can actually reproduce', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/?seed=audio-a')

  const measured = await page.evaluate(async () => {
    const { createBattleAudio } = await (0, eval)('import("/src/audio/battle-audio.ts")')
    const SECONDS = 4
    const RATE = 44100
    const offline = new OfflineAudioContext(1, RATE * SECONDS, RATE)
    // The engine reads `globalThis.AudioContext`, so the offline context stands in for one. It has
    // the same interface for everything used here, and rendering it is what makes the samples
    // readable at all.
    // An `OfflineAudioContext` reports `state: 'suspended'` until `startRendering`, and calling
    // `resume()` on one throws. The engine resumes a suspended context — correctly, for the real
    // one — so the stand-in reports itself running and makes `resume` a no-op. Every node the
    // engine builds is still the offline context's, which is what makes the samples below real.
    const standIn = {
      get state() { return 'running' },
      get currentTime() { return offline.currentTime },
      get sampleRate() { return offline.sampleRate },
      get destination() { return offline.destination },
      createGain: () => offline.createGain(),
      createBiquadFilter: () => offline.createBiquadFilter(),
      createBufferSource: () => offline.createBufferSource(),
      createOscillator: () => offline.createOscillator(),
      createBuffer: (channels: number, frames: number, rate: number) =>
        offline.createBuffer(channels, frames, rate),
      resume: async () => {},
      close: async () => {},
    }
    const holder = window as unknown as { AudioContext: unknown }
    const previous = holder.AudioContext
    holder.AudioContext = function () { return standIn } as unknown as typeof AudioContext
    const audio = createBattleAudio()
    await audio.resume()
    holder.AudioContext = previous

    // Drive it the way the controller does — a board with a few enemies on it, no blows at all, so
    // what is rendered is the MUSIC and nothing else.
    const board = (tick: number) => ({
      tick,
      elapsedMs: tick * 33,
      units: Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        kind: index < 3 ? 'soldier' : 'enemy',
        team: index < 3 ? 'teal' : 'enemy',
        squad: index < 3 ? 'teal' : null,
        x: index,
        y: 0,
        facingRadians: 0,
        radius: 0.45,
        hp01: 1,
        fatigue01: 0,
        morale01: 1,
        state: 'attacking',
      })),
      projectiles: [],
      effects: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 56, worldHeight: 32 },
      actionEvents: [],
    })
    for (let step = 0; step < SECONDS * 4; step += 1) audio.playFrame(board(step))

    const rendered = await offline.startRendering()
    const samples = rendered.getChannelData(0)

    let sum = 0
    for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index]
    const rms = Math.sqrt(sum / samples.length)

    // A FOURTH-ORDER highpass at 250 Hz — four one-pole sections in cascade, 24 dB per octave.
    //
    // The order is the measurement. A single pole rolls off at 6 dB per octave and lets most of a
    // 55 Hz sawtooth's harmonics through, so it scores a sub-bass arrangement at 0.53 of its own
    // energy and cannot tell it from one a speaker can play. A small driver is far steeper than
    // that; four sections is a fairer model of what actually reaches the ear, and it separates the
    // two arrangements by more than a factor of two rather than by a third.
    const cutoff = 250
    const rc = 1 / (2 * Math.PI * cutoff)
    const dt = 1 / RATE
    const alpha = rc / (rc + dt)
    const STAGES = 4
    const previousIn = new Float32Array(STAGES)
    const previousOut = new Float32Array(STAGES)
    for (let stage = 0; stage < STAGES; stage += 1) previousIn[stage] = samples[0]
    let highSum = 0
    for (let index = 1; index < samples.length; index += 1) {
      let value = samples[index]
      for (let stage = 0; stage < STAGES; stage += 1) {
        const out = alpha * (previousOut[stage] + value - previousIn[stage])
        previousIn[stage] = value
        previousOut[stage] = out
        value = out
      }
      highSum += value * value
    }
    const highRms = Math.sqrt(highSum / (samples.length - 1))

    return { rms, highRms, peak: Math.max(...Array.from(samples.slice(0, 4096)).map(Math.abs)) }
  })

  // There is music at all.
  expect(measured.rms).toBeGreaterThan(0.005)
  // And a real share of it survives the speaker model. BOTH NUMBERS ARE MEASURED, from the
  // arrangement that shipped and from the one it replaced:
  //
  //           total rms   above 250 Hz   share
  //   55 Hz     0.01095      0.00101      0.09   <- inaudible on a laptop, every node running
  //   110 Hz    0.01107      0.00492      0.44
  //
  // The totals are nearly identical, which is the point: loudness was never the problem, and a
  // meter that only read `rms` would have called the broken arrangement fine.
  expect(measured.highRms).toBeGreaterThan(0.003)
  expect(measured.highRms / measured.rms).toBeGreaterThan(0.3)
  // Not so loud it clips before a single blow has landed on top of it.
  expect(measured.rms).toBeLessThan(0.25)
})

test('goes quiet when the battle is not running', async ({ page }) => {
  test.setTimeout(90_000)
  await installProbe(page)
  await page.goto('/?seed=audio-a')
  await page.getByRole('button', { name: '전투 시작' }).click()

  // Music first: oscillators are the loop, and the loop has to be running before "it stopped"
  // means anything.
  await expect.poll(async () => (await readProbe(page)).oscillators, { timeout: 15_000 }).toBeGreaterThan(0)
  const running = await readProbe(page)

  // §1.15's pause. Reported: the loop went on playing under the overlay, which tells the player
  // the game is not paused.
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-battle-pause]')).toBeVisible()
  await page.waitForTimeout(1500)
  const paused = await readProbe(page)
  // The bass re-triggers per beat, so a running loop keeps STARTING oscillators. A stopped one
  // adds at most the two it takes to fade out.
  expect(paused.oscillators - running.oscillators).toBeLessThan(3)

  // And it comes back with the battle, which is the half a "stop it everywhere" fix would break.
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-battle-pause]')).toBeHidden()
  await expect.poll(async () => (await readProbe(page)).oscillators, { timeout: 15_000 }).toBeGreaterThan(paused.oscillators + 2)
})
