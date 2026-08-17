// `core/battle/` — the commander battle rules
// (`docs/superpowers/specs/2026-08-16-commander-battle-design.md`, v8).
//
// This is a NEW module. `core/gameplay/` is the shipped v1 game and stays as it is.
//
// ---------------------------------------------------------------------------
// THE BOUNDARY — read this before adding an import
// ---------------------------------------------------------------------------
// §1.6 removes cover from the design: no low or high terrain, no line of sight, no
// damage attenuation, no ejection, no tangential orbit. The mechanism that replaced it is
// the RANGE ADVANTAGE — `SHOOTER_RANGE < SOLDIER_RANGE 5.0`, so a friendly that stops in
// the gap can shoot without being shot back, and "어디에 멈출지" is decided by distance
// instead of by geometry.
//
// The geometry that cover needed is still in the repository, as the evidence that it was
// measured and rejected (§2 폐기 기록): `gameplay/geometry.ts`, `gameplay/terrain.ts`,
// `gameplay/formation.ts`'s slot pull, `harness/i9.ts`, `harness/sight.ts`,
// `artifacts/i9-sweep.md`. **Nothing under `core/battle/` may import any of it.**
// `tests/battle/battle-boundaries.test.ts` walks this directory's import graph and fails
// if it does — that test is the only thing standing between the next batch and a quiet
// revival of five rounds of rejected design.
//
// ---------------------------------------------------------------------------
// Implemented — batch A (as amended by the v8 teardown)
// ---------------------------------------------------------------------------
//   §1.1  arena, clock, 6-decimal digest normalization ......... constants, digest
//   §1.2  friendly anchors and the follow speed cap ............ constants
//   §1.4  slot table, id-order assignment, settle dead-band .... formation, movement
//   §1.7  the arena clamp, which is the whole movement boundary . movement
//   §1.14 name pool, one 23-draw shuffle, id-order assignment .. names, state
//   §1.17 three named streams and the full digest .............. streams, digest
//
// ---------------------------------------------------------------------------
// Implemented — batch B (as amended by the v8 teardown)
// ---------------------------------------------------------------------------
//   §1.3  move/fire exclusivity ................................ targeting, attacks
//         `isStopped` is the single stop test; step 6
//         (`advanceStep6Cooldowns`) freezes the cooldown of anything that moved and
//         step 9 (`resolveStep9FriendlyAttacks`) refuses it the shot. Enemy cooldowns
//         decrement unconditionally, per §1.3's last line. THIS IS THE DESIGN'S ONE
//         REMAINING CENTRAL BET: the fixture that pins firepower proportional to the
//         stopped-tick fraction (30/15/10/3 against v5's 30/30/25/30) is the guard.
//   §1.8  target selection (step 7) ............................ targeting
//         In range, elite first, nearest, lowest id. No sight filter.
//   §1.9  enemy classes: slots, movement, attacks .............. enemy, attacks
//         `advanceEnemyMovement` is the `EnemyMovementRule` for
//         `advanceStep5Movement`. The shooter has three states — approach, hold,
//         retreat. `advanceEnemyTargeting` claims the slots (melee 1, shooter 2 per
//         friendly, separate pools, nearest-with-a-free-slot then nearest overall).
//
// ---------------------------------------------------------------------------
// Seams — rules a later batch owns, and where each one plugs in
// ---------------------------------------------------------------------------
//   §1.5  succession .................. set `state.commandUnitId`; `originalCommanderId`
//                                      never changes. Zero `state.input.move` on
//                                      succession, keep `input.spaceHeld`. The slot
//                                      table must NOT be rebuilt (§1.4).
//   §1.10 spawning .................... `state.spawn` (backlog, two discard counters,
//                                      `nextEnemyId`); one `spawn` draw for the angle
//                                      plus the arena clamp — §1.6 leaves no terrain to
//                                      test, so there is no redraw and no terrain
//                                      discard. Build rows with `createEnemy`.
//   §1.11 rescue ...................... `state.rescue`; `advanceCommandUnit` already
//                                      refuses to move while `rescue.active`.
//   §1.12 elite ....................... a row in `enemies` with `kind: 'elite'` plus
//                                      the `state.elite` attack-cycle sidecar;
//                                      `spawn` stream. `eliteEnemy(state)` joins them.
//                                      Batch B's two enemy passes SKIP `kind: 'elite'`
//                                      entirely, so compose your movement rule with
//                                      `advanceEnemyMovement`. Impact has no per-target
//                                      sight re-check any more — just the blast radius.
//   §1.13 upgrades .................... `state.upgrades`; `cards` stream, exactly 3
//                                      draws per round. `CARD_EFFECTS` gives you the
//                                      magnitudes; the SHAPE of each effect is yours.
//                                      `attackRangeOf` / `attackIntervalOf` /
//                                      `attackDamageOf` (targeting.ts) already take
//                                      `state` for exactly this: `marksman`, `rapid`
//                                      and `firepower` land inside those three and
//                                      nowhere else. `cover` is defender-side and
//                                      belongs to the damage step. NOTE: the `cover`
//                                      CARD is damage reduction and survives §1.6 —
//                                      it never had anything to do with terrain.
//   §1.15 input queue ................. writes `state.input` only.
//   §1.16 the 16-step tick ............ step 4 is `advanceCommandUnit`, which RETURNS
//                                      the displacement; step 5 is
//                                      `advanceStep5Movement(state, rule)`. Steps 6, 7,
//                                      9 and 10 are `advanceStep6Cooldowns`,
//                                      `advanceStep7Targeting`,
//                                      `resolveStep9FriendlyAttacks` and
//                                      `resolveStep10EnemyAttacks`; the last two RETURN
//                                      `DamageEvent[]` for the damage step, which is
//                                      the one place hp, `invulnerableTicks`, overkill
//                                      and kill credit are decided.
//   I1 measurement .................... `isEnemyEngaged` (enemy.ts).
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
export * from './state'
export * from './streams'
export * from './targeting'
export * from './types'
