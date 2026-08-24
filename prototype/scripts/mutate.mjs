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
//   * campaign stage 1 adds a THIRD: `2026-08-21-seven-stage-campaign-design.md` §1.1's three
//     things that must not reset, plus §1.2, §1.3, §1.4, §1.5 and §3.2. The relay's own section
//     below says which sentence each of its rows inverts. That section is what found the hole a
//     one-stage fixture could not see: every relay fixture folded ONE stage into a fresh campaign,
//     where "the campaign's kills plus this stage's" and "this stage's" are the same number, so
//     `reset the kill count every stage` was MISSED. The fixture that catches it now folds twice.
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
  // Batch N: §1.4.2's rule lives in `attacks.ts` / `targeting.ts`, its card composition in
  // `battle-upgrades.test.ts`, and the display half of its `cause` in the view fixtures.
  'tests/battle/battle-combat.test.ts',
  'tests/battle/battle-upgrades.test.ts',
  'tests/battle-view/battle-action-events.test.ts',
  // Campaign stage 1: the relay's rules live in `core/campaign/` and in the two things the battle
  // now starts holding, and its fixtures are all here. Measured at 0.9s for the whole directory,
  // which is why the whole directory is listed rather than the fast half of it.
  'tests/campaign',
  // Campaign stage 2: §2.3's seven rows, and the fixtures that say what each row is FOR. This is
  // the file that kills the stage-lookup mutation below — every comparison in it reads two ids —
  // so leaving it out would leave that mutation MISSED for the reason it no longer has.
  'tests/battle/battle-stages.test.ts',
  // §1.10.1 (v14): the four spawn mutations below were caught by the digest block alone when they
  // were added, which says a run is different and never which rule broke. This file hand-computes
  // the scaled cap, the scaled interval, the floor and the ENTERING count, so it catches all four
  // BY NAME. Verified with the digest block excluded — see the section header for the numbers.
  'tests/battle/battle-spawn.test.ts',
  // §1.2.1's class as a DISPLAY fact: this is the only file that counts the split, so the
  // "project the front rank as riflemen" mutation below is missed without it.
  'tests/battle-view/battle-snapshot.test.ts',
]

