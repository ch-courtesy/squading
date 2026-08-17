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
// Implemented — batch D (the fight the run is about, and what the player earns from it)
// ---------------------------------------------------------------------------
//   §1.12 elite ................................................ elite
//         `resolveEliteArrival` places the body at tick 1800 through `drawSpawnPosition`, so
//         the arrival is ONE `spawn` draw with the arena clamp and nothing else;
//         `resolveEnemyArrivals` composes it AFTER `resolveSpawnRequests`, which is where
//         tick 1800's draw order is written down. `advanceAllEnemyMovement` is the
//         `EnemyMovementRule` the tick loop passes to `advanceMovement`: batch B's pass, then
//         the elite's own approach, which stops EXACTLY at `ELITE_APPROACH_RANGE` (< soldier
//         range, so the squad can answer back — §1.3 gives a closing unit no fire).
//         `resolveEliteCycle` is the telegraph/impact/cooldown clock: the centre is FROZEN at
//         the command unit's position on the tick the telegraph started, the impact lands
//         exactly `ELITE_TELEGRAPH_TICKS` later against positions at IMPACT time, and the
//         cycle is 54 + 56 = 110 ticks (1854, 1964, 2074 for a 1800 arrival). Its events are
//         `cause: 'elite-blast'` and join the damage step's list. The blast hits STANDING
//         friendlies only, and there is no contact damage at all.
//   §1.13 upgrades and kill accounting ......................... upgrades
//         `resolveKillAccounting` counts `enemyDeaths` whose kind is not `'elite'` into
//         `stats.kills` and opens at most one round per tick against
//         `UPGRADE_KILL_THRESHOLDS`. A round is 3 cards from the remaining pool by partial
//         Fisher-Yates, exactly 3 `cards` draws, and `chooseUpgradeCard` removes ONLY the
//         chosen one. WHERE CARD EFFECTS ARE READ FROM: `state.upgrades.rounds[].chosen`,
//         through `hasUpgrade` and the multiplier functions in `upgrades.ts` — no stored
//         multiplier, and batch D added NO field to `BattleState`. The seven landing points
//         are `attackDamageOf` / `attackRangeOf` / `attackIntervalOf` (targeting),
//         `moveSpeedOf` / `followSpeedOf` (movement), `rescueTicksOf` (rescue) and
//         `damageTakenMultiplierOf` (damage). `vitality` is the one exception and §1.13 makes
//         it one: with no HP multiplier field it multiplies `maxHp` and `hp` once, at choice
//         time.
//   §1.16 승패 판정 ............................................ outcome
//         `resolveBattleOutcome(state, transitionOutcome)`, in §1.16's priority
//         `won > lost > awaiting-upgrade` with `all-units-lost > elite-survived` inside the
//         defeat. It reads the transition step's RETURN VALUE, because both defeat inputs are
//         events of this tick, and it runs after the tick increment.
//
// ---------------------------------------------------------------------------
// Seams — rules a later batch owns, and where each one plugs in
// ---------------------------------------------------------------------------
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
//                                        2  `resolveEnemyArrivals(state)`
//                                        3  `resolveRescueLock(state, events)`
//                                        4  `advanceCommandUnit(state)` -> displacement
//                                        5  `advanceMovement(state, advanceAllEnemyMovement)`
//                                        6  `advanceCooldowns(state)`
//                                        7  `advanceTargeting(state)`
//                                        8  `resolveFriendlyAttacks(state)` -> events
//                                        9  `resolveEnemyAttacks(state)` -> events
//                                        10 `resolveEliteCycle(state)` -> events
//                                        11 `applyDamage(state, events)` -> outcome
//                                        12 `advanceRescueProgress(state, outcome)`
//                                        13 `resolveTransitions(state)` -> outcome
//                                        14 `resolveKillAccounting(state, outcome)`
//                                        15 tick increment ..................... open
//                                        16 `resolveBattleOutcome(state, outcome)`
//
//                                      Step 12 MUST receive step 11's outcome: that is
//                                      where §1.11's hit freeze is read, and the type has
//                                      no empty value to fake it with. Step 11's list is the
//                                      concatenation of steps 8, 9 and 10 IN THAT ORDER.
//                                      Steps 14 and 16 both take step 13's outcome: the kill
//                                      count and the verdict are both facts about the deaths
//                                      of THIS tick.
//                                      §1.1: the loop must not run steps at all while `mode`
//                                      is `paused` or `awaiting-upgrade`; step 16 is what
//                                      enters the latter and `chooseUpgradeCard` is what
//                                      leaves it.
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
export * from './elite'
export * from './enemy'
export * from './formation'
export * from './movement'
export * from './names'
export * from './outcome'
export * from './rescue'
export * from './spawn'
export * from './state'
export * from './streams'
export * from './targeting'
export * from './transitions'
export * from './types'
export * from './upgrades'
