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
// Implemented — batch B (no new `BattleState` field; nothing here is in the digest
// except through fields batch A already declared)
// ---------------------------------------------------------------------------
//   §1.3  move/fire exclusivity ................................ targeting, attacks
//         `isStopped` is the single stop test; step 6
//         (`advanceStep6Cooldowns`) freezes the cooldown of anything that moved and
//         step 9 (`resolveStep9FriendlyAttacks`) refuses it the shot. Enemies are
//         exempt, per §1.3's last line.
//   §1.6  sight, including the endpoint exemption .............. sight
//         `hasBattleSight`, NOT `gameplay`'s `hasLineOfSight` — see below.
//   §1.8  target selection (step 7) ............................ targeting
//   §1.9  enemy classes: slots, movement, attacks .............. enemy, attacks
//         `advanceEnemyMovement` is the `EnemyMovementRule` for
//         `advanceStep5Movement`. `advanceEnemyTargeting` claims the slots.
//   §1.7  the 30-tick stuck retarget DECISION .................. enemy
//
// One correction to batch A's seam map: it pointed §1.8 at `hasLineOfSight`, which
// does not implement §1.6's "선분의 끝점이 어떤 사각형 내부에 있으면 그 사각형은 그
// 선분을 막지 않는다". Low cover is passable, so without the exemption a unit standing
// in a sandbag line is blind and untargetable at once — the artifact §1.6 measured at
// 65% of all "blocked" samples. Use `hasBattleSight` (sight.ts) for every sight test.
//
// ---------------------------------------------------------------------------
// Seams — rules a later batch owns, and where each one plugs in
// ---------------------------------------------------------------------------
//   §1.5  succession .................. set `state.commandUnitId`; `originalCommanderId`
//                                      never changes. Zero `state.input.move` on
//                                      succession, keep `input.spaceHeld`. The slot
//                                      table must NOT be rebuilt (§1.4).
//   §1.10 spawning .................... `state.spawn` (backlog, three discard
//                                      counters, `nextEnemyId`); draw from the
//                                      `spawn` stream only. Build rows with
//                                      `createEnemy`. You do NOT need to eject: step
//                                      5 ends with `ejectTrappedUnits` for everyone.
//   §1.11 rescue ...................... `state.rescue`; `advanceCommandUnit` already
//                                      refuses to move while `rescue.active`.
//   §1.12 elite ....................... a row in `enemies` with `kind: 'elite'` plus
//                                      the `state.elite` attack-cycle sidecar;
//                                      `spawn` stream. `eliteEnemy(state)` joins them.
//                                      Batch B's two enemy passes SKIP `kind: 'elite'`
//                                      entirely — its movement rule and its damage are
//                                      §1.12's — so compose your movement rule with
//                                      `advanceEnemyMovement`, and re-check sight per
//                                      target on impact with `hasBattleSight`.
//   §1.13 upgrades .................... `state.upgrades`; `cards` stream, exactly 3
//                                      draws per round. `CARD_EFFECTS` gives you the
//                                      magnitudes; the SHAPE of each effect is yours.
//                                      `attackRangeOf` / `attackIntervalOf` /
//                                      `attackDamageOf` (targeting.ts) already take
//                                      `state` for exactly this: `marksman`, `rapid`
//                                      and `firepower` land inside those three and
//                                      nowhere else. `cover` is defender-side and
//                                      belongs to the damage step.
//   §1.15 input queue ................. writes `state.input` only.
//   §1.16 the 16-step tick ............ step 4 is `advanceCommandUnit`, which RETURNS
//                                      the displacement; step 5 is
//                                      `advanceStep5Movement(state, moved, rule)`,
//                                      which ends with the §1.6 ejection barrier.
//                                      Steps 6, 7, 9 and 10 are
//                                      `advanceStep6Cooldowns`, `advanceStep7Targeting`,
//                                      `resolveStep9FriendlyAttacks` and
//                                      `resolveStep10EnemyAttacks`; the last two RETURN
//                                      `DamageEvent[]` for the damage step, which is
//                                      the one place hp, `invulnerableTicks`, overkill
//                                      and kill credit are decided.
//
// And one rule that outranks all of them: do not put scratch state in `BattleState`.
// See the header of `types.ts` — the digest walks the whole object.

export * from './attacks'
export * from './constants'
export * from './digest'
export * from './enemy'
export * from './formation'
export * from './movement'
export * from './names'
export * from './sight'
export * from './state'
export * from './streams'
export * from './targeting'
export * from './types'
