#!/usr/bin/env node
// A mutation harness for batch F's policy code, committed rather than described.
//
// Batch C's report claimed "mutation 20/20 caught" and left no script in the tree, so the claim
// could not be checked by anyone. This is the script. It edits one source file at a time,
// re-runs a fixed set of fixtures, and reports whether the fixtures noticed.
//
// WHAT IT PROVES AND WHAT IT DOES NOT. A caught mutation proves that at least one assertion
// depends on the line that was changed. It does not prove the assertion is the right one, and a
// MISSED mutation is not automatically a defect — some of the mutations below change a safety
// margin that nothing pins on purpose. Both outcomes are printed; the batch report is where a
// miss has to be argued for.
//
// ---------------------------------------------------------------------------
// WHERE THE LIST COMES FROM, AND WHY IT IS NOT READ OFF THE FIXTURES
// ---------------------------------------------------------------------------
// The first version of this table was assembled by reading the fixtures and asking what they
// would notice. The number that comes out of that is a tautology — it measures the tests against
// themselves — and the review of batch F demonstrated it rather than asserting it: it picked five
// mutations of its own and ALL FIVE passed the whole 569-test suite, three of them deleting the
// `commitTicks` mechanism the spec patch `ba2fa70` had just introduced.
//
// So this table is chosen from the RULES, with the fixtures unread. The two sources are:
//
//   * §4.1's table in `docs/superpowers/specs/2026-08-16-commander-battle-design.md` — the six
//     policies and the ONE difference each names against `skilled`.
//   * §3's two `skilled` player models, and in particular the amended second one: "둘째 변형을
//     v9가 실제로 가르는 축 — 어디에 멈출지(§1.6의 사거리 격차 안 어디)와 얼마나 자주 다시
//     고를지 — 으로 재정의한다."
//
// The mechanical rule those two produce: `PolicyRules` in `policies.ts` is the record of decision
// points that §4.1's "한 가지만 바꾼 변형" is built out of, so EVERY ONE OF ITS FIVE KEYS CARRIES
// AT LEAST ONE MUTATION THAT CHANGES THAT KEY'S OWN DEFINITION — `intent`, `allowsMove`,
// `standoff`, `rescues`, `commitTicks`.
//
// THE BASELINE IS THE DEFINITION, NOT THE CALL SITE. A mutation that edits
// `if (rules.allowsMove(intent.reason))` pins that the filter is CONSULTED and says nothing about
// which reasons it admits; for one round that was the only `allowsMove` mutation in this table,
// and `camps-in-place` could be widened to walk across the board with the whole suite green.
// Call-site mutations are still worth having — they are the ones that catch a hook being bypassed
// — but they are not counted toward a key. A key with no definition-level mutation under it is a
// hole in THIS FILE, not a property of the code: that is what `commitTicks` was two rounds ago
// and what `allowsMove` and `rescues` were one round ago.
//
// The `policies.ts` sections below are labelled by key and each names the rule it was derived
// from. TWO OF THE SECTIONS ARE NOT KEYS and say so in their own headings — the path every policy
// shares (`commandsFor` and the geometry helper, which no variant replaces) and the architecture
// guard, which is not a decision at all. Nothing under those two counts toward any key. Filing
// them under one is how per-key coverage reads denser than it is, which is what this file did
// until this round: SIX mutations sat under `PolicyRules.intent` that are not in the `intent`
// hook — five in the shared path (one of them the card slot, which `policies.ts:433-437`
// documents as DELIBERATELY not a variant axis) and the architecture guard.
//
// `view.ts` and `run.ts` are not decision points either. Their mutations come from the two lists
// in `view.ts`'s own header ("what is on the screen" against "what is not") and from the band
// arithmetic §4.1 counts policies by.
//
// ---------------------------------------------------------------------------
// A LOWER BOUND, NOT A PROOF — AND THE NEXT PLACES TO DIG
// ---------------------------------------------------------------------------
// "N/N caught" is a floor and reads like a ceiling. It has been read as a ceiling twice on this
// branch, and both times one pass of fresh mutations derived from the spec — written without
// reading this table — found survivors: five the first time, four the second, spread over three
// of the five decision points. A full sweep proves only that every line IN the table has at least
// one assertion standing on it. It says nothing at all about the lines that are not in it.
//
// So the table names what has been dug, and this list names what has not. These are the
// candidates batch G inherits, by name, each with the rule that would make it a decision:
//
//   * `skilled`'s band UPPER edge (`policies.ts:303`) — `SOLDIER_RANGE`, because past it the
//     squad stops shooting (§1.6). Only the lower edge's fraction is mutated today.
//   * `conservativeStandoff` and `aggressiveStandoff`'s band fractions (`policies.ts:384`,
//     `policies.ts:392`) — §3's FIRST axis, "어디에 멈출지(§1.6의 사거리 격차 안 어디)". Only the
//     second axis, `commitTicks`, is mutated today.
//   * `contactStandoff`'s band `[0, MELEE_RANGE]` (`policies.ts:351`) — §4.1's "적에게 붙어서
//     멈춘다", which is the whole of `ignores-range`.
//   * `noInputIntent` (`policies.ts:321`) — §4.1's "강화 선택 외 입력 없음". Nothing here mutates
//     the variant whose entire content is doing nothing.
//   * `commandsFor`'s two de-duplication tests (`policies.ts:492`, `policies.ts:502`) — what the
//     battle is already holding. A policy that re-sends every tick is a different input stream.
//   * `projectPolicyView`'s command/roster split in `view.ts` — §1.5's command unit is the one row
//     that must not also appear in `friendlies`.
//
// Three of those (`:303`, `:351`, `:384`) were probed once, by a batch F re-reviewer, and were
// caught. A probe that is not in this table is not a standing check: it does not run again, and
// nothing notices when the fixture behind it moves. An earlier version of this note claimed a
// fourth, `:211`, had been probed and caught; it had not — the closing re-reviewer probed the
// line this note actually named and it SURVIVED. See the next paragraph for why that is not a
// gap, and treat the difference as the reason a probe belongs in the table or in prose, never in
// a count.
//
// DELIBERATELY UNPINNED, which is not the same as undug. `eliteDodgeIntent`'s degenerate heading
// (`policies.ts:211`) and `standoffIntent`'s (`policies.ts:257`) both hand back `{x:1,y:0}` for a
// unit standing exactly on the point it is reacting to. Neither §1.12 nor §1.6 says which way it
// should go, and both comments say so at the line: any heading leaves the blast, any heading
// backs off. A fixture pinning `{x:1,y:0}` would assert an arbitrary choice, and the only thing
// that actually binds — that the choice is the SAME every replay — is §1.17's, held by the seed
// digests. Mutating these two is measuring the test suite, not the game.
//
// Usage, from `prototype/`:  node scripts/mutate.mjs [--filter <substring>]
//
// It restores every file it touches, including on Ctrl-C. If it ever exits with a file still
// mutated, `git diff` says so immediately — which is the reason it edits the real tree instead
// of a copy: a copy would not run against the real test paths.

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/**
 * The fixtures a mutation is measured against.
 *
 * Not the whole suite: this batch's code is only reachable from these files, and running the
 * other 500 tests for each of the mutations below buys nothing but minutes. The two guards are
 * here because batch F widened both of them to cover the harness.
 */
