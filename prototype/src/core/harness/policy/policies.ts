// §4.1's six policies, plus the two player models §3 asks `skilled` to be verified against.
//
// ---------------------------------------------------------------------------
// `skilled` IS FIXED BEFORE THE SWEEP STARTS
// ---------------------------------------------------------------------------
// §3: "`skilled`는 스윕 시작 전에 확정하고, 스윕 중에 수정하지 않는다. 수정이 필요하면 스윕을
// 처음부터 다시 돌린다." The tuning pass (§5 stages 2-8) changes `constants.ts` and NOT this
// file. If a gate can only be passed by editing a decision below, the sweep restarts — that is
// the rule, and editing here instead is how a balance number gets a policy built around it.
//
// Everything here is expressed against the CONSTANTS rather than against copies of their current
// values, for the same reason: a sweep that moves `SHOOTER_RANGE` moves where `skilled` stands
// without anybody editing a policy.
//
// ---------------------------------------------------------------------------
// ONE POLICY, FIVE ONE-POINT VARIANTS
// ---------------------------------------------------------------------------
// §4.1 defines the five as "`skilled`에서 한 가지만 바꾼 변형". That claim is only worth
// something if it is true of the CODE, so the shape here is a record of decision points
// (`PolicyRules`) with `SKILLED_RULES` as its one filled-in instance, and each variant is a
// spread with exactly one key replaced. `POLICY_OVERRIDES` holds those replacements as data, and
// `tests/harness/policy-behaviour.test.ts` asserts that each of the five names exactly one key
// and that every other hook is the SAME FUNCTION REFERENCE as `skilled`'s — a copy-pasted
// variant fails that even if it behaves identically today.
//
// The two `skilled` player models (§3) are NOT one-point variants and are not held to that:
// they are a second and third person playing the same game, and they differ in where they choose
// to stand and how often they re-aim.
//
// ---------------------------------------------------------------------------
// WHAT A POLICY IS ALLOWED TO DO
// ---------------------------------------------------------------------------
// It reads a `PolicyView` (never `BattleState`) and returns `BattleCommand`s, which the runner
// hands to the facade. It never touches the state, never calls a rule, and never pauses.
//
// The movement commands carry a WORLD-SPACE OFFSET rather than one of §1.15's eight key
// vectors, which is the pointer half of §1.15's vocabulary ("포인터 드래그"): the core reads
// `state.input.move` as a direction and normalizes it, and an offset shorter than
// `ARRIVE_EPSILON` is clamped to zero here exactly as `BattleInputQueue.pointerDrag` clamps it.

import {
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  MELEE_RANGE,
  RANGE_ADVANTAGE,
  RESCUE_RANGE,
  RESCUE_TICKS,
  SHOOTER_RANGE,
  SOLDIER_RANGE,
} from '../../battle/constants'
import type { BattleCommand } from '../../battle/input'
import type { Vec2 } from '../../battle/types'
import type { EnemyView, FriendlyView, PolicyView } from './view'

export type Policy = {
  readonly id: string
  /** The commands to enqueue for this tick. An empty array is "no input". */
  decide(view: PolicyView): BattleCommand[]
}

/**
 * §4.1's constructor. A policy is built fresh for every run, so any memory it keeps is a
 * property of that run and two runs of the same policy on the same seed decide identically.
 *
 * NONE OF THE POLICIES IN THIS FILE READS THE SEED. Every decision below is a function of the
 * view. The parameter is in the signature because a policy that wants a coin flip has to derive
 * it from this string — `Math.random` is forbidden under `src/core`, and a fourth PRNG stream in
 * `BattleState` would move every recorded digest. No policy here wants one, and there is no
 * harness PRNG in this batch to suggest otherwise.
 */
export type PolicyFactory = (seed: string) => Policy

// ---------------------------------------------------------------------------
// The decision points
// ---------------------------------------------------------------------------

/** Why the command unit is moving. `camps-in-place` is the variant that filters on it. */
export type MoveReason = 'elite-dodge' | 'rescue-approach' | 'standoff' | 'flee'

export type Intent =
  /** Stand still with nothing held. */
  | { kind: 'hold' }
  | { kind: 'move'; direction: Vec2; reason: MoveReason }
  /** Stand still and hold `Space` — §1.11's lock needs a zero movement vector. */
  | { kind: 'rescue' }

