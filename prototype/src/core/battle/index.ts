// `core/battle/` — the v6 commander battle rules
// (`docs/superpowers/specs/2026-08-16-commander-battle-design.md`).
//
// This is a NEW module. `core/gameplay/` is the shipped v1 game and stays as it is;
// the geometry that both need (`gameplay/geometry.ts`, `gameplay/terrain.ts`,
// `gameplay/formation.ts`) is imported from there, never copied.
//
// ---------------------------------------------------------------------------
// Implemented — batch A
// ---------------------------------------------------------------------------
//   §1.1  arena, clock, 6-decimal digest normalization ......... constants, digest
//   §1.2  friendly anchors and the follow speed cap ............ constants
//   §1.4  slot table, settle dead-band, slot pull + latch ...... formation, movement
//   §1.6  ejection from movement-blocking terrain .............. movement
//   §1.7  x-then-y sliding .................................... movement
//   §1.14 name pool, one 23-draw shuffle, id-order assignment .. names, state
//   §1.17 four named streams and the full digest .............. streams, digest
//
// ---------------------------------------------------------------------------
// Seams — rules a later batch owns, and where each one plugs in
// ---------------------------------------------------------------------------
//   §1.3  move/fire exclusivity ....... read `unit.lastDisplacement`, which every
//                                      movement rule already writes, against
//                                      `MOVE_EPSILON`. Do not re-derive it from the
//                                      input: §1.3 judges displacement.
//   §1.5  succession .................. set `state.commandUnitId`; `originalCommanderId`
//                                      never changes. Zero `state.input.move` on
//                                      succession, keep `input.spaceHeld`. The slot
//                                      table must NOT be rebuilt (§1.4).
//   §1.8  target selection ............ `sightBlockers(state)` + `hasLineOfSight`.
//   §1.9  enemy movement .............. use `moveEnemyTowards` / `slideMove`; drive
//                                      `zeroDisplacementTicks`, `excludedTargetId`,
//                                      `contactSlotOwnerId`.
//   §1.10 spawning .................... `state.spawn` (backlog, three discard
//                                      counters, `nextEnemyId`); draw from the
//                                      `spawn` stream only. Call `ejectTrappedUnits`
//                                      after placement.
//   §1.11 rescue ...................... `state.rescue`; `advanceCommandUnit` already
//                                      refuses to move while `rescue.active`.
//   §1.12 elite ....................... `state.elite`; `spawn` stream.
//   §1.13 upgrades .................... `state.upgrades`; `cards` stream, exactly 3
//                                      draws per round.
//   §1.15 input queue ................. writes `state.input` only.
//   §1.16 the 16-step tick ............ steps 4 and 5 are `advanceCommandUnit` and
//                                      `advanceFormationFollow`, in that order.

export * from './constants'
export * from './digest'
export * from './formation'
export * from './movement'
export * from './names'
export * from './state'
export * from './streams'
export * from './types'