const TARGET_TESTS = [
  'tests/harness',
  'tests/battle/battle-no-cover.test.ts',
  'tests/battle/battle-step-numbers.test.ts',
  // Batch H: §1.4.1's rule lives in `movement.ts` and its fixtures live here.
  'tests/battle/battle-movement.test.ts',
]

const VIEW = 'src/core/harness/policy/view.ts'
const POLICIES = 'src/core/harness/policy/policies.ts'
const RUN = 'src/core/harness/policy/run.ts'
const MOVEMENT = 'src/core/battle/movement.ts'

/**
 * The mutation table. Hardcoded on purpose — a generated mutation set is a different tool, and
 * this one exists so a reader can see exactly which claims were tested.
 *
 * `find` must occur EXACTLY ONCE in the file. A zero or ambiguous anchor is reported as such
 * rather than silently skipped: an anchor that stopped matching after a refactor would otherwise
 * turn into a mutation that quietly stopped being run.
 */
const MUTATIONS = [
  // --- view.ts: the projection's two lists -------------------------------------------------
  {
    file: VIEW,
    label: 'show dead enemies too',
    find: "    if (enemy.life !== 'standing') continue",
    replace: '    if (false) continue',
  },
  {
    file: VIEW,
    label: 'downed countdown counts up',
    find: "unit.life === 'downed' ? DOWNED_TICKS - unit.downedTicks : 0",
    replace: "unit.life === 'downed' ? unit.downedTicks : 0",
  },
  {
    file: VIEW,
    label: 'hand out the position by reference',
    find: '  return { x: position.x, y: position.y }',
    replace: '  return position',
  },
  {
    file: VIEW,
    label: 'draw the telegraph during the cooldown instead',
    find: "    state.elite.attackPhase === 'telegraph' && telegraphCenter !== null",
    replace: "    state.elite.attackPhase === 'cooldown' && telegraphCenter !== null",
  },
  {
    file: VIEW,
    label: 'leak the enemy cooldown into the view',
    find: '    enemies.push({ id: enemy.id, kind: enemy.kind, position: copyPosition(enemy.position) })',
    replace:
      '    enemies.push({ id: enemy.id, kind: enemy.kind, position: copyPosition(enemy.position), attackCooldown: enemy.attackCooldown })',
  },
  {
    file: VIEW,
    label: 'forget the slot assignment',
    find: '    if (assignment.unitId === unitId) return assignment.slotIndex',
    replace: '    if (assignment.unitId === unitId) return null',
  },

  // --- policies.ts / `PolicyRules.standoff` --------------------------------------------------
  // §4.1: `ignores-range` is "정지 위치를 고를 때 사거리 우위를 참조하지 않음 — 적에게 붙어서
  // 멈춘다. 그 외 동일", so WHERE the policy stops is a decision the table names in its own row,
  // and §1.6's gap is what it stops against.
  //
  // Two of the four change `rangeAdvantageStandoff` itself — the band's lower edge and the body
  // the band is taken from. The other two change `standoffIntent`, which READS the hook's answer;
  // they are the ones that catch the answer being used wrongly, and they do not count for the key.
  {
    file: POLICIES,
    label: 'flip the sign of the standoff fraction',
    find: 'const SKILLED_STANDOFF_FRACTION = 0.4',
    replace: 'const SKILLED_STANDOFF_FRACTION = -0.4',
  },
  {
    file: POLICIES,
    label: 'walk toward the shooter when too close instead of away',
    find: "  if (distance < goal.band[0]) return { kind: 'move', direction: negate(toGoal), reason: 'standoff' }",
    replace: "  if (distance < goal.band[0]) return { kind: 'move', direction: toGoal, reason: 'standoff' }",
  },
  {
    file: POLICIES,
    label: 'relax the standoff lower bound to the upper one',
    find: '  if (distance < goal.band[0]) return',
    replace: '  if (distance < goal.band[1]) return',
  },
  {
    // §1.6 is a gap against the SHOOTER — `SHOOTER_RANGE < SOLDIER_RANGE` is the whole of it, and
    // a melee has no range for the gap to be a gap against. Dropping the filter measures the band
    // against whichever body is nearest, which reverses the direction of the step outright.
    file: POLICIES,
    label: 'measure the standoff band against the nearest body of any kind',
    find:
      '  const target = nearestEnemy(shooters.length > 0 ? shooters : view.enemies, command.position)',
    replace: '  const target = nearestEnemy(view.enemies, command.position)',
  },

  // --- policies.ts / `PolicyRules.rescues` ----------------------------------------------------
  // §4.1: `abandons-downed` is "`set-rescue`를 절대 보내지 않음", and I13 counts the survivor
  // difference that switch is supposed to produce.
  //
  // The key is a boolean rather than a function, so its DEFINITION is the value in
  // `POLICY_OVERRIDES` — the first of the three. The other two change the code that reads the
  // switch and the behaviour the switch turns off; neither says what the switch is set to.
  {
    // The key itself, where the one variant that owns it is defined. The two below change the
    // code that READS the switch; this one changes what the switch says.
    file: POLICIES,
    label: 'turn the `abandons-downed` switch back on',
    find: "  'abandons-downed': { rescues: false },",
    replace: "  'abandons-downed': { rescues: true },",
  },
  {
    file: POLICIES,
    label: 'never rescue (early return)',
    find: 'function rescueIntent(view: PolicyView, command: FriendlyView): Intent | null {',
    replace:
      'function rescueIntent(view: PolicyView, command: FriendlyView): Intent | null {\n  if (view !== null) return null',
  },
  {
    file: POLICIES,
    label: 'ignore the `rescues` switch',
    find: '  if (rules.rescues) {',
    replace: '  if (true) {',
  },

  // --- policies.ts / `PolicyRules.allowsMove` ------------------------------------------------
  // §4.1: `camps-in-place` is "한 자리에 멈춰 정예 회피 외에는 움직이지 않음" — one filter on
  // which reasons are worth a step, and I10 is the band it is measured by.
  //
  // The first changes `dodgeOnly`, which is what the row actually says; the second changes the
  // `if` that consults it, which only says the filter is reached. For one round the second was
  // the only one here.
  {
    // The hook's own definition. "정예 회피 외에는" names ONE reason, so widening the set is the
    // mutation the row is written against — and `rescue-approach` is the widening that walks the
    // camper across the board.
    file: POLICIES,
    label: 'let the camper move for a rescue as well as for the blast',
    find: "  return reason === 'elite-dodge'",
    replace: "  return reason === 'elite-dodge' || reason === 'rescue-approach'",
  },
  {
    file: POLICIES,
    label: 'ignore the `allowsMove` filter',
    find: "  if (intent.kind === 'move' && rules.allowsMove(intent.reason)) {",
    replace: "  if (intent.kind === 'move') {",
  },

  // --- policies.ts / `PolicyRules.intent` ----------------------------------------------------
  // §4.1's two whole-decision rows: `tactical-no-input` ("강화 선택 외 입력 없음") and
  // `flees-always` ("가장 가까운 적에서 계속 멀어지기만 함. 구조·정예 대응 없음"). §1.12's
  // telegraph and §1.11's countdown are the rules `skilled`'s own intent is assembled out of, and
  // the ORDER it asks them in is part of the hook.
  //
  // Everything under this heading is inside an `intent` implementation — `fleeIntent`,
  // `skilledIntent`, or one of the helpers only `skilledIntent` calls. The shared command path
  // that used to sit under this heading has its own section below, and does not count here.
  {
    file: POLICIES,
    label: 'flee toward the enemy',
    find: '  const away = offset(nearest.position, command.position)',
    replace: '  const away = offset(command.position, nearest.position)',
  },
  {
    file: POLICIES,
    label: 'flip the sign of the elite dodge margin',
    find: 'const ELITE_DODGE_MARGIN_FRACTION = 0.3125',
    replace: 'const ELITE_DODGE_MARGIN_FRACTION = -0.3125',
  },
  {
    // Review M3. §1.11 runs a countdown per body, so WHICH body the approach walks to is the
    // difference between one rescue and none — and it is the only choice `skilled` makes on the
    // rescue side. This takes the first reachable row in id order instead of the nearest.
    file: POLICIES,
    label: 'go for the first reachable body in id order, not the nearest',
    find: '    if (distance >= bestDistance) continue',
    replace: '    if (best !== null) continue',
  },
  {
    // Closing re-review, and the one survivor it found that nobody had named. `>=` is what makes
    // two EQUIDISTANT bodies resolve to the lower id: the view hands rows out in ascending id, so
    // a strict-greater test lets the later row displace the earlier one. `nearestEnemy`'s docblock
    // calls that ascending-id tie-break "the tie-break §1.5, §1.8 and §1.9 all use"; this function
    // follows it and, until the fixture beside this entry, nothing held it there.
    file: POLICIES,
    label: 'break a nearest-body tie toward the higher id',
    find: '    if (distance >= bestDistance) continue',
    replace: '    if (distance > bestDistance) continue',
  },
  {
    // Review M5. §1.11: "취소 시 진행도는 0으로 되돌린다", and the candidate test is re-run every
    // tick, so a lock can outlive the candidacy that started it. Dropping this branch releases
    // `Space` mid-lock and throws the progress away.
    file: POLICIES,
    label: 'release a lock the moment the body stops being a candidate',
    find: '  if (view.rescue !== null) return { kind: \'rescue\' }',
    replace: '  if (false) return { kind: \'rescue\' }',
  },
  {
    // The ORDER `skilledIntent` asks its three questions in. §1.12's blast is the only thing that
    // can take the whole formation at once, so it outranks §1.11's countdown — this swaps them
    // and leaves the rescuer standing inside the circle.
    file: POLICIES,
    label: 'answer the countdown before the blast',
    find:
      '  const dodge = eliteDodgeIntent(view, command)\n' +
      '  if (dodge !== null) return dodge\n' +
      '\n' +
      '  if (rules.rescues) {\n' +
      '    const rescue = rescueIntent(view, command)\n' +
      '    if (rescue !== null) return rescue\n' +
      '  }',
    replace:
      '  if (rules.rescues) {\n' +
      '    const rescue = rescueIntent(view, command)\n' +
      '    if (rescue !== null) return rescue\n' +
      '  }\n' +
      '\n' +
      '  const dodge = eliteDodgeIntent(view, command)\n' +
      '  if (dodge !== null) return dodge',
  },
  {
    // §1.11's countdown has to cover the WHOLE trip, and the lock is part of the trip: a body
    // reached with fewer than `RESCUE_TICKS` left is a body that dies under the lock. Dropping
    // the term walks the policy to a body it has already been shown it cannot finish.
    file: POLICIES,
    label: 'budget the walk to a downed body but not the lock at the end of it',
    find: '    if (travelTicks + RESCUE_TICKS > unit.downedTicksRemaining) continue',
    replace: '    if (travelTicks > unit.downedTicksRemaining) continue',
  },

  // --- policies.ts / the path every policy shares — NOT A DECISION POINT ----------------------
  // `commandsFor` and the geometry helpers. No variant in `POLICY_OVERRIDES` replaces any of
  // this, so a mutation here moves `tactical-no-input` and `skilled` alike and isolates nothing
  // §4.1's table names. These are worth mutating — §1.15's pointer vocabulary, §1.13's card
  // screen, §1.5's succession and §1.8's tie-break are all rules — but they DO NOT COUNT toward
  // any `PolicyRules` key, and they sat under `PolicyRules.intent` for two rounds, which made
  // that key's coverage read denser than it was.
  {
    file: POLICIES,
    label: 'never report a keydown',
    find: '    const keydown = !sameVector(move, ZERO) && sameVector(memory.sentMove, ZERO)',
    replace: '    const keydown = false',
  },
  {
    file: POLICIES,
    label: 'drop the short-offset clamp',
    find: '    move = magnitude(intent.direction) < ARRIVE_EPSILON ? ZERO : intent.direction',
    replace: '    move = magnitude(intent.direction) < 0 ? ZERO : intent.direction',
  },
  {
    file: POLICIES,
    label: 'forget that succession zeroes the held vector',
    find: '  if (commandUnitId !== memory.commandUnitId) {',
    replace: '  if (false) {',
  },
  {
    // §1.8's tie-break, in the helper `fleeIntent`, `rangeAdvantageStandoff` and
    // `contactStandoff` all read — which is why it is shared rather than filed under either key.
    file: POLICIES,
    label: 'break the nearest tie toward the higher id',
    find: '    if (distance < bestDistance) {',
    replace: '    if (distance <= bestDistance) {',
  },
  {
    // Explicitly NOT a decision point: `policies.ts:433-437` documents the first-card rule as
    // deliberately not a variant axis, because §4.1's table has no card-choice row and a
    // preference order would move all eight bands together. Filing it under a key contradicts
    // the file it is mutating.
    file: POLICIES,
    label: 'take the second card instead of the first',
    find: 'const FIRST_OFFERED_SLOT = 1',
    replace: 'const FIRST_OFFERED_SLOT = 2',
  },

  // --- policies.ts / architecture guard — not a decision at all -------------------------------
  // Batch F's constraint that the policy harness does not reach back into the archived cover
  // geometry. There is no §4.1 row behind this and no behaviour to vary; the fixture that catches
  // it is a guard, not a claim about what a player does.
  {
    file: POLICIES,
    label: 'revive cover with an import of the archived geometry',
    find: "import type { BattleCommand } from '../../battle/input'",
    replace:
      "import type { BattleCommand } from '../../battle/input'\nimport '../../gameplay/geometry'",
  },

  // --- policies.ts / `PolicyRules.commitTicks` -----------------------------------------------
  // §3's amended second variant is defined ON THIS AXIS: "얼마나 자주 다시 고를지". A policy that
  // re-aims every tick at whichever body is nearest this frame is not a player, and two models
  // that re-aim on the same clock are not the two models §3 asks for. All three mutations here
  // are review findings (M1, M2, M4) and all three passed 569/569 before the round that added
  // them. The key is a number, so its definition is the two values — `SKILLED_COMMIT_TICKS` and
  // the two player models' overrides. The middle one deletes the block in `commandsFor` that
  // spends the number, which is the reader and not the key.
  {
    file: POLICIES,
    label: 'zero the commitment, so the heading is re-aimed every tick',
    find: 'const SKILLED_COMMIT_TICKS = 12',
    replace: 'const SKILLED_COMMIT_TICKS = 0',
  },
  {
    file: POLICIES,
    label: 'delete the commitment block entirely',
    find: "  if (intent.kind === 'move' && intent.reason === 'standoff') {",
    replace: '  if (false) {',
  },
  {
    file: POLICIES,
    label: "flatten both player models onto `skilled`'s re-aim clock",
    find:
      "  'skilled-conservative': { standoff: conservativeStandoff, commitTicks: 30 },\n" +
      "  'skilled-aggressive': { standoff: aggressiveStandoff, commitTicks: 4 },",
    replace:
      "  'skilled-conservative': { standoff: conservativeStandoff, commitTicks: 12 },\n" +
      "  'skilled-aggressive': { standoff: aggressiveStandoff, commitTicks: 12 },",
  },

  // --- movement.ts / §1.4.1's four decisions --------------------------------------------------
  // NOT chosen by reading the fixtures. §1.4.1 is four sentences and each one of these mutations
  // negates exactly one of them:
  //
  //   "이 반경 안의 적만 병사가 쫓아갈 대상이 된다"          -> flip the comparison
  //   "`LEASH_RADIUS`는 지휘 유닛에 고정된다. 슬롯이 아니라"  -> move the anchor to the soldier
  //   "자기 대상에 대해 자기 사거리 밴드로 이동한다"          -> walk onto the body instead
  //   "대상이 없는 병사는 슬롯으로 복귀한다"                  -> stand still instead
  //
  // THE SECOND ONE IS THE DESIGN. §1.4.1 gives the reason in its own text — a soldier that hunted
  // from where it stands makes the command unit's position stop selecting which fight happens,
  // and §4.5's third question then has no mechanism under it. It is one line in `movement.ts` on
  // purpose, so that changing it is one visible edit.
  //
  // WHAT THE DIGEST PINS DO AND DO NOT DO HERE. `tests/harness/policy-run.test.ts` pins three
  // whole-run digests, so ANY behavioural change under `src/core/battle/` moves them and every
  // mutation below is caught by that alone. That is a change detector, not a statement about
  // which rule broke: it says the run is different, never that the leash is anchored to the
  // command unit. Measured with the mutations committed and the §1.4.1 fixtures NOT yet written:
  // three of the four survived `tests/battle/battle-movement.test.ts` — the first, second and
  // third — and all four were caught by the digest block alone. The fourth was already caught by
  // §1.4's own follow fixtures, which is what a soldier that never walks back to its slot breaks.
  // The batch H report records that run. With the fixtures in place all four are caught by
  // `tests/battle/battle-movement.test.ts` ALONE, which is the property that makes the verdict
  // legible: the failure names the rule instead of naming a hash.
  {
    file: MOVEMENT,
    label: 'chase only the enemies OUTSIDE the leash',
    find: '    return leashDistance <= LEASH_RADIUS',
    replace: '    return leashDistance > LEASH_RADIUS',
  },
  {
    // THE design point of §1.4.1, and the one a reviewer should check first.
    file: MOVEMENT,
    label: 'anchor the leash to the soldier instead of the command unit',
    find: '  const leashCenter = command.position',
    replace: '  const leashCenter = unit.position',
  },
  {
    file: MOVEMENT,
    label: 'walk onto the enemy instead of to the range band',
    find:
      '  const toBand = distance > far ? distance - far : distance < near ? distance - near : 0',
    replace: '  const toBand = distance',
  },
  {
    file: MOVEMENT,
    label: 'stand still instead of returning to the slot',
    find: '    stepToward(unit, slotPosition(center, assignment.slotIndex), followSpeed)',
    replace: '    unit.lastDisplacement = 0',
  },

  // --- run.ts: the aggregation ---------------------------------------------------------------
  {
    file: RUN,
    label: 'count the bodies that are NOT standing',
    find: "    if (unit.life === 'standing') standing += 1",
    replace: "    if (unit.life !== 'standing') standing += 1",
  },
  {
    file: RUN,
    label: 'invert the verdict',
    find: "    outcome: state.mode === 'won' ? 'won' : 'lost',",
    replace: "    outcome: state.mode === 'won' ? 'lost' : 'won',",
  },
  {
    file: RUN,
    label: 'count no wins',
    find: "    wins: results.filter((result) => result.outcome === 'won').length,",
    replace: '    wins: 0,',
  },
  {
    file: RUN,
    label: 'never start the battle',
    find: '  battle.start()',
    replace: '  // battle.start()',
  },
]

