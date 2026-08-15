import { describe, expect, test } from 'vitest'

import { createFixedStepAccumulator, FIXED_STEP_MS } from '../../src/core/simulation'

describe('fixed 30 Hz stepping', () => {
  test('runs at most five ticks per frame and drops overflow as an invalid sample', () => {
    const accumulator = createFixedStepAccumulator()
    let ticks = 0

    const frame = accumulator.advance(FIXED_STEP_MS * 9.5, () => {
      ticks += 1
    })

    expect(ticks).toBe(5)
    expect(frame).toEqual({ ticks: 5, alpha: 0, validSample: false, droppedTicks: 4 })
  })

  test('retains only the interpolation remainder for a valid frame', () => {
    const accumulator = createFixedStepAccumulator()
    let ticks = 0

    const frame = accumulator.advance(FIXED_STEP_MS * 2.5, () => {
      ticks += 1
    })

    expect(ticks).toBe(2)
    expect(frame.ticks).toBe(2)
    expect(frame.alpha).toBeCloseTo(0.5)
    expect(frame.validSample).toBe(true)
    expect(frame.droppedTicks).toBe(0)
  })

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite elapsed time %s without poisoning later frames',
    (elapsedMs) => {
      const accumulator = createFixedStepAccumulator()
      let ticks = 0

      expect(() => accumulator.advance(elapsedMs, () => (ticks += 1))).toThrow(
        'elapsedMs must be finite',
      )
      const recovered = accumulator.advance(FIXED_STEP_MS, () => (ticks += 1))

      expect(ticks).toBe(1)
      expect(recovered).toEqual({
        ticks: 1,
        alpha: 0,
        validSample: true,
        droppedTicks: 0,
      })
    },
  )
})
