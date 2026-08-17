// I9 — "terrain supports cover independently of policy" (§3).
//
//   자유 공간 균등 표본에서 진형 16명 전원에게 시야가 없는 사수 위치 비율이
//   평균 >= 15%, 최선(표본 40 중 최대) >= 35%
//
// Read literally that has two nested samples, and this module makes both of them
// explicit because four rounds of review died on unstated measurement choices:
//
//   OUTER — a command-unit position drawn uniformly from free space (inside the
//   arena, not inside movement-blocking high cover). 40 of them, per §3's
//   "표본 40". Each one produces one blocking ratio.
//
//   INNER — for a fixed command-unit position, the 16 formation bodies are placed
//   (§1.4, slot pull included) and shooter positions are drawn uniformly from the
//   set of positions a shooter could actually shoot from:
//       * inside the arena,
//       * not inside high cover (it cannot stand there — §1.6),
//       * with at least one formation member inside SHOOTER_RANGE.
//   That last clause is the whole reason SHOOTER_RANGE is an axis: without it,
//   "no one visible" would be dominated by positions on the far side of the map
//   where nobody is in range either, and the ratio would approach 1 for free.
//   A shooter position counts as BLOCKED when no member is simultaneously in
//   range and in line of sight — exactly I7's "denied opportunity", minus the
//   cooldown clause.
//
// ARCHIVED (§2 폐기 기록, §5 stage 1). Cover was removed from the design: the game has no
// terrain, no sight and no I9. This module stays in the repository as the measurement that
// justified that removal — binary blocking cleared 0 of 504 cells — and it must keep
// running, so `sight.ts` next door keeps the two sight rules it was measured with. Nothing
// under `core/battle/` may import any of it.
//
// SIGHT — the default is `hasBattleSight`, the rule the game had when this last ran
// (§1.6's endpoint exemption included). That was not true when stage 1 FIRST ran:
// §1.6's "선분의 끝점이 어떤 사각형 내부에 있으면 그 사각형은 그 선분을 막지 않는다" was
// added to the spec AFTER the sweep, and the sweep was measuring `hasLineOfSight`,
// which blocks a segment whose endpoint sits inside a rectangle. While cover still
// existed, §4.3's replay contract meant the harness and the game had to agree about
// sight, so `'battle'` became the default and the only mode a gate could be read from.
//
//   `sightMode: 'legacy'` reproduces the pre-exemption measurement, and exists for
//   exactly one purpose: comparing a new run against the numbers in the stage-1 report
//   that was recorded before the rule existed. Do not gate on it.
//
// The strict variant throws away shooter positions standing *inside* low cover. Under
// the legacy rule that was a correction: such a shooter was blind in every direction, so
// I9 rose with low-cover *area* rather than cover *geometry*, and the stage-1 report
// named the strict column as its prediction of what the exemption would produce. Under
// the battle rule it is no longer a correction — such a shooter can see out through its
// own rectangle — so it is now a plain diagnostic: "restricted to shooters not standing
// in cover". It is still reported, because the two together say whether blocking comes
// from geometry between the bodies or from bodies buried in terrain.
//
// Nothing here consumes the `terrain` stream: sampling uses its own named stream
// so that changing the sample budget cannot change the layout under test.

import { createPrng, type Prng } from '../prng'
import { resolveFormation } from '../gameplay/formation'
import { containsAny, hasLineOfSight, type Rect } from '../gameplay/geometry'
import { hasBattleSight } from './sight'
import { ARENA_HEIGHT, ARENA_WIDTH, type TerrainLayout } from '../gameplay/terrain'

export const I9_COMMANDER_SAMPLES = 40
export const I9_MEAN_THRESHOLD = 0.15
export const I9_BEST_THRESHOLD = 0.35

/**
 * `battle` — `hasBattleSight`, the endpoint-exempt rule cover was finally measured with.
 * `legacy` — `hasLineOfSight`, the pre-exemption rule the first stage-1 run used.
 *
 * Both are archived rules; neither is in the game (§1.6). The names are kept as they were
 * so the recorded artifacts keep reproducing.
 */