function occurrences(source, needle) {
  let count = 0
  let index = source.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = source.indexOf(needle, index + needle.length)
  }
  return count
}

function testsPass() {
  const result = spawnSync('npx', ['vitest', 'run', ...TARGET_TESTS], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  return result.status === 0
}

const filterIndex = process.argv.indexOf('--filter')
const filter = filterIndex === -1 ? null : process.argv[filterIndex + 1]
const selected = filter ? MUTATIONS.filter((mutation) => mutation.label.includes(filter)) : MUTATIONS

/** Whatever is mutated right now, so a signal can put it back. */
let inFlight = null

function restore() {
  if (inFlight === null) return
  writeFileSync(inFlight.file, inFlight.original)
  inFlight = null
}

process.on('SIGINT', () => {
  restore()
  process.exit(130)
})

console.log(`[mutate] baseline: ${TARGET_TESTS.join(' ')}`)
if (!testsPass()) {
  console.error('[mutate] the fixtures do not pass BEFORE any mutation; nothing measured')
  process.exit(1)
}
console.log('[mutate] baseline green\n')

const rows = []

for (const mutation of selected) {
  const original = readFileSync(mutation.file, 'utf8')
  const found = occurrences(original, mutation.find)

  if (found !== 1) {
    rows.push({ ...mutation, verdict: found === 0 ? 'NO ANCHOR' : 'AMBIGUOUS' })
    console.log(`  ${found === 0 ? 'NO ANCHOR' : 'AMBIGUOUS'}  ${mutation.file}  ${mutation.label}`)
    continue
  }

  inFlight = { file: mutation.file, original }
  writeFileSync(mutation.file, original.replace(mutation.find, mutation.replace))

  let caught
  try {
    caught = !testsPass()
  } finally {
    restore()
  }

  rows.push({ ...mutation, verdict: caught ? 'caught' : 'MISSED' })
  console.log(`  ${caught ? 'caught  ' : 'MISSED  '}  ${mutation.file}  ${mutation.label}`)
}

const caught = rows.filter((row) => row.verdict === 'caught').length
const missed = rows.filter((row) => row.verdict === 'MISSED')
const broken = rows.filter((row) => row.verdict === 'NO ANCHOR' || row.verdict === 'AMBIGUOUS')

console.log(`\n[mutate] ${caught}/${rows.length} caught`)
for (const row of missed) console.log(`[mutate] MISSED    ${row.file}: ${row.label}`)
for (const row of broken) console.log(`[mutate] ${row.verdict} ${row.file}: ${row.label}`)

process.exit(missed.length + broken.length > 0 ? 1 : 0)
