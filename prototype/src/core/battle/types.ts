// The authoritative state of a commander battle (§1).
//
// Shape rules, so that the later batches can add behaviour without reshaping it:
//
//   * Every field named by §1.17's digest list exists here, and nothing that the
//     digest must not see (derived caches, renderer state) does. `digest.ts` walks
//     the whole object, so "in the state" and "in the digest" are the same thing
//     and a new rule cannot silently escape replay.
//   * Fields owned by a later batch are present and inert, not absent. Adding a
//     field later would change every recorded digest; adding behaviour to a field
//     that was already there does not.
//   * There is no terrain (§1.6). The arena is an empty plane, the only movement
//     boundary is the arena clamp (§1.7), and nothing in this file may reach into
//     `gameplay/terrain.ts` or `gameplay/geometry.ts` — those stay in the repository as
//     the evidence that cover was measured and rejected. See §2's 폐기 기록.
//
// THE RULE THAT PAYS FOR THE FIRST BULLET — read this before adding a field:
//
//     NOTHING SCRATCH GOES IN `BattleState`.
//
// No memoized lists, no per-tick accumulators kept "for convenience", no debug or
// renderer fields. The digest walks the whole object, so a scratch field silently
// changes every digest in the project and invalidates every recorded 8-seed band —
// with no test failing, because nothing asserts a digest VALUE, only that two runs
// agree. Derived and temporary values are returned from functions instead
// (`movementBlockers`, `friendliesById`, the displacement returned by
// `advanceCommandUnit`). A field belongs here only if a later tick reads it.
//
// WHAT THE RULE DOES NOT BAN, because campaign stage 1 had to draw the line: a value the battle
// cannot DERIVE is not scratch, however convenient it also is. Two such values arrived with the
// relay — `upgrades.carriedCards` and `stats.priorKills` — and each carries its own argument at
// its declaration. The test is the same one stated above and it is not softened: a later tick
// reads both (the card effects every tick, the threshold test on every kill), and neither is a
// function of anything else on the state. A field that IS such a function is still scratch, which
// is why `upgrades.nextThresholdIndex` is derived from `priorKills` at construction rather than
// carried, and why the roster arrives as `friendlies` rows rather than as a second copy.
//
// This is enforced, not merely asserted: `tests/battle/battle-state.test.ts` pins the
// exact key set of `BattleState` AND of every nested object in it — `spawn`, `elite`,
// `upgrades`, `rescue`, `stats`, `input`, and both unit rows — so adding a field anywhere
// in the tree is a deliberate act that has to be argued for in a diff. The nested pins
// exist because the top-level one alone was not enough: batch C added
// `spawn.requestsInPhase` and nothing failed.

import type { CardId } from './constants'
import type { StageId } from './stages'
import type { BattlePrngStates } from './streams'

export type Vec2 = { x: number; y: number }

/** §1.1: `paused` / `awaiting-upgrade` / hidden do not advance `combatTick`. */
export type BattleMode = 'ready' | 'running' | 'paused' | 'awaiting-upgrade' | 'won' | 'lost'
export type BattleResult = 'won' | 'lost' | null
/** §1.16: `all-units-lost` outranks `elite-survived`. */
export type FailureReason = 'all-units-lost' | 'elite-survived' | null

export type LifeState = 'standing' | 'downed' | 'dead'
export type FriendlyRole = 'commander' | 'soldier'
/**
 * §1.9 plus the elite (§1.12).
 *
 * The elite is an enemy, not a parallel entity: §1.8 ranks it *inside* the enemy
 * candidate list ("정예 우선 → 최근접 → id"), §1.12 gives it damage and a body, and
 * §1.17 asks for "적 전체의 같은 항목과 병종". A separate embedded object would
 * force every one of those rules to special-case it, and merging it later would
 * change the digest after the 8-seed bands are recorded.
 */
export type EnemyKind = 'melee' | 'shooter' | 'elite'

export type FriendlyUnit = {
  id: number
  /** Fixed for the whole run — succession moves command, never the body's role. */
  role: FriendlyRole
  /** §1.14: index into `NAME_POOL`, preserved through death. */
  nameIndex: number
  hp: number
  maxHp: number
  life: LifeState
  position: Vec2
  attackCooldown: number
  targetId: number | null
  /** §1.14: the tick this unit died, or null while it is standing or downed. */
  deathTick: number | null
  /** §1.11 — owned by the rescue batch. */
  downedTicks: number
  /** §1.11 — owned by the rescue batch. */
  invulnerableTicks: number
  /** §1.14: ids of everyone who has ever rescued this unit, in rescue order. */
  rescuedByIds: number[]
  /**
   * This tick's actual displacement, arena clamp included. Written by every movement rule.
   *
   * NO RULE READS IT. §1.3's stop test was its only consumer, and v9 deleted the test. It is
   * kept as recorded motion — the fixtures assert against it, and the digest uses it to tell a
   * follower settled inside §1.4's dead-band from one still creeping — which puts it in tension
   * with the no-scratch rule above ("a field belongs here only if a later tick reads it").
   * Deleting it is a digest-schema change and is left to whoever needs one; what is NOT open is
   * re-gating a rule on it, which would be reintroducing §1.3's v6 form.
   */
  lastDisplacement: number
}