export type I9SightMode = 'battle' | 'legacy'

export const I9_DEFAULT_SIGHT_MODE: I9SightMode = 'battle'

type SightTest = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blockers: readonly Rect[],
) => boolean

export function sightTestFor(mode: I9SightMode): SightTest {
  return mode === 'legacy' ? hasLineOfSight : hasBattleSight
}

export type I9Options = {
  shooterRange: number
  /** §3 fixes this at 40; exposed only so tests can run cheap. */
  commanderSamples?: number
  shooterSamples?: number
  /** Defaults to `battle` — the rule the final cover measurement used. */
  sightMode?: I9SightMode
  /**
   * The max over 40 noisy estimates is biased upward. The top `refineTop` samples
   * are re-measured with `refineShooterSamples` shots and the max of those is
   * reported, which removes the selection bias (and errs low, never high).
   */
  refineTop?: number
  refineShooterSamples?: number
}

export type I9CenterResult = {
  center: { x: number; y: number }
  opportunities: number
  blocked: number
  ratio: number
  strictOpportunities: number
  strictBlocked: number
  strictRatio: number
}

export type I9Result = {
  shooterRange: number
  sightMode: I9SightMode
  commanderSamples: number
  shooterSamples: number
  meanBlocked: number
  bestBlocked: number
  meanBlockedStrict: number
  bestBlockedStrict: number
  /** Share of blocked positions that were standing inside low cover. */
  insideLowShare: number
  totalOpportunities: number
  perCenter: I9CenterResult[]
  meanPassed: boolean
  bestPassed: boolean
  passed: boolean
}

type Bounds = { x0: number; y0: number; x1: number; y1: number }

function clip(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function rectIntersectsBounds(rect: Rect, bounds: Bounds): boolean {
  return (
    rect.x < bounds.x1 &&
    rect.x + rect.width > bounds.x0 &&
    rect.y < bounds.y1 &&
    rect.y + rect.height > bounds.y0
  )
}

/** Uniform sample of free space: arena minus high cover. */
function sampleFreePoint(prng: Prng, blockers: readonly Rect[]): { x: number; y: number } {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const x = prng.range(0, ARENA_WIDTH)
    const y = prng.range(0, ARENA_HEIGHT)
    if (!containsAny(blockers, x, y)) return { x, y }
  }
  return { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 }
}

export function measureCenter(
  layout: TerrainLayout,
  centerX: number,
  centerY: number,
  shooterRange: number,
  shooterSamples: number,
  prng: Prng,
  sightMode: I9SightMode = I9_DEFAULT_SIGHT_MODE,
): I9CenterResult {
  const hasSight = sightTestFor(sightMode)
  const members = resolveFormation(centerX, centerY, layout.movementBlockers)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const member of members) {
    if (member.x < minX) minX = member.x
    if (member.y < minY) minY = member.y
    if (member.x > maxX) maxX = member.x
    if (member.y > maxY) maxY = member.y
  }

  const bounds: Bounds = {
    x0: clip(minX - shooterRange, 0, ARENA_WIDTH),
    y0: clip(minY - shooterRange, 0, ARENA_HEIGHT),
    x1: clip(maxX + shooterRange, 0, ARENA_WIDTH),
    y1: clip(maxY + shooterRange, 0, ARENA_HEIGHT),
  }

  // Only terrain that can sit between a shooter and a member matters.
  const sight = layout.sightBlockers.filter((rect) => rectIntersectsBounds(rect, bounds))
  const high = layout.movementBlockers.filter((rect) => rectIntersectsBounds(rect, bounds))
  const low = layout.low.filter((rect) => rectIntersectsBounds(rect, bounds))

  const rangeSquared = shooterRange * shooterRange
  const memberCount = members.length

  let opportunities = 0
  let blocked = 0
  let strictOpportunities = 0
  let strictBlocked = 0

  const maxDraws = shooterSamples * 500
  for (let draw = 0; draw < maxDraws && opportunities < shooterSamples; draw += 1) {
    const px = prng.range(bounds.x0, bounds.x1)
    const py = prng.range(bounds.y0, bounds.y1)
    if (containsAny(high, px, py)) continue

    let inRange = false
    let visible = false
    for (let index = 0; index < memberCount; index += 1) {
      const member = members[index]
      const dx = member.x - px
      const dy = member.y - py
      if (dx * dx + dy * dy > rangeSquared) continue
      inRange = true
      if (hasSight(px, py, member.x, member.y, sight)) {
        visible = true
        break
      }
    }
    if (!inRange) continue

    opportunities += 1
    const insideLow = containsAny(low, px, py)
    if (!insideLow) strictOpportunities += 1
    if (!visible) {
      blocked += 1
      if (!insideLow) strictBlocked += 1
    }
  }

  return {
    center: { x: centerX, y: centerY },
    opportunities,
    blocked,
    ratio: opportunities === 0 ? 0 : blocked / opportunities,
    strictOpportunities,
    strictBlocked,
    strictRatio: strictOpportunities === 0 ? 0 : strictBlocked / strictOpportunities,
  }
}

