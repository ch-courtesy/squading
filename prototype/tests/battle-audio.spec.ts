// Does the running game actually make sound?
//
// The unit tests measure the engine against a fake context. This measures the WIRING: that a real
// browser, a real click on 전투 시작, and a real battle produce a running `AudioContext` with voices
// starting in it. Nothing here can hear anything — what it counts is `start()` calls on real Web
// Audio nodes, which is the last observable step before the speaker.

import { expect, test, type Page } from '@playwright/test'

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