export type EnemyUnit = {
  id: number
  kind: EnemyKind
  hp: number
  maxHp: number
  /** Enemies never go `downed`; the field is shared so the digest shape is uniform. */
  life: LifeState
  position: Vec2
  attackCooldown: number
  targetId: number | null
  deathTick: number | null
  lastDisplacement: number
  /** §1.9 — the friendly whose contact/target slot this enemy holds. */
  contactSlotOwnerId: number | null
}

/**
 * What the two attack passes and the elite impact hand to `applyDamage` (§1.16).
 *
 * It is a RETURN VALUE, never a field on `BattleState` — see the no-scratch rule at the
 * top of this file. `applyDamage` receives the concatenation of the three producers in §1.16's
 * order (friendly attacks, enemy attacks, elite impact) and applies them in that order; within
 * one producer the list is in ascending attacker id.
 *
 * `amount` is the ATTACKER-side number, already carrying anything that scales with the
 * attacker (§1.13's `firepower`). Defender-side modifiers — §1.11's `invulnerableTicks`,
 * §1.13's `cover` — belong to the step that applies it, which is also the only step that
 * may observe an overkill: a 1.0-HP melee can legally receive sixteen simultaneous
 * events, and I2's accounting has to be able to see and discard the excess.
 *
 * `side` is the attacker's side; the target is on the other one. v6 has no friendly
 * fire, and §1.12 gives the elite blast friendly targets only.
 */
export type DamageSide = 'friendly' | 'enemy'

/**
 * Which weapon produced the blow. SIX VALUES, one per thing that can hit something.
 *
 * `charger-melee` is §1.2.1's. It is NOT `friendly-melee`: that value names §1.4.2's rule, which
 * only the command unit can satisfy, and three tests assert exactly that. Folding the charger
 * into it would make each of them pass for the wrong reason. The two are separate weapons that
 * happen to share a hand, and the renderer wants them separate anyway — a charger's swing is a
 * cleaver's, not the command unit's.
 *
 * `friendly-melee` is §1.4.2's (batch N): the command unit inside `COMMANDER_MELEE_RANGE` of a
 * `shooter` or the `elite` (v13 — a melee-class target gets the ranged attack). It is
 * a separate value rather than a flag on `friendly-attack` because the renderer has to tell a
 * swing from a shot without guessing — §액션 피드백 forbids a muzzle puff on a blow landed by
 * hand, and the distance alone cannot decide it (a soldier at the same distance IS shooting).
 *
 * ADDING A VALUE HERE DOES NOT TOUCH `BattleState`. `DamageEvent` is a return value of the
 * attack steps and reaches the outside on `TickResult`; §1.17's digest walks the state and never
 * sees one. `tests/battle/battle-state.test.ts`'s key-set pins are what hold that.
 */
export type DamageCause =
  | 'friendly-attack'
  | 'friendly-melee'
  | 'charger-melee'
  | 'melee-contact'
  | 'shooter-shot'
  | 'elite-blast'

export type DamageEvent = {
  side: DamageSide
  attackerId: number
  targetId: number
  amount: number
  cause: DamageCause
}

/**
 * §1.4: fixed id-ascending slot assignment, never recomputed.
 *
 * There is no pull and no latch. Both existed only because a slot could land inside
 * movement-blocking terrain, and §1.6 removed terrain: a slot is now always exactly
 * `command unit + offset`, so the follower's target is a fixed world point whenever the
 * command unit stands still — which is what §1.4's settle dead-band needs in order to
 * produce a displacement of exactly 0.
 */
export type SlotAssignment = {
  unitId: number
  /** Index into `FORMATION_SLOTS`. */
  slotIndex: number
}

/** §1.10: a spawn request keeps the coordinate fixed at the tick it was made. */
export type SpawnRequest = {
  id: number
  kind: EnemyKind
  position: Vec2
  requestedTick: number
  /** Monotonic; defines backlog order and the oldest-first discard. */
  sequence: number
}