export function measureI9(layout: TerrainLayout, options: I9Options, prng: Prng): I9Result {
  const commanderSamples = options.commanderSamples ?? I9_COMMANDER_SAMPLES
  const shooterSamples = options.shooterSamples ?? 256
  const refineTop = options.refineTop ?? 3
  const refineShooterSamples = options.refineShooterSamples ?? shooterSamples * 8
  const sightMode = options.sightMode ?? I9_DEFAULT_SIGHT_MODE

  const perCenter: I9CenterResult[] = []
  for (let sample = 0; sample < commanderSamples; sample += 1) {
    const center = sampleFreePoint(prng, layout.movementBlockers)
    perCenter.push(
      measureCenter(layout, center.x, center.y, options.shooterRange, shooterSamples, prng, sightMode),
    )
  }

  let ratioSum = 0
  let strictSum = 0
  let totalOpportunities = 0
  let totalBlocked = 0
  let totalBlockedOutsideLow = 0
  for (const result of perCenter) {
    ratioSum += result.ratio
    strictSum += result.strictRatio
    totalOpportunities += result.opportunities
    totalBlocked += result.blocked
    totalBlockedOutsideLow += result.strictBlocked
  }

  // Re-measure the most promising centres so the "best of 40" figure is not a
  // maximum-of-noise artefact.
  const order = perCenter.map((result, index) => index).sort((a, b) => perCenter[b].ratio - perCenter[a].ratio)
  let bestBlocked = 0
  let bestBlockedStrict = 0
  for (let index = 0; index < Math.min(refineTop, order.length); index += 1) {
    const candidate = perCenter[order[index]]
    const refined = measureCenter(
      layout,
      candidate.center.x,
      candidate.center.y,
      options.shooterRange,
      refineShooterSamples,
      prng,
      sightMode,
    )
    if (refined.ratio > bestBlocked) bestBlocked = refined.ratio
    if (refined.strictRatio > bestBlockedStrict) bestBlockedStrict = refined.strictRatio
  }

  const meanBlocked = commanderSamples === 0 ? 0 : ratioSum / commanderSamples
  const meanPassed = meanBlocked >= I9_MEAN_THRESHOLD
  const bestPassed = bestBlocked >= I9_BEST_THRESHOLD

  return {
    shooterRange: options.shooterRange,
    sightMode,
    commanderSamples,
    shooterSamples,
    meanBlocked,
    bestBlocked,
    meanBlockedStrict: commanderSamples === 0 ? 0 : strictSum / commanderSamples,
    bestBlockedStrict,
    insideLowShare: totalBlocked === 0 ? 0 : (totalBlocked - totalBlockedOutsideLow) / totalBlocked,
    totalOpportunities,
    perCenter,
    meanPassed,
    bestPassed,
    passed: meanPassed && bestPassed,
  }
}

/** Sampling stream, deliberately distinct from the `terrain` stream. */
export function createI9Prng(seed: string): Prng {
  return createPrng(`${seed}:i9`)
}

export function measureI9ForSeed(layout: TerrainLayout, seed: string, options: I9Options): I9Result {
  return measureI9(layout, options, createI9Prng(seed))
}