/** Where the policy wants to stand relative to a body, as an inclusive distance band. */
export type StandoffGoal = {
  position: Vec2
  band: readonly [number, number]
}

/** The run-local memory a policy keeps. It lives here and never in `BattleState`. */
export type PolicyMemory = {
  /** §1.5 zeroes the held vector on succession, so the harness has to notice a new body. */
  commandUnitId: number | null
  /** What the battle was last told is held, so a held input is not re-sent every tick. */
  sentMove: Vec2
  sentSpace: boolean
  /** The heading a reposition is committed to, and for how many more ticks. */
  committedDirection: Vec2 | null
  commitRemaining: number
}

export type PolicyRules = {
  readonly id: string
  /** The whole per-tick decision. `tactical-no-input` and `flees-always` replace this. */
  intent(view: PolicyView, memory: PolicyMemory, rules: PolicyRules): Intent
  /** Which movements the policy is willing to make. `camps-in-place` replaces this. */
  allowsMove(reason: MoveReason): boolean
  /** Where to stand, and against what. `ignores-range` replaces this. */
  standoff(view: PolicyView): StandoffGoal | null
  /** Whether the policy ever sends `set-rescue`. `abandons-downed` replaces this. */
  rescues: boolean
  /** How long a reposition holds its heading before re-aiming. */
  commitTicks: number
}

// ---------------------------------------------------------------------------
// Geometry, in the plain forms the rules use
// ---------------------------------------------------------------------------

const ZERO: Vec2 = { x: 0, y: 0 }

function offset(from: Vec2, to: Vec2): Vec2 {
  return { x: to.x - from.x, y: to.y - from.y }
}

function magnitude(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y)
}