export type SpawnState = {
  backlog: SpawnRequest[]
  /** Next id handed to an enemy. Reserved at request time so backlog ids are stable. */
  nextEnemyId: number
  nextRequestSequence: number
  lastRequestTick: number
  /**
   * §1.10: how many requests this pressure phase has made, which is the index the
   * melee:shooter ratio walks.
   *
   * It has to be remembered rather than derived: the tick a phase makes its first request
   * on depends on when the previous phase made its last one, so the count is not a function
   * of `combatTick`. It resets when the phase of `lastRequestTick` differs from the phase of
   * the current tick.
   */
  requestsInPhase: number
  /** §1.10: discarded because the backlog was already full. */
  discardedByBacklogOverflow: number
  /** §1.10: discarded because the absolute live cap was reached. */
  discardedByAbsoluteCap: number
}

/**
 * §1.12: the elite's ATTACK cycle only — telegraph, impact, cooldown.
 *
 * Lifecycle (present / alive / dead) is NOT here: it is the elite's entry in
 * `enemies`, which carries hp, position, cooldown, target and `life` in the same
 * fields as any other enemy. Mixing the two into one `phase` enum made "died during
 * the telegraph" unrepresentable — a real state, since a telegraph runs 54 ticks and
 * 16 friendlies are shooting at the thing the whole time, and §1.12 keeps the
 * telegraph centre frozen from the tick it started regardless of what happens next.
 */
export type EliteAttackPhase = 'idle' | 'telegraph' | 'cooldown'

export type EliteState = {
  /** The id of the elite's row in `enemies`, or null before it arrives (§1.12). */
  enemyId: number | null
  spawnTick: number | null
  attackPhase: EliteAttackPhase
  /** §1.12: frozen at the tick the telegraph started. */
  telegraphCenter: Vec2 | null
  telegraphRemaining: number
  cooldownRemaining: number
}

/** §1.13: one entry per upgrade round, offered and chosen both recorded. */
export type UpgradeRound = {
  round: number
  tick: number
  offered: CardId[]
  chosen: CardId | null
}

export type UpgradeState = {
  /** §1.13: only the chosen card leaves the pool. */
  remainingPool: CardId[]
  rounds: UpgradeRound[]
  /** Index into `UPGRADE_KILL_THRESHOLDS`; at most 4 rounds ever fire. */
  nextThresholdIndex: number
  /**
   * Campaign §1.2: cards this squad ALREADY HELD when the stage opened.
   *
   * AUTHORITATIVE INPUT, NOT SCRATCH, and the test this file's header states is the one it passes:
   * a later tick reads it — every tick that asks `hasUpgrade` does. It is not derivable from
   * anything else on the state, because the battle's own record of what was taken is
   * `rounds[].chosen`, and a card taken in stage 3 has no round in stage 4. Without it a carried
   * stage would silently drop every effect the squad had earned, which is one of the three things
   * §1.1 says must not reset.
   *
   * THE ONE ENCODING THAT WOULD MAKE IT DERIVABLE WAS REJECTED DELIBERATELY. `remainingPool` could
   * have been seeded as `CARD_POOL` minus the carried cards, and then "held" would be readable as
   * "absent from the pool" with no new field. That makes one field answer two questions — what may
   * still be OFFERED, and what the squad OWNS — so any future rule that removes a card from the
   * pool for a third reason would hand out its effect for free. The pool keeps its §1.13 meaning
   * (it starts full and loses only what was chosen HERE), and §1.2's "한 캠페인에 같은 카드는 한
   * 번만" is enforced where the offer is drawn, by filtering on `hasUpgrade`.
   */
  carriedCards: CardId[]
}

/**
 * §1.11: at most one rescue at a time.
 *
 * There is no "was the rescuer hit" field. §1.16 puts 피해 적용 immediately before 구조 진행, so
 * `advanceRescueProgress` reads the hit out of `applyDamage`'s return value in the same tick; the
 * question never has to survive a tick boundary, and this object stays exactly what §1.17 asks
 * the digest to carry ("구조 lock의 대상·진행도").
 */
export type RescueLock = {
  active: boolean
  targetId: number | null
  progress: number
}

/** §1.15: the held movement vector and Space state, both part of the digest. */
export type BattleInput = {
  move: Vec2
  spaceHeld: boolean
}

/**
 * One body as a campaign hands it to the next stage (campaign design §1.1).
 *
 * It is the carry list and nothing else: id, role, name, and the two hit-point numbers. Position,
 * cooldown, target, `downedTicks`, `rescuedByIds` and `deathTick` are all facts about a fight that
 * is over, and the next stage re-derives every one of them — the squad forms up at
 * `COMMANDER_START` again, and §1.1 resets the enemies and the clock.
 *
 * `hp` and `maxHp` are carried VERBATIM. §1.1: "HP는 스테이지 시작 시 회복하지 않는다." A body that
 * ended a stage at a third of its health starts the next one there, and `maxHp` is what carries
 * §1.13's `vitality` (the card multiplies both once, at choice time, so the raised maximum IS the
 * card's memory — there is no HP multiplier field to carry).
 */
