// THE TEMPORARY FORMATION WIDENING — measurement scaffolding, NOT a §1.4 amendment.
//
// `FORMATION_SLOTS` holds fifteen offsets and §1.4 says a standing unit with no slot stays where
// it is. Above sixteen bodies the surplus would never form up, so a roster sweep run against the
// shipped table would not measure a bigger squad — it would measure a fifteen-body squad plus
// abandoned people. This module generates a wider table so the sweep can run at all.
//
// NOTHING HERE IS ADOPTED. How the lattice should actually grow is a §1.4 decision that drags
// camera framing (§4.4) and the leash radius (§1.4.1) behind it, and this file deliberately does
// not answer that question. It answers a narrower one: "what is the least opinionated widening
// that lets the measurement happen, and how much does the answer depend on it?" — which is why
// there are TWO schemes rather than one.
//
// ---------------------------------------------------------------------------
// THE TWO SCHEMES
// ---------------------------------------------------------------------------
//   'wide'   Same 1.1 lattice pitch, grown outward. Every body keeps the SPACING the shipped
//            fifteen have, so the local geometry each body experiences — how many neighbours an
//            elite AoE or a melee contact can reach at once — is unchanged. What grows is the
//            footprint: the squad's radius goes up, so more of it sits far from the command unit
//            that §1.4.1 anchors the leash to. This is the PRIMARY scheme.
//   'dense'  Same footprint, pitch scaled by `sqrt(15 / soldierCount)` so the area per body is
//            held constant against the shipped table. The formation radius barely moves, so
//            camera framing and the leash relation stay where they are — and the bodies pack
//            tighter, which is exactly the axis 'wide' holds fixed. Run as a SENSITIVITY CHECK:
//            if the two schemes disagree, the roster answer is a formation answer in disguise.
//
// BOTH REPRODUCE THE SHIPPED TABLE EXACTLY AT SIXTEEN BODIES. `sqrt(15/15)` is 1 and `i * 1.1`
// for `i` in -2..2 is bit-exact against the literals in `src/core/battle/formation.ts` (doubling
// and halving a float are exact, and 0 and 1 are identities), so the fifteen offsets come back
// byte-for-byte. That is what makes the ROSTER_SIZE=16 row of this sweep a REPRODUCTION of the
// tuning batch 3 numbers rather than a new measurement that merely resembles them — and if it
// ever stops reproducing them, the scaffolding is what changed, not the roster.

export type Slot = { x: number; y: number }

/** §1.4's pitch. The shipped table is this lattice at radius 2 in x and 1 in y, plus (0, 2). */
export const LATTICE_PITCH = 1.1

/**
 * The shipped fifteen, as LATTICE INDICES, in the shipped table's order.
 *
 * Kept as integer indices rather than metres so the generated table is `index * pitch` for every
 * entry — the shipped fifteen included. A generator that emitted the literals for the first
 * fifteen and computed the rest would hide a discontinuity at the seam.
 */
const CANONICAL_INDICES: readonly (readonly [number, number])[] = [
  [-2, -1],
  [-1, -1],
  [0, -1],
  [1, -1],
  [2, -1],
  [-2, 0],
  [-1, 0],
  [1, 0],
  [2, 0],
  [-2, 1],
  [-1, 1],
  [0, 1],
  [1, 1],
  [2, 1],
  [0, 2],
]

export const CANONICAL_SOLDIER_COUNT = CANONICAL_INDICES.length

/** How far out the candidate lattice is enumerated. Ring 8 holds 288 points; the sweep needs 63. */
const ENUMERATION_RADIUS = 8

/**
 * The slot ORDER, as lattice indices: the shipped fifteen first, then every other lattice point
 * by ascending distance from the command unit.
 *
 * THE SHIPPED FIFTEEN GO FIRST EVEN THOUGH THEY ARE NOT THE FIFTEEN NEAREST POINTS. The shipped
 * table is asymmetric — it holds (0, 2) but not (0, -2), both at distance 2.2 — so a pure
 * distance sort would reorder it and the sixteen-body row would stop reproducing. Prefixing the
 * table verbatim keeps that reproduction exact and confines the invention to the surplus.
 *
 * Ties inside the tail break by (y, x), which is the shipped table's own reading order.
 */
function slotOrder(): (readonly [number, number])[] {
  const used = new Set(CANONICAL_INDICES.map(([i, j]) => `${i},${j}`))
  const tail: (readonly [number, number])[] = []
  for (let i = -ENUMERATION_RADIUS; i <= ENUMERATION_RADIUS; i += 1) {
    for (let j = -ENUMERATION_RADIUS; j <= ENUMERATION_RADIUS; j += 1) {
      // §1.4.1 (v11) derives an engaged soldier's bearing from `normalize(slot offset)`, and
      // `constants.ts` asserts at module load that no slot is the zero vector. The origin is
      // where the command unit stands, so it is never a slot.
      if (i === 0 && j === 0) continue
      if (used.has(`${i},${j}`)) continue
      tail.push([i, j])
    }
  }
  tail.sort((left, right) => {
    const byRadius = Math.hypot(left[0], left[1]) - Math.hypot(right[0], right[1])
    if (byRadius !== 0) return byRadius
    if (left[1] !== right[1]) return left[1] - right[1]
    return left[0] - right[0]
  })
  return [...CANONICAL_INDICES, ...tail]
}

export type FormationScheme = 'wide' | 'dense'

/**
 * `soldierCount` slots under `scheme`. `soldierCount` is `rosterSize - 1`: §1.4's command unit is
 * the body without a slot.
 */
export function generateSlots(soldierCount: number, scheme: FormationScheme): Slot[] {
  if (soldierCount < 1) throw new Error('roster sweep: a formation needs at least one slot')
  const order = slotOrder()
  if (soldierCount > order.length) {
    throw new Error(`roster sweep: the lattice enumerates ${order.length} slots, asked ${soldierCount}`)
  }
  const pitch =
    scheme === 'dense'
      ? LATTICE_PITCH * Math.sqrt(CANONICAL_SOLDIER_COUNT / soldierCount)
      : LATTICE_PITCH
  return order.slice(0, soldierCount).map(([i, j]) => ({ x: i * pitch, y: j * pitch }))
}

export function maxSlotRadius(slots: readonly Slot[]): number {
  return Math.max(...slots.map((slot) => Math.hypot(slot.x, slot.y)))
}

/** The generated table as a TypeScript array literal, for the transform in the sweep config. */
export function slotsLiteral(slots: readonly Slot[]): string {
  const rows = slots.map((slot) => `  { x: ${slot.x}, y: ${slot.y} },`).join('\n')
  return `export const FORMATION_SLOTS: readonly FormationSlot[] = [\n${rows}\n]`
}
