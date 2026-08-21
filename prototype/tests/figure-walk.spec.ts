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
 * TWO CONTROLS SHARE THE BOARD, one per remaining third of the frame, and both must come back
 * byte-identical across the same two frames:
 *
 *   the STANDER  never moves, so it is §1.4's settle checked at the pixel. A unit inside the
 *                `ARRIVE_EPSILON` dead-band does not stride, or the jitter that rule exists to
 *                prevent is back as animation.
 *   the DOWNED   is shuffled exactly like the walker and is on its side. §4.5's fourth question
 *                is whether the player agonised over going back for someone, and it cannot be
 *                asked if a body waiting for rescue is jogging on the spot. Its stillness is
 *                also what proves the stander's stillness is not merely "nothing here moves".
 */

/** Half a stride cycle at the fixture's speed: 16 ticks x 0.0625 units of travel = 1.0. */
const HALF_CYCLE_TICKS = 16
/** Long enough for the two-tick facing steady state to converge (0.68^40 is about 3e-7). */
const SETTLE_TICKS = 40

test('walks the legs on the GPU, and neither a settled nor a downed body strides', async ({ page }) => {
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

    const WALKER_X = -9
    const STANDER_X = 0
    const DOWNED_X = 9
    // Alternating displacement, per tick. Over `ARRIVE_EPSILON` (0.004) by a wide margin, so the
    // authority-movement test the stride uses is satisfied, and at `STRIDE_FULL_STEP` so the
    // stride runs at full amplitude.
    const SHUFFLE = 0.0625

    const body = (id: number, x: number, state = 'idle') => ({
      id, kind: 'soldier', team: 'teal', squad: 'teal',
      x, y: 0, facingRadians: 0, radius: 0.45, hp01: state === 'downed' ? 0 : 1,
      fatigue01: 0, morale01: 1, state,
    })

    const frame = (tick: number) => ({
      tick,
      elapsedMs: tick * 33,
      units: [
        // The walker: back on its mark at every even tick, one step further along its cycle.
        body(1, WALKER_X + (tick % 2 === 0 ? 0 : SHUFFLE)),
        // First control: never moves at all.
        body(2, STANDER_X),
        // Second control: shuffled exactly like the walker, and on its side.
        body(3, DOWNED_X + (tick % 2 === 0 ? 0 : SHUFFLE), 'downed'),
      ],
      projectiles: [],
      effects: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 30, worldHeight: 18 },
      playArea: { centerX: 0, centerY: 0, worldWidth: 30, worldHeight: 18 },
      // Deliberately NOT the team these three are on: the active squad's ring pulses with the
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

    // WHERE THE WALKER'S BODY IS ON SCREEN, so the span the motion covers can be stated as a
    // fraction of the figure rather than guessed. The board is drawn once more with the walker
    // taken out of the snapshot, and every pixel that differs is a pixel the walker painted.
    const last = settleTicks + halfCycle * 2
    const empty = frame(last)
    renderer.render({ ...empty, units: empty.units.slice(1) }, 0)
    const without = grab()
    // Put the walker back, so the frame left on screen is the one the comparison was taken from.
    renderer.render(frame(last), 0)

    // One third of the frame per figure. The camera is fixed and the board is centred on the
    // origin, so the three bands hold exactly one body each.
    const third = Math.floor(width / 3)
    const compare = (a: Uint8Array, b: Uint8Array) => {
      let walker = 0
      let stander = 0
      let downed = 0
      let lowest = height
      let highest = 0
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4
          const delta = Math.abs(a[index]! - b[index]!)
            + Math.abs(a[index + 1]! - b[index + 1]!)
            + Math.abs(a[index + 2]! - b[index + 2]!)
          if (delta === 0) continue
          if (x < third) {
            walker += 1
            if (y < lowest) lowest = y
            if (y > highest) highest = y
          } else if (x < third * 2) {
            stander += 1
          } else {
            downed += 1
          }
        }
      }
      return { walker, stander, downed, lowest, highest }
    }

    const atHalfCycle = compare(first!, half!)
    const atFullCycle = compare(first!, full!)
    const painted = compare(full!, without)
    const drawCalls = renderer.collectMetrics().drawCalls
    renderer.dispose()
    host.remove()
    return { atHalfCycle, atFullCycle, painted, width, height, drawCalls }
  }, { halfCycle: HALF_CYCLE_TICKS, settleTicks: SETTLE_TICKS })

  const bodyRows = reading.painted.highest - reading.painted.lowest
  // How far up the body the motion runs, as a fraction of the body's own painted height.
  // `readPixels` counts rows from the BOTTOM of the frame, so a small number is near the feet.
  const startsAt = (reading.atHalfCycle.lowest - reading.painted.lowest) / bodyRows
  const endsAt = (reading.atHalfCycle.highest - reading.painted.lowest) / bodyRows
  console.log(
    `[walk] ${reading.width}x${reading.height} drawCalls=${reading.drawCalls}`
    + ` half-cycle: walker=${reading.atHalfCycle.walker} stander=${reading.atHalfCycle.stander}`
    + ` downed=${reading.atHalfCycle.downed} rows ${reading.atHalfCycle.lowest}..${reading.atHalfCycle.highest}`
    + ` | body rows ${reading.painted.lowest}..${reading.painted.highest} (${bodyRows}px)`
    + ` | motion spans ${(startsAt * 100).toFixed(0)}%..${(endsAt * 100).toFixed(0)}% of body height`
    + ` | full-cycle: walker=${reading.atFullCycle.walker} stander=${reading.atFullCycle.stander}`
    + ` downed=${reading.atFullCycle.downed}`,
  )

  // A shader that did not compile is the failure mode this test exists for, and three.js reports
  // it on the console rather than by throwing.
  expect(shaderErrors, shaderErrors.join('\n')).toEqual([])

  // THE WALK IS ON THE GPU. Same position, same facing, same light, same camera, same health —
  // the only thing that changed between these two frames is how far the authority has moved this
  // figure, and hundreds of pixels of it are drawn somewhere else. Every part of the pose lives
  // in the vertex shader, so a figure that merely slid answers 0 here.
  expect(reading.atHalfCycle.walker).toBeGreaterThan(150)

  // AND THE SETTLE IS TOO. The stander never moved, so its stride amplitude is zero at every
  // phase, and its third of the frame is identical to the byte across all three frames. This is
  // §1.4's dead-band checked where it actually matters — if a settled figure kept striding, the
  // jitter that rule exists to prevent would be back as animation.
  expect(reading.atHalfCycle.stander).toBe(0)
  expect(reading.atFullCycle.stander).toBe(0)

  // AND A BODY ON ITS SIDE IS STILL. The third figure was shuffled exactly as far as the walker,
  // so it is not sitting in the dead-band — it is toppled, and a toppled figure is posed at rest
  // whatever the authority did with it. §1.11's downed body has to read as needing help.
  expect(reading.atHalfCycle.downed).toBe(0)
  expect(reading.atFullCycle.downed).toBe(0)

  // AND IT IS A CYCLE, not a drift. One full `STRIDE_CYCLE_DISTANCE` of travel later the figure
  // is drawn as it was: the phase really is travel over that distance, with no clock in it. This
  // is the property the screenshot regression leans on, measured at the pixel.
  //
  // ONE PIXEL, not zero, and the reason is worth writing down rather than papering over. The
  // travelled distance IS summed, tick by tick, so thirty-two additions of 0.0625 come to 2 only
  // to within double-precision rounding; the phase after a full cycle differs from the phase
  // before it by around 1e-16 radians, and on this frame exactly one pixel falls the other side
  // of a rasterisation edge because of it. The stander and the downed body, whose sums are
  // untouched, come back at zero.
  expect(reading.atFullCycle.walker).toBeLessThanOrEqual(2)

  // THE MOTION REACHES THE FEET, which is what tells a stride from a rock.
  //
  // Be precise about what this does and does not show. The stride moves the WHOLE figure on
  // purpose — hips and knees swing, and the torso leans, rolls and twists on top of them — so the
  // changed pixels span nearly the body's whole height (measured: 13% to 93% of it), and this
  // test cannot attribute a given pixel to a given joint. What it CAN separate is the one failure
  // the shape of this animation had to avoid: a body-level bob or a rocking torso leaves the feet
  // planted, and the bottom of the figure would come back unchanged. It does not. The legs' own
  // travel — 0.42-0.49 world units of reach and 0.07-0.12 of lift, hips in opposition, knees
  // bending one way only — is measured joint by joint in `tests/figure-rig.test.ts`.
  expect(bodyRows).toBeGreaterThan(30)
  expect(startsAt).toBeLessThan(0.3)
  expect(endsAt).toBeGreaterThan(0.5)
})