export type CarriedMember = {
  id: number
  role: FriendlyRole
  nameIndex: number
  hp: number
  maxHp: number
}

/**
 * Everything a battle needs that it cannot derive, when the battle is not the campaign's first.
 *
 * A PARAMETER, not a field: it is read once by `createInitialBattleState` and what survives of it
 * on the state is `friendlies`, `commandUnitId`, `upgrades.carriedCards` and `stats.priorKills` —
 * see the notes on the last two for why each of those two is authoritative input rather than the
 * scratch this file's header bans.
 */
export type CarriedSquad = {
  /**
   * §1.5's successor, as the next stage's commanding body.
   *
   * It is carried rather than derived because `role` is NOT rewritten by the carry: a soldier who
   * ended a stage in command is still a soldier, so "who leads" cannot be read off the roster's
   * roles once the original commander has died.
   */
  commandUnitId: number
  members: readonly CarriedMember[]
  /** §1.2: cards taken in earlier stages, in the order they were taken. */
  cards: readonly CardId[]
  /** §1.2: kills counted before this stage began. */
  priorKills: number
}

export type BattleState = {
  schemaVersion: 3
  rootSeed: string
  /**
   * §3.1 of the campaign design: WHICH STAGE'S NUMBERS THIS RUN IS PLAYED UNDER.
   *
   * An id and not the configuration. The digest walks this object, so a configuration held
   * outside the state would let one digest name two runs played under different rules and §1.17's
   * replay guarantee would be false; the whole configuration held inside it would grow the state
   * and this file's key pins by one field per axis. The id is the smallest thing that closes the
   * first hole without opening the second — the key set grows by exactly one — and `stages.ts`
   * turns it back into the numbers through `stageConfigOf`, which is a pure lookup.
   *
   * IT IS NOT SCRATCH. It is read by a later tick — by every tick, in fact, since every rule that
   * consults a stage number reads it — which is the test the rule above states.
   */
  stageId: StageId
  combatTick: number
  mode: BattleMode
  result: BattleResult
  failureReason: FailureReason
  /** §1.17: the internal state of all three named streams. */
  prng: BattlePrngStates
  commandUnitId: number
  /** §1.5: the body that unconditionally reclaims command when it stands again. */
  originalCommanderId: number
  slotAssignments: SlotAssignment[]
  input: BattleInput
  /**
   * §1.5 (nearest, ties by id), §1.8 and §1.9 all resolve ties by ascending id, and
   * `friendliesById` / `enemiesById` are the ONLY guarantee of that order. Insertion order is
   * not a contract: it happens to be ascending for the fixed 16-body roster, and it is NOT
   * ascending for `enemies` — §1.12 gives the elite `ELITE_ID = 1000` while spawn ids climb from
   * `101` and never reach it, so every enemy spawned after tick 1800 lands behind a larger id.
   * A reader that walks the array directly is a tie-break bug waiting for the elite to arrive.
   */
  friendlies: FriendlyUnit[]
  /** See `friendlies`: read it through `enemiesById`, never in array order. */
  enemies: EnemyUnit[]
  spawn: SpawnState
  elite: EliteState
  upgrades: UpgradeState
  rescue: RescueLock
  /**
   * §1.13: elite kills are excluded from `kills` on purpose.
   *
   * `kills` and `rescues` are THIS STAGE's. `priorKills` is campaign §1.2's carry — see below.
   */
  stats: {
    kills: number
    rescues: number
    /**
     * Campaign §1.2: kills counted in the stages BEFORE this one.
     *
     * AUTHORITATIVE INPUT, NOT SCRATCH. §1.2 puts §1.13's thresholds `[15, 45, 90, 145]` on the
     * CAMPAIGN's cumulative kills, so the round test is `priorKills + kills` against the table
     * (`campaignKills`) — and a battle cannot derive kills it did not make. Twenty kills in stage
     * one means the next card arrives at 45, not at 15, and nothing inside stage two can know that
     * without being told the twenty.
     *
     * ONE NUMBER, deliberately. Not a per-stage record and not a copy of the earlier stages'
     * upgrade rounds: what §1.13 compares against is a sum, so a sum is what carries.
     *
     * IT IS WRITTEN ONCE, at construction, and never again — every kill of this stage lands in
     * `kills`. `upgrades.nextThresholdIndex` is NOT carried alongside it: it is derived from this
     * number and the threshold table when the state is built.
     */
    priorKills: number
  }
}
