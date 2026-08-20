import { expect, test } from '@playwright/test'

/**
 * DOES THE WALK REACH THE SCREEN?
 *
 * `tests/figure-rig.test.ts` pins the pose maths, but the pose is applied in a VERTEX SHADER —
 * every joint matrix is a uniform and every limb is moved on the GPU, because the spec's four
 * meshes a unit leave no room for a limb to become a fifth. So the maths being right proves
 * nothing about what is drawn: a shader that failed to compile, an attribute that never got
 * bound, a uniform wired to the wrong material, all of them leave a board of figures sliding
 * about in the sculpted pose and every headless test still green.
 *
 * This reads the framebuffer instead.
 *
 * THE FIXTURE IS BUILT SO THAT THE POSE IS THE ONLY DIFFERENCE BETWEEN TWO FRAMES. One figure is
 * driven back and forth over 0.0625 world units on alternate ticks: at every even tick it is at
 * exactly the same place, facing the same way (the facing chase has long since settled into its
 * two-tick steady state), with the same health, the same ring, the same camera — and a stride
 * phase that has advanced, because the phase is driven by DISTANCE COVERED and it covered
 * 0.125 units every two ticks. Sixteen ticks apart is one full unit of travel, which is exactly
 * half a stride cycle: the legs are swapped.
 *
 * A second figure stands still on the other side of the board as the control. Its half of the
 * frame must come back byte-identical across the same two frames — which is both the proof that
 * nothing else in the scene is moving, and §1.4's settle checked at the pixel: a unit inside the
 * `ARRIVE_EPSILON` dead-band does not stride.
 */

/** Half a stride cycle at the fixture's speed: 16 ticks x 0.0625 units of travel = 1.0. */
const HALF_CYCLE_TICKS = 16
/** Long enough for the two-tick facing steady state to converge (0.68^40 is about 3e-7). */
const SETTLE_TICKS = 40

test('walks the legs on the GPU: the drawn pixels follow the stride phase, and a settled figure does not', async ({ page }) => {
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
  const shaderErrors: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/shader|program|GLSL/i.test(text) && /error|fail/i.test(text)) shaderErrors.push(text)
  })

  const reading = await page.evaluate(async ({ halfCycle, settleTicks }) => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const host = document.createElement('div')
    host.style.cssText = 'width:960px;height:600px'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)
    const canvas = host.querySelector('canvas') as HTMLCanvasElement
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext

    const WALKER_X = -6
    const STANDER_X = 6
    // Alternating displacement, per tick. Over `ARRIVE_EPSILON` (0.004) by a wide margin, so the
    // authority-movement test the stride uses is satisfied, and at `STRIDE_FULL_STEP` so the
    // stride runs at full amplitude.
    const SHUFFLE = 0.0625

    const body = (id: number, x: number) => ({
      id, kind: 'soldier', team: 'teal', squad: 'teal',
      x, y: 0, facingRadians: 0, radius: 0.45, hp01: 1, fatigue01: 0, morale01: 1,
      state: 'idle' as const,
    })

    const frame = (tick: number) => ({
      tick,
      elapsedMs: tick * 33,
      units: [
        // The walker: back on its mark at every even tick, one step further along its cycle.
        body(1, WALKER_X + (tick % 2 === 0 ? 0 : SHUFFLE)),
        // The control: never moves at all.
        body(2, STANDER_X),
      ],
      projectiles: [],
      effects: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 30, worldHeight: 18 },
      playArea: { centerX: 0, centerY: 0, worldWidth: 30, worldHeight: 18 },
      // Deliberately NOT the team these two are on: the active squad's ring pulses with the
      // tick, and a pulsing ring would be a difference that is not the legs.
      activeSquad: 'scarlet' as const,
    })

    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const grab = (): Uint8Array => {
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return pixels
    }

    let first: Uint8Array | null = null
    let half: Uint8Array | null = null
    let full: Uint8Array | null = null
    for (let tick = 0; tick <= settleTicks + halfCycle * 2; tick += 1) {
      renderer.render(frame(tick), 0)
      if (tick === settleTicks) first = grab()
      if (tick === settleTicks + halfCycle) half = grab()
      if (tick === settleTicks + halfCycle * 2) full = grab()
    }

    // Left half of the frame is the walker, right half the control. The camera is fixed and the
    // board is centred on the origin, so the split is exact.
    const split = Math.floor(width / 2)
    const compare = (a: Uint8Array, b: Uint8Array) => {
      let left = 0
      let right = 0
      let lowest = height
      let highest = 0
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4
          const delta = Math.abs(a[index]! - b[index]!)
            + Math.abs(a[index + 1]! - b[index + 1]!)
            + Math.abs(a[index + 2]! - b[index + 2]!)
          if (delta === 0) continue
          if (x < split) {
            left += 1
            if (y < lowest) lowest = y
            if (y > highest) highest = y
          } else {
            right += 1
          }
        }
      }
      return { left, right, lowest, highest }
    }

    const atHalfCycle = compare(first!, half!)
    const atFullCycle = compare(first!, full!)
    const drawCalls = renderer.collectMetrics().drawCalls
    renderer.dispose()
    host.remove()
    return { atHalfCycle, atFullCycle, width, height, drawCalls }
  }, { halfCycle: HALF_CYCLE_TICKS, settleTicks: SETTLE_TICKS })

  console.log(
    `[walk] ${reading.width}x${reading.height} drawCalls=${reading.drawCalls}`
    + ` half-cycle: walker=${reading.atHalfCycle.left} control=${reading.atHalfCycle.right}`
    + ` rows ${reading.atHalfCycle.lowest}..${reading.atHalfCycle.highest}`
    + ` | full-cycle: walker=${reading.atFullCycle.left} control=${reading.atFullCycle.right}`,
  )

  // A shader that did not compile is the failure mode this test exists for, and three.js reports
  // it on the console rather than by throwing.
  expect(shaderErrors, shaderErrors.join('\n')).toEqual([])

  // THE WALK IS ON THE GPU. Same position, same facing, same light, same camera, same health —
  // the only thing that changed between these two frames is how far the authority has moved this
  // figure, and a couple of hundred pixels of it are drawn somewhere else. Every part of the
  // pose lives in the vertex shader, so a figure that merely slid answers 0 here.
  expect(reading.atHalfCycle.left).toBeGreaterThan(150)

  // AND THE SETTLE IS TOO. The control figure never moved, so its stride amplitude is zero at
  // every phase, and its half of the frame is identical to the byte across all three frames.
  // This is §1.4's dead-band checked where it actually matters — if a settled figure kept
  // striding, the jitter that rule exists to prevent would be back as animation.
  expect(reading.atHalfCycle.right).toBe(0)
  expect(reading.atFullCycle.right).toBe(0)

  // AND IT IS A CYCLE, not a drift. One full `STRIDE_CYCLE_DISTANCE` of travel later the figure
  // is drawn byte for byte as it was: the phase really is travel over that distance, with no
  // accumulator and no clock in it. This is the same property the screenshot regression and
  // §4.3's replay agreement lean on, measured at the pixel.
  expect(reading.atFullCycle.left).toBe(0)
})
