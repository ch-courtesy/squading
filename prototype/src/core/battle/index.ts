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
// `tests/battle/battle-no-cover.test.ts` walks this directory's import graph and fails
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
//         `isStopped` is the single stop test; `advanceCooldowns` freezes the cooldown of
//         anything that moved and `resolveFriendlyAttacks` refuses it the shot. Enemy
//         cooldowns decrement unconditionally, per §1.3's last line. THIS IS THE DESIGN'S ONE
//         REMAINING CENTRAL BET: the fixture that pins firepower proportional to the
//         stopped-tick fraction (30/15/10/3 against v5's 30/30/25/30) is the guard.
//   §1.8  target selection ..................................... targeting
//         In range, elite first, nearest, lowest id. No sight filter.
//   §1.9  enemy classes: slots, movement, attacks .............. enemy, attacks
//         `advanceEnemyMovement` is the `EnemyMovementRule` for
//         `advanceMovement`. The shooter has three states — approach, hold,
//         retreat. `advanceEnemyTargeting` claims the slots (melee 1, shooter 2 per
//         friendly, separate pools, nearest-with-a-free-slot then nearest overall).
//
// ---------------------------------------------------------------------------
// Implemented — batch C (the consequences: a body falls and the player loses it)
// ---------------------------------------------------------------------------
//   §1.10 spawning ............................................. spawn
//         One request per phase interval, `melee:shooter` walked by a PHASE-LOCAL index
//         (`spawn.requestsInPhase`), one `spawn` draw for the angle. The request is BUILT
//         before it is routed, so the stream position and `nextEnemyId` depend on the
//         request schedule alone and never on the live count. Routing: absolute cap ->
//         discard and count; phase `engagedCap`, measured only inside `ENGAGE_RADIUS` ->
//         backlog; else spawn. The backlog drains first, up to `BACKLOG_DRAIN_PER_TICK`,
//         at the coordinates fixed when each entry was requested.
//   §1.11 rescue ............................................... rescue
//         The lock is HELD state, the cancel is an EVENT: `resolveRescueLock(state, events)`
//         takes `RescueInputEvents` because a held movement vector must NOT cancel (the v5
//         defect §1.11 records), and the parameter has no default so a loop that never wires
//         the keydown cannot compile. `advanceRescueProgress(state, damageOutcome)` runs AFTER
//         `applyDamage` and reads §1.11's "피격 tick" out of that outcome in the same tick —
//         there is no flag on the state and no lag. Completion revives at `maxHp x 50%` with
//         the invulnerability window.
//   §1.16 damage application ................................... damage
//         The ONLY place hp moves. Defender-side modifiers live here (§1.11's window,
//         §1.13's `cover` seam), overkill is measured here for I2, and `HP_EPSILON`
//         snaps away the float residue that would otherwise let a finished body survive.
//         THE TICK LOOP MUST CALL THIS EVERY TICK, empty list included: it is where the
//         invulnerability window burns down, and `advanceRescueProgress` needs its return
//         value. There is deliberately no exported empty `DamageOutcome` to fake it with.
//   §1.5 / §1.16 transitions and succession .................... transitions
//         Downs, enemy deaths, downed timers, then §1.5 — the unconditional reversion
//         first, then the promotion loop. Returns `TransitionOutcome`, which is what the kill
//         accounting counts and the 승패 판정 adjudicates; this step never writes
//         `stats.kills`, `mode` or `failureReason`.
//
// ---------------------------------------------------------------------------
// Seams — rules a later batch owns, and where each one plugs in
// ---------------------------------------------------------------------------
//   §1.12 elite ....................... a row in `enemies` with `kind: 'elite'` plus
//                                      the `state.elite` attack-cycle sidecar;
//                                      `spawn` stream. `eliteEnemy(state)` joins them.
//                                      Batch B's two enemy passes SKIP `kind: 'elite'`
//                                      entirely, so compose your movement rule with
//                                      `advanceEnemyMovement`. Impact has no per-target
//                                      sight re-check any more — just the blast radius.
//                                      Arrival: reuse `drawSpawnPosition` (spawn.ts) so
//                                      there is one draw, and compose it AFTER
//                                      `resolveSpawnRequests` so tick 1800's draw order is
//                                      written down somewhere. The telegraph/impact cycle
//                                      is step 10; its blast events join the step-11 list
//                                      as `cause: 'elite-blast'`. Step 11 drops events
//                                      aimed at a non-standing body, so "does the blast
//                                      damage a downed friendly" is a §1.12 decision that
//                                      has to be made explicitly.
//                                      The elite counts towards BOTH §1.10 caps.
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
//   §1.13 kill accounting ............. `resolveTransitions` RETURNS
//                                      `TransitionOutcome`. `enemyDeaths` is `{ id, kind }`
//                                      in ascending id, so the accounting step counts the
//                                      ones whose kind is not `'elite'` into `stats.kills`
//                                      and compares against `UPGRADE_KILL_THRESHOLDS`; the
//                                      elite death in that same list is the 승패 판정's
//                                      victory. `friendlyDowns` / `friendlyDeaths` are
//                                      there for I2 and the results screen, and
//                                      `allUnitsLost` is the 승패 판정's `all-units-lost`.
//   §1.15 input queue ................. writes `state.input` only, PLUS the one-tick
//                                      `RescueInputEvents` it hands `resolveRescueLock` —
//                                      §1.11's cancel is a keydown EVENT and cannot be read
//                                      off held state. §1.15's own "포인터 드래그가
//                                      MOVE_EPSILON 미만이면 0으로 클램프" is what makes
//                                      the lock's zero-vector test meaningful.
//   §1.16 the tick order .............. THE STEP NUMBERS LIVE HERE AND IN THE REDUCER, AND
//                                      NOWHERE ELSE — not in function names, not in the
//                                      comments beside them. They used to be in the names
//                                      (`resolveStep9FriendlyAttacks`), and one spec
//                                      renumber on 2026-08-17 (구조 진행 moved after 피해
//                                      적용) renamed five exports, two of them another
//                                      batch's, plus a page of prose. Code says what a
//                                      function DOES; this table says WHEN it runs.
//
//                                        1  input application ................. open
//                                        2  `resolveSpawnRequests(state)`
//                                        3  `resolveRescueLock(state, events)`
//                                        4  `advanceCommandUnit(state)` -> displacement
//                                        5  `advanceMovement(state, enemyRule)`
//                                        6  `advanceCooldowns(state)`
//                                        7  `advanceTargeting(state)`
//                                        8  `resolveFriendlyAttacks(state)` -> events
//                                        9  `resolveEnemyAttacks(state)` -> events
//                                        10 elite telegraph / impact ........... open
//                                        11 `applyDamage(state, events)` -> outcome
//                                        12 `advanceRescueProgress(state, outcome)`
//                                        13 `resolveTransitions(state)` -> outcome
//                                        14 kill accounting, upgrade thresholds  open
//                                        15 tick increment ..................... open
//                                        16 승패 판정 .......................... open
//
//                                      Step 12 MUST receive step 11's outcome: that is
//                                      where §1.11's hit freeze is read, and the type has
//                                      no empty value to fake it with.
//   I1 measurement .................... `isEnemyEngaged` (enemy.ts).
//   I2 measurement .................... `DamageOutcome.damageToFriendlies` already
//                                      excludes overkill and absorbed hits, which is
//                                      exactly I2's "구조 복귀분과 오버킬 제외".
//   I13 measurement ................... `stats.rescues` and `rescuedByIds`.
//
// And one rule that outranks all of them: do not put scratch state in `BattleState`.
// See the header of `types.ts` — the digest walks the whole object.

export * from './attacks'
export * from './constants'
export * from './damage'
export * from './digest'
export * from './enemy'
export * from './formation'
export * from './movement'
export * from './names'
export * from './rescue'
export * from './spawn'
export * from './state'
export * from './streams'
export * from './targeting'
export * from './transitions'
export * from './types'