function distanceBetween(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

function negate(vector: Vec2): Vec2 {
  return { x: -vector.x, y: -vector.y }
}

function sameVector(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y
}

/**
 * The nearest of a list, ties by ascending id.
 *
 * The view hands rows out in ascending id and the comparison below is strict, so the first of
 * two equidistant bodies wins — which is the tie-break §1.5, §1.8 and §1.9 all use.
 */
function nearestEnemy(enemies: readonly EnemyView[], from: Vec2): EnemyView | null {
  let best: EnemyView | null = null
  let bestDistance = Infinity
  for (const enemy of enemies) {
    const distance = distanceBetween(from, enemy.position)
    if (distance < bestDistance) {
      best = enemy
      bestDistance = distance
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// `skilled`'s three decisions
// ---------------------------------------------------------------------------

/**
 * How far outside §1.12's circle the dodge keeps walking.
 *
 * Leaving on the edge is not leaving: the impact is measured at IMPACT time against the frozen
 * centre, and a body sitting exactly on the radius is one clamp away from being inside it.
 */
const ELITE_DODGE_MARGIN = 0.75

/**
 * The band `skilled` wants to stand in, as a fraction of §1.6's range advantage.
 *
 * Written as a fraction rather than as metres so a sweep of `SHOOTER_RANGE` (§2 axis 1) carries
 * the policy with it. The lower edge sits just inside the gap so the shooter cannot answer; the
 * upper edge is soldier range, because past it the squad stops shooting at all.
 */
const SKILLED_STANDOFF_FRACTION = 0.4
const SKILLED_COMMIT_TICKS = 12

function eliteDodgeIntent(view: PolicyView, command: FriendlyView): Intent | null {
  const telegraph = view.eliteTelegraph
  if (telegraph === null) return null

  const away = offset(telegraph.center, command.position)
  if (magnitude(away) > telegraph.radius + ELITE_DODGE_MARGIN) return null
  // Standing exactly on the frozen centre gives no direction to run in; any heading leaves.
  return { kind: 'move', direction: magnitude(away) === 0 ? { x: 1, y: 0 } : away, reason: 'elite-dodge' }
}

/**
 * The downed body worth going back for: nearest first, and only if the trip fits in the time
 * the body has left (§1.11's `DOWNED_TICKS` countdown, which the view carries).
 *
 * The reachability test uses §1.2's ANCHOR speed, not the speed after §1.13's `mobility` card:
 * the policy does not read the chosen cards, and under-estimating its own speed makes it give
 * up on a body it could have reached, never the other way round.
 */
function reachableDownedFriendly(view: PolicyView, command: FriendlyView): FriendlyView | null {
  let best: FriendlyView | null = null
  let bestDistance = Infinity

  for (const unit of view.friendlies) {
    if (unit.life !== 'downed') continue
    const distance = distanceBetween(command.position, unit.position)
    if (distance >= bestDistance) continue
    const travelTicks = Math.max(0, distance - RESCUE_RANGE) / COMMANDER_MOVE_SPEED
    if (travelTicks + RESCUE_TICKS > unit.downedTicksRemaining) continue
    best = unit
    bestDistance = distance
  }

  return best
}

function rescueIntent(view: PolicyView, command: FriendlyView): Intent | null {
  // A lock already running is kept: releasing `Space` would throw the progress away (§1.11).
  if (view.rescue !== null) return { kind: 'rescue' }
  if (view.rescueCandidateId !== null) return { kind: 'rescue' }

  const target = reachableDownedFriendly(view, command)
  if (target === null) return null
  return { kind: 'move', direction: offset(command.position, target.position), reason: 'rescue-approach' }
}

function standoffIntent(view: PolicyView, command: FriendlyView, rules: PolicyRules): Intent {
  const goal = rules.standoff(view)
  if (goal === null) return { kind: 'hold' }

  const toGoal = offset(command.position, goal.position)
  const distance = magnitude(toGoal)
  // Standing on top of the body it is measuring against: too close by any band, and no direction
  // to back off along.
  if (distance === 0) return { kind: 'move', direction: { x: 1, y: 0 }, reason: 'standoff' }
  if (distance < goal.band[0]) return { kind: 'move', direction: negate(toGoal), reason: 'standoff' }
  if (distance > goal.band[1]) return { kind: 'move', direction: toGoal, reason: 'standoff' }
  return { kind: 'hold' }
}

/**
 * §4.1's `skilled`: dodge the telegraph, then go back for a body, then stand in the gap.
 *
 * The order is a priority, and it is the one §1 makes: the blast is the only thing on the board
 * that can take the whole formation at once (§1.12), a downed body has a countdown on it
 * (§1.11), and where to stand is the standing question the rest of the time (§1.6).
 */
function skilledIntent(view: PolicyView, _memory: PolicyMemory, rules: PolicyRules): Intent {
  const command = view.command
  if (command === null || command.life !== 'standing') return { kind: 'hold' }

  const dodge = eliteDodgeIntent(view, command)
  if (dodge !== null) return dodge

  if (rules.rescues) {
    const rescue = rescueIntent(view, command)
    if (rescue !== null) return rescue
  }

  return standoffIntent(view, command, rules)
}

/**
 * §1.6's range advantage, as a place to stand.
 *
 * The body it measures against is the nearest SHOOTER, because the shooter is the only enemy
 * the gap is a gap against: `SHOOTER_RANGE < SOLDIER_RANGE` is what makes a stopping point safe.
 * With no shooter on the board it falls back to the nearest body of any kind, so the policy
 * still keeps a melee at arm's length rather than standing in the middle of the board.
 */
function rangeAdvantageStandoff(view: PolicyView): StandoffGoal | null {
  const command = view.command
  if (command === null) return null

  const shooters = view.enemies.filter((enemy) => enemy.kind === 'shooter')
  const target = nearestEnemy(shooters.length > 0 ? shooters : view.enemies, command.position)
  if (target === null) return null

  return {
    position: target.position,
    band: [SHOOTER_RANGE + RANGE_ADVANTAGE * SKILLED_STANDOFF_FRACTION, SOLDIER_RANGE],
  }
}

// ---------------------------------------------------------------------------
// The rules `skilled` is, and the points the variants replace
// ---------------------------------------------------------------------------

export const SKILLED_RULES: PolicyRules = {
  id: 'skilled',
  intent: skilledIntent,
  allowsMove: () => true,
  standoff: rangeAdvantageStandoff,
  rescues: true,
  commitTicks: SKILLED_COMMIT_TICKS,
}

/** §4.1 `tactical-no-input`: the card screen and nothing else. */
function noInputIntent(): Intent {
  return { kind: 'hold' }
}

/** §4.1 `flees-always`: straight away from the nearest living enemy, every tick, forever. */
function fleeIntent(view: PolicyView): Intent {
  const command = view.command
  if (command === null || command.life !== 'standing') return { kind: 'hold' }

  const nearest = nearestEnemy(view.enemies, command.position)
  if (nearest === null) return { kind: 'hold' }

  const away = offset(nearest.position, command.position)
  if (magnitude(away) === 0) return { kind: 'hold' }
  return { kind: 'move', direction: away, reason: 'flee' }
}

/**
 * §4.1 `ignores-range`: the same policy with the gap taken out of "where do I stop".
 *
 * It stops when it is in contact with the nearest body of any kind — the band's lower edge is 0,
 * so it never backs off, and its upper edge is melee contact range, so it walks in until it is
 * being hit. That is §4.1's "적에게 붙어서 멈춘다", and it is the whole difference.
 */
function contactStandoff(view: PolicyView): StandoffGoal | null {
  const command = view.command
  if (command === null) return null

  const target = nearestEnemy(view.enemies, command.position)
  if (target === null) return null
  return { position: target.position, band: [0, MELEE_RANGE] }
}

/** §4.1 `camps-in-place`: only §1.12's blast is worth taking a step for. */
function dodgeOnly(reason: MoveReason): boolean {
  return reason === 'elite-dodge'
}

/**
 * The five one-point replacements, as data.
 *
 * Kept separate from the built rules so a fixture can assert what §4.1 claims: exactly one key
 * each. `skilled` is absent because it replaces nothing.
 */
export const POLICY_OVERRIDES: Readonly<Record<string, Partial<PolicyRules>>> = {
  'tactical-no-input': { intent: noInputIntent },
  'flees-always': { intent: fleeIntent },
  'camps-in-place': { allowsMove: dodgeOnly },
  'ignores-range': { standoff: contactStandoff },
  'abandons-downed': { rescues: false },
}

/**
 * §3's second and third player models, which are NOT one-point variants of `skilled`.
 *
 * §3 asks for two of them so that a tune fitted to one person's habits is visible as a tune:
 * "한 사람이 쓴 단일 플레이어 모델에 맞춰 튜닝하면 그 모델에서만 유효한 수치가 나온다."
 * Both play the same game as `skilled` and differ in the two things a player actually varies —
 * how much room they leave, and how often they re-aim.
 */
function conservativeStandoff(view: PolicyView): StandoffGoal | null {
  const goal = rangeAdvantageStandoff(view)
  if (goal === null) return null
  return { position: goal.position, band: [SHOOTER_RANGE + RANGE_ADVANTAGE * 0.75, SOLDIER_RANGE] }
}

function aggressiveStandoff(view: PolicyView): StandoffGoal | null {
  const goal = rangeAdvantageStandoff(view)
  if (goal === null) return null
  return {
    position: goal.position,
    band: [SHOOTER_RANGE + RANGE_ADVANTAGE * 0.05, SHOOTER_RANGE + RANGE_ADVANTAGE * 0.5],
  }
}

const PLAYER_MODEL_OVERRIDES: Readonly<Record<string, Partial<PolicyRules>>> = {
  'skilled-conservative': { standoff: conservativeStandoff, commitTicks: 30 },
  'skilled-aggressive': { standoff: aggressiveStandoff, commitTicks: 4 },
}

/** §4.1's six, in the order the table lists them. */
export const POLICY_IDS = [
  'tactical-no-input',
  'flees-always',
  'camps-in-place',
  'skilled',
  'ignores-range',
  'abandons-downed',
] as const

/** §3's two `skilled` player models. */
export const SKILLED_MODEL_IDS = ['skilled-conservative', 'skilled-aggressive'] as const

export type PolicyId = (typeof POLICY_IDS)[number] | (typeof SKILLED_MODEL_IDS)[number]

function rulesFor(id: PolicyId): PolicyRules {
  const override = POLICY_OVERRIDES[id] ?? PLAYER_MODEL_OVERRIDES[id] ?? {}
  return { ...SKILLED_RULES, ...override, id }
}

/** Every built rule set, by id — exported so a fixture can compare hooks by reference. */
export const POLICY_RULES: Readonly<Record<PolicyId, PolicyRules>> = Object.fromEntries(
  [...POLICY_IDS, ...SKILLED_MODEL_IDS].map((id) => [id, rulesFor(id)]),
) as Record<PolicyId, PolicyRules>

// ---------------------------------------------------------------------------
// From an intent to §1.15's commands
// ---------------------------------------------------------------------------

/**
 * §1.13's card choice, shared by every policy above.
 *
 * IT IS THE FIRST OFFERED CARD, and that is deliberate rather than lazy. §4.1's table has no
 * card-choice variant, so a preference order would be a difference every policy shares and none
 * of the six isolates — it would move all eight bands together and show up in the sweep as a
 * property of the balance. Every measurement recorded on this branch (batches D, E and E0) took
 * the first card, so keeping it also makes the `flees-always` regression below a check of the
 * reducer rather than of a card ranking.
 */
const FIRST_OFFERED_SLOT = 1

function commandsFor(rules: PolicyRules, memory: PolicyMemory, view: PolicyView): BattleCommand[] {
  const commands: BattleCommand[] = []

  // §1.1 stops the clock at the card screen and §1.13 only leaves it on a choice, so this is the
  // one input every policy makes — `tactical-no-input` included (§4.1 says so in as many words).
  if (view.pendingUpgrade !== null) {
    commands.push({ kind: 'choose-upgrade', slot: FIRST_OFFERED_SLOT })
    return commands
  }

  // §1.5: the promoted body starts with a zero movement vector. The harness's record of what the
  // battle believes is held is stale exactly there, so it is dropped and the next decision is
  // sent in full — which is what a player does when the body under their hands changes.
  const commandUnitId = view.command === null ? null : view.command.id
  if (commandUnitId !== memory.commandUnitId) {
    memory.commandUnitId = commandUnitId
    memory.sentMove = ZERO
    memory.committedDirection = null
    memory.commitRemaining = 0
  }

  let intent = rules.intent(view, memory, rules)

  // A reposition holds its heading for `commitTicks` ticks rather than re-aiming every tick at
  // whichever body is nearest this frame. It never outlives the decision to move: the moment the
  // policy is in its band (or has something better to do) the intent stops being a standoff move
  // and the commitment is dropped.
  if (intent.kind === 'move' && intent.reason === 'standoff') {
    if (memory.commitRemaining > 0 && memory.committedDirection !== null) {
      intent = { kind: 'move', direction: memory.committedDirection, reason: 'standoff' }
      memory.commitRemaining -= 1
    } else {
      memory.committedDirection = intent.direction
      memory.commitRemaining = rules.commitTicks
    }
  } else {
    memory.committedDirection = null
    memory.commitRemaining = 0
  }

  let move: Vec2 = ZERO
  let space = false
  if (intent.kind === 'move' && rules.allowsMove(intent.reason)) {
    // §1.15's pointer clamp, applied on this side of the queue: an offset this short is not a
    // direction anybody meant, and the queue would clamp it to zero anyway.
    move = magnitude(intent.direction) < ARRIVE_EPSILON ? ZERO : intent.direction
  } else if (intent.kind === 'rescue') {
    space = true
  }

  if (!sameVector(move, memory.sentMove)) {
    // `keydown` is §1.11's cancel event, so it is only true where a player would actually press
    // a key from rest. A change of heading while already moving is modelled as the release-and-
    // hold it usually is, and carries no keydown; a standing start does, which is what cancels a
    // lock when the telegraph forces the rescuer to run.
    const keydown = !sameVector(move, ZERO) && sameVector(memory.sentMove, ZERO)
    commands.push({ kind: 'set-move', move: { x: move.x, y: move.y }, keydown })
    memory.sentMove = { x: move.x, y: move.y }
  }

  if (space !== memory.sentSpace) {
    commands.push({ kind: 'set-rescue', held: space })
    memory.sentSpace = space
  }

  return commands
}

export function createPolicyFrom(rules: PolicyRules): Policy {
  const memory: PolicyMemory = {
    commandUnitId: null,
    sentMove: ZERO,
    sentSpace: false,
    committedDirection: null,
    commitRemaining: 0,
  }

  return {
    id: rules.id,
    decide: (view) => commandsFor(rules, memory, view),
  }
}

/** §4.1's policies by name, as the factory the runner takes. */
export function policyFactory(id: PolicyId): PolicyFactory {
  const rules = POLICY_RULES[id]
  return () => createPolicyFrom(rules)
}
