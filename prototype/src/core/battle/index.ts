// `core/battle/` — the commander battle rules
// (`docs/superpowers/specs/2026-08-16-commander-battle-design.md`, v9).
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
// Implemented — batch A (as amended by the v8 and v9 teardowns)
// ---------------------------------------------------------------------------
//   §1.1  arena, clock, 6-decimal digest normalization ......... constants, digest
//   §1.2  friendly anchors and the follow speed cap ............ constants
//   §1.4  slot table, id-order assignment, settle dead-band .... formation, movement
//   §1.7  the arena clamp, which is the whole movement boundary . movement
//   §1.14 name pool, one 23-draw shuffle, id-order assignment .. names, state
//   §1.17 three named streams and the full digest .............. streams, digest
//
// ---------------------------------------------------------------------------
// Implemented — batch B (as amended by the v8 and v9 teardowns)
// ---------------------------------------------------------------------------
//   §1.3  attack while moving ................................... attacks, constants
//         THE RULE IS A NON-RULE: displacement affects nothing. `advanceCooldowns` decrements
//         every standing body on both sides, and `resolveFriendlyAttacks` gates on standing +
//         cooled down + has a target, nothing else. There is no `isStopped` and no
//         `MOVE_EPSILON` — v6~v8 had both, taxing movement to close the "constant motion is
//         invulnerability" defect.
//         WHAT CLOSES THAT DEFECT NOW IS A CONSTANT, NOT A STEP: `MELEE_MOVE_SPEED >
//         COMMANDER_MOVE_SPEED`, asserted at import in `constants.ts`. The melee outruns the
//         body the player drives, so fleeing loses ground every tick and movement is
//         positioning rather than escape. Shooters stay slower on purpose (§1.3). The guards
//         are the two fixtures in `battle-combat.test.ts`: a unit that moved this tick still
//         fires and still cools down, and the flight-is-futile gap table.
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
//         range, so the squad can answer back at all).
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
// Implemented — batch E (the sixteen rules become one tick, and something can drive it)
// ---------------------------------------------------------------------------
//   §1.15 input ................................................ input
//         `BattleInputQueue` turns `event.code` and pointer offsets into `BattleCommand`s;
//         `applyBattleCommands` is the 입력 적용 row and returns the one-tick
//         `RescueInputEvents` that §1.11's cancel needs — the cancel is a keydown EVENT and
//         cannot be read off the held axis. Movement is HELD state (the axis survives ticks
//         with no input, which is what makes the lock's zero-vector test meaningful).
//         §1.15's 금지 상황 IS ENFORCED IN BOTH PLACES, and each catches what the other cannot:
//         the queue refuses at ENQUEUE so a paused battle banks nothing, and
//         `applyBattleCommands` refuses again over the batch it is handed, because
//         `advanceBattleTick` and `applyBattleCommands` are public too and batch F's policies
//         build commands with no queue in front of them. One predicate (`commandIsAllowed`)
//         answers both, so the two readings cannot disagree. IT GATES THE START OF AN INPUT
//         ONLY — a release is accepted in `ready`, `running`, `paused` and `awaiting-upgrade`,
//         or `state.input` would go on claiming a key is held that the player let go of, and
//         §1.11's zero-vector lock would be unreachable while it did. IT STOPS AT THE VERDICT:
//         `won` and `lost` refuse a release too, because there is no later tick there for the
//         phantom axis to spoil and a write into `state.input` would move §1.17's digest of a
//         run that is already over. The same predicate also refuses a `set-move` whose vector
//         is not finite, for the digest reason `isFiniteVector` gives.
//         The queue is NOT in `BattleState` and so not in the digest; it is empty at every
//         tick boundary, and its held-key set is a function of the input log's prefix.
//   §1.16 the tick order ....................................... tick
//         `advanceBattleTick(state, source)` — the whole table below, in one place, with
//         §1.1's clock gate in front of it. Input is applied BEFORE the gate, which is what
//         lets an `Escape` lift a pause and a card resume the run on the tick it unblocked.
//         IT TAKES A SOURCE, NOT AN ARRAY, because §1.15's pause release has a state half and a
//         device half: a driver handing over the commands alone would get the battle to forget
//         the axis while the queue went on remembering the keys. `BattleInputQueue.drain()`
//         RETURNS A SOURCE, so the spelling a driver reaches for first is the correct one; a
//         hand-built batch becomes one through `commandBatch`. Neither a raw array nor a re-wrap
//         of what `drain()` returns compiles, and `battle-tick.test.ts` pins the second with a
//         `@ts-expect-error` that `tsc --noEmit` is what checks. A caller who unpacks the source
//         and wraps the array underneath still compiles; nothing here catches that.
//         Everything derived is RETURNED (`TickResult`), never stored: batch A's no-scratch
//         rule, and I2/I6/I13 all read their measurements off it.
//   §6    the facade ........................................... battle
//         `createBattle(seed)`: start, enqueue input, step, read state, read digest, restart.
//         Display-agnostic and driverless — no camera, no snapshot, no timer. §4.3 compares a
//         headless replay against a browser one, which is only a comparison if both drive this.
//
// ---------------------------------------------------------------------------
// Seams — rules a later batch owns, and where each one plugs in
// ---------------------------------------------------------------------------
// (The last entry is not a seam. §1.16's table lives here permanently, and it is listed with
// the seams because it is the thing every future batch has to read before it plugs anything
// in.)
//   §4.1 policies (batch F) ........... a policy is a function from `state()` to commands,
//                                      driven through the facade. `TickResult` already carries
//                                      what the invariants measure: `damage.damageToFriendlies`
//                                      (I2), `accounting` (I6), `rescue` (I13), `transitions`.
//   §1.1 hidden (batch G) ............. the clock gate in `tick.ts` covers `paused` and
//                                      `awaiting-upgrade`, which are modes. HIDDEN IS NOT A
//                                      MODE — it is a fact about a document, and nothing under
//                                      `src/core` can observe it. The shell must not step a
//                                      hidden tab; no test here can catch it for them.
//   §1.15 real events (batch G) ....... `keyDown`/`keyUp` take `event.code` strings, and
//                                      §4.4 wants real `KeyboardEvent`s asserted against them.
//                                      `MOVE_KEY_VECTORS` fixes `-y` as up; the camera has to
//                                      agree with that, and only batch G can make it.
//   §1.16 the tick order .............. THE STEP NUMBERS LIVE HERE AND IN THE REDUCER, AND
//                                      NOWHERE ELSE — not in function names, not in the
//                                      comments beside them, not in test names.
//                                      `tests/battle/battle-step-numbers.test.ts` ENFORCES
//                                      that: it greps this project for a numbered step
//                                      reference outside this file and fails on one. The
//                                      claim used to be prose, and while it was prose 26
//                                      comment lines under `src/core/battle/` disagreed
//                                      with it.
//                                      They used to be in the names
//                                      (`resolveStep9FriendlyAttacks`), and one spec
//                                      renumber on 2026-08-17 (구조 진행 moved after 피해
//                                      적용) renamed five exports, two of them another
//                                      batch's, plus a page of prose. Code says what a
//                                      function DOES; this table says WHEN it runs.
//
//                                      THE REDUCER IS `advanceBattleTick` (`tick.ts`), and it
//                                      is the only caller that runs all sixteen in order.
//
//                                        1  `applyBattleCommands(state, commands)`
//                                        2  `resolveEnemyArrivals(state)`
//                                        3  `resolveRescueLock(state, events)`
//                                        4  `advanceCommandUnit(state)` -> displacement
//                                        5  `advanceMovement(state, advanceAllEnemyMovement)`
//                                        6  `advanceCooldowns(state)` — every standing body,
//                                           unconditionally (§1.3)
//                                        7  `advanceTargeting(state)`
//                                        8  `resolveFriendlyAttacks(state)` -> events; a unit
//                                           that moved in step 4 or 5 still fires (§1.3)
//                                        9  `resolveEnemyAttacks(state)` -> events
//                                        10 `resolveEliteCycle(state)` -> events
//                                        11 `applyDamage(state, events)` -> outcome
//                                        12 `advanceRescueProgress(state, outcome)`
//                                        13 `resolveTransitions(state)` -> outcome
//                                        14 `resolveKillAccounting(state, outcome)`
//                                        15 `state.combatTick += 1`
//                                        16 `resolveBattleOutcome(state, outcome)`
//
//                                      Step 12 MUST receive step 11's outcome: that is
//                                      where §1.11's hit freeze is read, and the type has
//                                      no empty value to fake it with. Step 11's list is the
//                                      concatenation of steps 8, 9 and 10 IN THAT ORDER.
//                                      Steps 14 and 16 both take step 13's outcome: the kill
//                                      count and the verdict are both facts about the deaths
//                                      of THIS tick.
//                                      §1.1: the reducer runs no step at all while `mode` is
//                                      `paused` or `awaiting-upgrade`; step 16 is what enters
//                                      the latter and `chooseUpgradeCard` is what leaves it.
//                                      Step 1 runs AHEAD of that gate — it is how the mode
//                                      changes — and nothing else does.
//                                      FOUR OF THESE ROWS ARE NOT TYPE-ENFORCED, and each has
//                                      a wrong spelling that compiles: `resolveSpawnRequests`
//                                      for row 2, `advanceEnemyMovement` for row 5, any
//                                      permutation of row 11's list, and a second
//                                      `resolveTransitions()` for row 16. The first three are
//                                      caught by the whole-battle fixture in
//                                      `tests/battle/battle-tick.test.ts`; the batch E report
//                                      records the mutation run that proves each one bites.
//                                      ROW 16 IS THE ONE WITH A CONDITION ON IT. The only thing
//                                      in that run which can see a verdict built from a second
//                                      `resolveTransitions()` is the elite's death, and a second
//                                      call reports none because the body is already `dead` by
//                                      then — so the detector exists only while the run WINS,
//                                      and §5 stage 2 has to make `tactical-no-input` lose (I3).
//                                      Two things follow, and both are in the fixture file:
//                                      the whole-battle run asserts that it produced an elite
//                                      death, so it fails loudly instead of going quiet the day
//                                      the verdict flips; and a second fixture kills the elite
//                                      by hand, which is a detector for row 16 that does not
//                                      depend on the VERDICT. It is not balance-free, and the
//                                      word that said so was wrong: it drives
//                                      `tactical-no-input` to the elite's arrival and throws
//                                      `the run ended at N before the elite arrived` if the run
//                                      decides first. The margin, measured on all three seeds,
//                                      is 16/16 standing and 0 downed at tick 1801 — a tune that
//                                      broke this detector would have to wipe a full squad
//                                      before `ELITE_SPAWN_TICK`, and it would throw rather
//                                      than pass.
//   I1 measurement .................... `isEnemyEngaged` (enemy.ts).
//   I2 measurement .................... `DamageOutcome.damageToFriendlies` already
//                                      excludes overkill and absorbed hits, which is
//                                      exactly I2's "구조 복귀분과 오버킬 제외".
//   I13 measurement ................... `stats.rescues` and `rescuedByIds`.
//
// And one rule that outranks all of them: do not put scratch state in `BattleState`.
// See the header of `types.ts` — the digest walks the whole object.

export * from './attacks'
export * from './battle'
export * from './constants'
export * from './damage'
export * from './digest'
export * from './elite'
export * from './enemy'
export * from './formation'
export * from './input'
export * from './movement'
export * from './names'
export * from './outcome'
export * from './rescue'
export * from './spawn'
export * from './state'
export * from './streams'
export * from './targeting'
export * from './tick'
export * from './transitions'
export * from './types'
export * from './upgrades'