const VIEW = 'src/core/harness/policy/view.ts'
const POLICIES = 'src/core/harness/policy/policies.ts'
const RUN = 'src/core/harness/policy/run.ts'
const MOVEMENT = 'src/core/battle/movement.ts'
const CONSTANTS = 'src/core/battle/constants.ts'
const STAGES = 'src/core/battle/stages.ts'
const ATTACKS = 'src/core/battle/attacks.ts'
const TARGETING = 'src/core/battle/targeting.ts'
const SNAPSHOT = 'src/core/battle-view/snapshot.ts'
const STATE = 'src/core/battle/state.ts'
const UPGRADES = 'src/core/battle/upgrades.ts'
const SPAWN = 'src/core/battle/spawn.ts'
const TRANSITION = 'src/core/campaign/transition.ts'
const CAMPAIGN_SEED = 'src/core/campaign/seed.ts'

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
    find: '    return leashDistance <= stageOf(state).leashRadius',
    replace: '    return leashDistance > stageOf(state).leashRadius',
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
    label: 'stand still instead of returning to the slot',
    find: '    stepToward(state, unit, slotPosition(center, assignment.slotIndex), followSpeed)',
    replace: '    unit.lastDisplacement = 0',
  },

  // --- movement.ts + constants.ts / §1.4.1 v11's bearing, and the supply it needs ------------
  // Same rule as above: taken from the spec sentences, not from the fixtures.
  //
  //   "각 병사의 방위각은 자기 슬롯 오프셋의 방향이다"        -> give them all one fixed bearing
  //   "normalize(슬롯 오프셋)"                                -> drop the normalisation
  //   "× 밴드 far edge"                                       -> stand on the body instead
  //   §1.10's 요청 간격, which is what makes a bearing visible -> put it back where it was
  //
  // THE FIRST ONE IS THE DEFECT THIS BATCH EXISTS FOR. v10 gave the band a distance and no angle,
  // and every soldier on a shared target walked to the same point: `tactical-no-input`/`seed-a`
  // had all fifteen engaged against one or two reachable enemies and the greatest distance from
  // the command unit fell to 0.45, INSIDE the 2.460 slot lattice. A mutation that pins every
  // soldier to one bearing is that defect exactly, and it has to be caught by a fixture that
  // names the rule — not only by a digest that says "the run is different".
  //
  // MEASURED, IN THE COMMIT THAT ADDS THEM AND BEFORE THE FIXTURES THAT ANSWER THEM. Two of the
  // four are already caught and two are not, and the split is worth reading rather than rounding:
  //
  //   against `tests/battle/battle-movement.test.ts` + the two guards, digest block EXCLUDED:
  //     fixed bearing ................. MISSED
  //     drop the normalisation ........ caught
  //     stand on the body ............. caught
  //     revert `requestInterval` ...... MISSED
  //
  // The two CAUGHTs are caught by the fixture the previous commit re-pointed at v11's goal, which
  // pins the hand-computed `(31 - 2*sqrt(5), 16 - sqrt(5))` — a goal at the wrong radius fails it
  // whether the radius came from an un-normalised offset or from a zeroed far edge. The two
  // MISSEDs are the two this batch owes fixtures for: ONE soldier can be given every bearing in
  // the table and land in the same place, so only a fixture with two soldiers on one target can
  // see the first; and no fixture in that file runs a battle, so nothing there can see the fourth.
  //
  // With `tests/harness` included all four are caught, and that is the digest block being a change
  // detector — it says the run is different, never which rule broke.
  //
  // RE-MEASURED WITH THE FIXTURES IN PLACE, digest block still EXCLUDED: all four are caught by
  // `tests/battle/battle-movement.test.ts` alone, and so are batch H's four. That is the property
  // worth having — the failure names the rule instead of naming a hash.
  {
    file: MOVEMENT,
    label: 'give every soldier one fixed bearing instead of its own slot (= the v10 knot)',
    find: '  const slot = FORMATION_SLOTS[slotIndex]',
    replace: '  const slot = FORMATION_SLOTS[0]',
  },
  {
    file: MOVEMENT,
    label: "drop the bearing's normalisation, so slot DISTANCE leaks into the band",
    find: '  const length = Math.hypot(slot.x, slot.y)',
    replace: '  const length = 1',
  },
  {
    file: MOVEMENT,
    label: 'walk onto the enemy instead of standing off at the band far edge',
    find: '  const [, far] = engagementBandOf(state, unit)',
    replace: '  const far = 0',
  },
  {
    // The pressure curve is a STAGE number since campaign stage 0 (§2.2), so the anchor moved
    // file. The mutation is the same one and measures the same thing.
    file: STAGES,
    label: "put §1.10's phase-0 request interval back where batch H had it",
    find: '    { fromTick: 0, engagedCap: 14, requestInterval: 9, meleeToShooter: [5, 1] },',
    replace: '    { fromTick: 0, engagedCap: 14, requestInterval: 12, meleeToShooter: [5, 1] },',
  },

  // --- spawn.ts / §1.10.1 pressure scales with the ENTERING squad (v14, fixed) ----------------
  // DERIVED FROM §1.10.1's OWN SENTENCES, fixtures unread, exactly as the header requires. The
  // section says four things and each one is a mutation here:
  //
  //   "engagedCap과 스폰 요청은 절대값이 아니라 이 스테이지에 들어온 인원에 비례한다"
  //        -> give the cap back its absolute value   (mutation 1)
  //   "요청 간격도 같은 비율로 짧아지거나 길어진다"
  //        -> leave the interval absolute             (mutation 2)
  //   "§2의 minPressureFraction이 바닥을 만든다. 사람을 잃는 것은 언제나 손해여야 한다"
  //        -> drop the floor                          (mutation 3)
  //   "매 tick의 생존 인원이 아니라 스테이지 시작 시점에 고정된 수다"
  //        -> read the LIVE standing count instead    (mutation 4)
  //
  // MUTATION 4 IS THE DEFECT THIS BATCH FIXED, PUT IN THE HARNESS. The first form of v14 scaled by
  // the live standing count and it was measured wrong: I3 went `0/8` to `1~2/8` and I8 went `0/8`
  // to `1~5/8` on every one of the seven stages, because the two policies that lose bodies fastest
  // were handed a smaller board for losing them. It replaces the old fourth mutation ("count the
  // downed as standing"), whose target line no longer exists — nothing in this rule reads `life`
  // any more, which is the point.
  //
  // MUTATION 1 AND MUTATION 3 ARE THE TWO THE ORIGINAL BRIEF NAMED and they are the two failure
  // modes on opposite sides of the rule. 1 is the coupling §1.10.1 exists to break (one variable
  // setting both the board's lethality and whether seven stages can be finished). 3 is the trap
  // §1.10.1 warns about: without a floor a squad that walked in with two bodies meets a board
  // scaled to two, and arriving short stops being a cost.
  //
  // MEASURED AGAINST `tests/battle/battle-spawn.test.ts` ALONE, every other target excluded — so
  // the digest block, which says a run is different and never which rule broke, cannot be what
  // answers. See the batch report for the run.
  //
  // MUTATION 3 IS THE ONE THAT HAD TO BE BUILT FOR rather than found: a floored fraction and an
  // unfloored one agree at every entering count from 16 down to 11, so only a fixture that opens a
  // stage with two bodies — where 0.65 stands against 0.125 — can see the clause at all.
  {
    file: SPAWN,
    label: 'give the engaged cap back its absolute value (= the v13 coupling §1.10.1 breaks)',
    find: '  return Math.max(1, ceilScaled(phase.engagedCap * pressureFractionOf(state)))',
    replace: '  return phase.engagedCap',
  },
  {
    file: SPAWN,
    label: 'leave the request interval absolute, so only half the rule scales',
    find: '  return Math.max(1, ceilScaled(phase.requestInterval / pressureFractionOf(state)))',
    replace: '  return phase.requestInterval',
  },
  {
    file: SPAWN,
    label: 'drop the floor under the fraction (= §1.10.1s trap: arriving short stops costing)',
    find: '  return raw < MIN_PRESSURE_FRACTION ? MIN_PRESSURE_FRACTION : raw',
    replace: '  return raw',
  },
  {
    file: SPAWN,
    label: 'scale by the LIVE standing count, not the entering one (= the measured v14 defect)',
    find: '  return state.friendlies.length',
    replace: "  return state.friendlies.filter((unit) => unit.life === 'standing').length",
  },

  // --- stages.ts: the stage lookup (campaign stage 0, caught by campaign stage 2) --------------
  // `stageConfigOf` is the whole of §3.1's "설정은 순수 표에서 유도한다": an id goes in and that
  // stage's numbers come out. The way it can be wrong is by ignoring the id, so that is what is
  // mutated.
  //
  // IT WAS RECORDED AS A DELIBERATE MISS, AND IT IS NOT ONE ANY MORE. Campaign stage 0 left
  // `STAGES` with exactly one row, so a lookup that always returned the first row returned the
  // right row for every input that existed — unfalsifiable, and recorded MISSED with that reason
  // written down rather than papered over with a fixture that invented its own second stage.
  // Campaign stage 2 added the other six rows, `tests/battle/battle-stages.test.ts` compares them
  // pairwise, and this mutation is CAUGHT.
  //
  // If it ever goes back to MISSED, the seven rows have stopped being distinguishable and the
  // campaign is one stage played seven times.
  {
    file: STAGES,
    label: 'look the stage up by position instead of by id',
    find: '  for (const stage of STAGES) {\n    if (stage.id === stageId) return stage\n  }',
    replace: '  return STAGES[0]',
  },

  // --- attacks.ts / §1.4.2 the command unit's melee (batch N) --------------------------------
  // DERIVED FROM §1.4.2's OWN SENTENCES, with the fixtures unread, exactly as the header above
  // requires. The section says five things about the rule and each one is a mutation here:
  //   "COMMANDER_MELEE_RANGE 안에 ... 있으면 근접으로 친다. 밖이면 기존 사거리 공격이다."
  //   "병사는 갖지 않는다" (and the melee follows the 지휘 유닛, not the role)
  //   "근접은 COMMANDER_DAMAGE보다 세고"
  //   "COMMANDER_ATTACK_INTERVAL보다 짧거나 같다"
  //   "피해 이벤트의 cause는 friendly-melee로 구분한다"
  //   "근접은 §1.8이 고른 대상이 shooter 또는 elite일 때만 나간다" (v13)
  // Plus the boundary, which §1.4.2 does not state and the implementation had to choose: `<=`,
  // the same closed edge §1.8 admits a candidate with.
  //
  // WHAT THE v13 CLAUSE MEASURED WHEN IT WAS FIRST ADDED HERE, recorded rather than tidied away.
  // The rule went into `attacks.ts`, this mutation went in next, and the fixture that catches it
  // was written afterwards — so the miss is a measurement and not a guess.
  //
  //   * Whole TARGET_TESTS set: caught, by the DIGEST BLOCK in `tests/harness` alone. That is the
  //     change detector this file's header warns about: it says the run is different and never
  //     which rule broke.
  //   * The six RULE files (TARGET_TESTS minus `tests/harness`): 112/112 GREEN with the clause
  //     deleted. Every §1.4.2 fixture in the tree at that moment used a `melee`-class body as the
  //     target, so not one of them could tell "swing inside the range" from "swing inside the
  //     range at a shooter or the elite".
  //
  // The pair fixture in `battle-combat.test.ts` ('swings at a shooter at melee range, and shoots a
  // melee-class enemy at the SAME distance') was written to close that, and the rest of the block
  // was moved off the melee class so it stops passing for the wrong reason.
  {
    file: ATTACKS,
    label: 'swing at the melee class too — the v13 clause deleted',
    find: "  if (target.kind !== 'shooter' && target.kind !== 'elite') return false",
    replace: '  if (false) return false',
  },
  {
    file: ATTACKS,
    label: 'never swing — the command unit always shoots',
    find: '  return distance <= COMMANDER_MELEE_RANGE',
    replace: '  return false',
  },
  {
    file: ATTACKS,
    label: 'swing from wherever the command unit is standing',
    find: '  return distance <= COMMANDER_MELEE_RANGE\n}',
    replace: '  return distance >= 0\n}',
  },
  {
    file: ATTACKS,
    label: 'open the melee boundary — exactly at the range is now outside it',
    find: '  // `<=`, the same closed boundary §1.8 admits a candidate with.\n  return distance <= COMMANDER_MELEE_RANGE',
    replace: '  // `<=`, the same closed boundary §1.8 admits a candidate with.\n  return distance < COMMANDER_MELEE_RANGE',
  },
  {
    file: ATTACKS,
    label: 'give the melee to the whole squad, not just the command unit',
    find: '  if (unit.id !== state.commandUnitId) return false',
    replace: '  if (false) return false',
  },
  {
    file: ATTACKS,
    label: 'swing for the rifle\'s damage',
    find: '      amount: melee ? meleeDamageOf(state) : attackDamageOf(state, unit),',
    replace: '      amount: attackDamageOf(state, unit),',
  },
  {
    file: ATTACKS,
    label: 'book the rifle\'s cooldown after a swing',
    find: '    unit.attackCooldown = melee ? meleeIntervalOf(state) : attackIntervalOf(state, unit)',
    replace: '    unit.attackCooldown = attackIntervalOf(state, unit)',
  },
  {
    file: ATTACKS,
    label: 'report a swing as a shot',
    find: "      cause: melee ? 'friendly-melee' : isCharger(state, unit) ? 'charger-melee' : 'friendly-attack',",
    replace: "      cause: isCharger(state, unit) ? 'charger-melee' : 'friendly-attack',",
  },

  // --- targeting.ts: how §1.13's cards compose with the melee --------------------------------
  // A DECISION, not a reading — §1.4.2 says nothing about the cards, and `targeting.ts` records
  // why it composes `firepower` and `연사` and deliberately withholds `사수`. Both mutations
  // remove the composition, which is the shape of the decision going the other way.
  {
    file: TARGETING,
    label: 'let the firepower card pass the melee by',
    find: '  return COMMANDER_MELEE_DAMAGE * firepowerMultiplierOf(state)',
    replace: '  return COMMANDER_MELEE_DAMAGE',
  },
  {
    file: TARGETING,
    label: 'let the rapid card pass the melee by',
    find: '  return tickDurationAfter(COMMANDER_MELEE_INTERVAL, attackIntervalMultiplierOf(state))',
    replace: '  return COMMANDER_MELEE_INTERVAL',
  },

  // --- constants.ts: §2's three bounds on the melee -------------------------------------------
  // Each value is moved OUT of the box §2 draws around it. What is being measured is whether the
  // `assertRule` at the bottom of that file actually fires: a placeholder outside its own bounds
  // must be a loud import-time failure, not a quietly different game.
  {
    file: CONSTANTS,
    label: 'let the melee reach past what a shooter can answer (§2 range bound)',
    find: 'export const COMMANDER_MELEE_RANGE = 1.2',
    replace: 'export const COMMANDER_MELEE_RANGE = 5.0',
  },
  {
    file: CONSTANTS,
    label: 'make the swing weaker than the shot (§2 damage bound)',
    find: 'export const COMMANDER_MELEE_DAMAGE = 0.5',
    replace: 'export const COMMANDER_MELEE_DAMAGE = 0.1',
  },
  {
    file: CONSTANTS,
    label: 'make the swing slower than the shot (§2 interval bound)',
    find: 'export const COMMANDER_MELEE_INTERVAL = 8',
    replace: 'export const COMMANDER_MELEE_INTERVAL = 11',
  },

  // --- battle-view/snapshot.ts: the display half of §1.4.2's `cause` ---------------------------
  // §1.4.2 gives the cause its own value so "렌더러가 베기와 사격을 추측 없이 가른다", and
  // §액션 피드백 forbids a muzzle puff on a blow landed by hand. This is that sentence inverted.
  {
    file: SNAPSHOT,
    label: 'paint a muzzle puff on the commander\'s swing',
    find: "  'friendly-melee': 'melee',",
    replace: "  'friendly-melee': 'shot',",
  },

  // --- §1.2.1: the class the player can SEE ---------------------------------------------------
  // The charger was a melee class in the simulation and a rifleman on the board for four batches,
  // because nothing between `attacks.ts` and the renderer carried the class. These three are that
  // gap, one link each: the blow's label, the body's kind, and the puff on the swing.
  {
    file: ATTACKS,
    label: 'label the charger\'s cleaver as a rifle shot',
    find: "      cause: melee ? 'friendly-melee' : isCharger(state, unit) ? 'charger-melee' : 'friendly-attack',",
    replace: "      cause: melee ? 'friendly-melee' : 'friendly-attack',",
  },
  {
    file: SNAPSHOT,
    label: 'project the front rank as riflemen',
    find: "  return isChargerSlot(assignment ? assignment.slotIndex : null) ? 'charger' : 'soldier'",
    replace: "  return 'soldier'",
  },
  {
    file: SNAPSHOT,
    label: 'paint a muzzle puff on the charger\'s swing',
    find: "  'charger-melee': 'melee',",
    replace: "  'charger-melee': 'shot',",
  },

  // --- the relay's decision points (campaign §1.1, §1.2, §1.3, §1.4, §1.5, §3.2) --------------
  //
  // WHERE THIS LIST COMES FROM, and it is the same rule the header states: the campaign design's
  // own sentences, with the fixtures unread. §1.1 names THREE things that must not reset and says
  // what happens if one of them does ("하나라도 초기화되면 일곱 판이 아니라 같은 판 일곱 번이다"),
  // so each of the three carries a mutation that resets it. §1.2 puts the thresholds on the
  // campaign's kills and the cards on the campaign's history; §1.3 kills whoever is still down;
  // §1.4 refuses a stage retry; §1.5 hands command to the successor; §3.2 derives the seed. Every
  // clause in that paragraph is one row below.
  //
  // A MUTATION HERE IS NOT A BUG SOMEONE MIGHT WRITE — it is the rule stated backwards. "The
  // transition heals nothing" is exactly §1.1 v2's "생존자의 HP는 스테이지 시작 시 최대치로
  // 회복한다" inverted, and if nothing fails when it is inverted then the sentence is decorative.
  //
  // THE ROW BELOW CHANGED DIRECTION WHEN §1.1 DID. Until v2 the row here was `hp: unit.hp` ->
  // `hp: unit.maxHp`, labelled "heal the squad on the way out of a stage": v1 forbade healing and
  // the mutation was the heal. v2 corrects the clause — tuning batch 2 measured v1's version into
  // an arithmetic impossibility — so the mutation is now the OTHER direction, and it is still one
  // row rather than two because a rule and its inverse are one decision.
  {
    file: TRANSITION,
    label: 'the stage boundary heals nothing, as §1.1 v1 had it (§1.1 v2)',
    find: '        hp: unit.maxHp,',
    replace: '        hp: unit.hp,',
  },
  {
    file: STATE,
    label: 'refill a carried body on the way INTO a stage (§1.1)',
    find: '    hp: health ? health.hp : maxHp,',
    replace: '    hp: maxHp,',
  },
  {
    // TWO SENTENCES AT ONCE SINCE v2, and that is a property of the code rather than of this row:
    // the healed number is written inside the `standing` branch, so widening the branch carries
    // the downed AND hands them full hp. §1.3's "쓰러진 병사는 사망 처리한다" and §1.1 v2's
    // "회복되는 것은 서 있는 사람뿐" fail together because they are one `if`.
    file: TRANSITION,
    label: 'carry the downed as if the end of a stage rescued them, healed (§1.3, §1.1 v2)',
    find: "    if (unit.life === 'standing') {",
    replace: "    if (unit.life !== 'dead') {",
  },
  {
    // The other half of the same seam, and the reason it is a SECOND row: the one above widens
    // the branch, so it also carries the DEAD and any fixture counting bodies notices. This one
    // touches only the `downed`, on the exact path §1.3 sends them down — the boundary picks them
    // up, heals them to full and never writes them to the record. It is §1.1 v2's "회복되는 것은
    // 서 있는 사람뿐이고, 쓰러진 채 스테이지가 끝나면 §1.3대로 죽는다" with the "서 있는" removed,
    // which is the reading a relay would drift into if healing were written beside §1.3's `if`
    // rather than inside it.
    file: TRANSITION,
    label: 'heal the downed as well, so the end of a stage is a free rescue (§1.1 v2, §1.3)',
    find: '    fallen.push({ id: unit.id, nameIndex: unit.nameIndex, stageId: battle.stageId })',
    replace:
      '    if (unit.life === \'downed\') {\n' +
      '      survivors.push({ id: unit.id, role: unit.role, nameIndex: unit.nameIndex, hp: unit.maxHp, maxHp: unit.maxHp })\n' +
      '      continue\n' +
      '    }\n' +
      '    fallen.push({ id: unit.id, nameIndex: unit.nameIndex, stageId: battle.stageId })',
  },
  {
    file: UPGRADES,
    label: 'drop the cards earlier stages earned (§1.1)',
    find: '  const chosen: CardId[] = [...state.upgrades.carriedCards]',
    replace: '  const chosen: CardId[] = []',
  },
  {
    file: UPGRADES,
    label: 'stop reading the carried cards, so their effects lapse (§1.2)',
    find: '  if (state.upgrades.carriedCards.includes(card)) return true',
    replace: '  if (false) return true',
  },
  {
    file: UPGRADES,
    label: 'offer a card the squad already holds (§1.2)',
    find: '  const pool = state.upgrades.remainingPool.filter((card) => !hasUpgrade(state, card))',
    replace: '  const pool = [...state.upgrades.remainingPool]',
  },
  {
    file: TRANSITION,
    label: 'reset the kill count every stage (§1.2)',
    find: '  const kills = campaign.kills + battle.stats.kills',
    replace: '  const kills = battle.stats.kills',
  },
  {
    file: TRANSITION,
    label: 'forget the stages before this one when recording the dead (§1.14)',
    find: '  const fallen: CampaignCasualty[] = [...campaign.fallen]',
    replace: '  const fallen: CampaignCasualty[] = []',
  },
  {
    file: UPGRADES,
    label: 'measure §1.13 thresholds against the stage instead of the campaign (§1.2)',
    find: '  if (campaignKills(state) < UPGRADE_KILL_THRESHOLDS[index]) return null',
    replace: '  if (state.stats.kills < UPGRADE_KILL_THRESHOLDS[index]) return null',
  },
  {
    file: STATE,
    label: 'leave a threshold the carried kills already passed unspent (§1.2)',
    find: '  while (index < UPGRADE_KILL_THRESHOLDS.length && UPGRADE_KILL_THRESHOLDS[index] <= priorKills) {',
    replace: '  while (index < UPGRADE_KILL_THRESHOLDS.length && UPGRADE_KILL_THRESHOLDS[index] < priorKills) {',
  },
  {
    file: TRANSITION,
    label: 'let a lost stage be retried (§1.4)',
    find: "    ? ({ phase: 'campaign-over', end: 'defeat' } as const)",
    replace: "    ? ({ phase: 'stage-cleared', end: null } as const)",
  },
  {
    file: TRANSITION,
    label: 'hand on a squad with nobody in it (§1.5)',
    find: '    commandUnitId === null ? null : { commandUnitId, members: survivors }',
    replace: '    { commandUnitId: commandUnitId ?? 0, members: survivors }',
  },
  {
    file: STATE,
    label: "send command back to the stage's dead commander (§1.5)",
    find: '    originalCommanderId: commandUnitId,',
    replace: '    originalCommanderId: COMMANDER_ID,',
  },
  {
    file: CAMPAIGN_SEED,
    label: 'suffix the first stage as well, voiding every recorded seed (§3.2)',
    find: '  if (stageId === FIRST_STAGE_ID) return rootSeed',
    replace: '  if (false) return rootSeed',
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
