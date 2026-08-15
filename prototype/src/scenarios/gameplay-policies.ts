import { createGameplaySimulation } from '../core/gameplay/simulation'
import type {
  FailureReason,
  GameInputEvent,
  GameState,
  GameplaySimulation,
  Vec2,
} from '../core/gameplay/types'
import type { Squad } from '../core/types'

export type GameplayPolicy = 'tactical-no-input' | 'movement-only' | 'skilled'

export type PolicyRun = {
  readonly seed: string
  readonly policy: GameplayPolicy
  readonly mode: 'won' | 'lost'
  readonly failureReason: FailureReason
  readonly terminalTick: number
  readonly checkpoints: readonly { tick: number; digest: string }[]
  readonly firstAttackTick: number | null
  readonly firstDownedTick: number | null
  readonly upgradeTick: number | null
  readonly rescues: number
}

export type DeterminismObservation = {
  readonly tick: number
  readonly digest: string
  readonly normalPositions: readonly { id: number; position: Vec2 }[]
  readonly spawnPrng: number
  readonly wave: { readonly cursor: number; readonly requested: number; readonly discarded: number }
  readonly downedTimers: readonly { id: number; ticks: number }[]
  readonly warningTicks: readonly number[]
  readonly damageTicks: readonly number[]
}

export type RescueAgencyRun = {
  readonly seed: string
  readonly approach: { readonly startDistance: number; readonly endDistance: number; readonly minimumNormalDistance: number }
  readonly commands: readonly GameInputEvent[]
  readonly progress: readonly { tick: number; rescuerId: number; casualtyId: number; progress: number }[]
  readonly completedTick: number
  readonly rescues: number
  readonly finalDigest: string
}

const CHECKPOINT_TICKS = [0, 150, 300, 360, 540, 660, 780, 900] as const
const RESCUE_SAFETY_DISTANCE = 3
const SKILLED_SWITCH_FATIGUE = 0.55
const RESCUE_RANGE = 1.5

type Sequence = { value: number }
type WithoutSequence<T> = T extends unknown ? Omit<T, 'sequence'> : never
export type UnsequencedGameInputEvent = WithoutSequence<GameInputEvent>

function distanceSquared(left: Vec2, right: Vec2): number {
  const x = left.x - right.x
  const y = left.y - right.y
  return x * x + y * y
}

function enqueue(game: GameplaySimulation, sequence: Sequence, event: UnsequencedGameInputEvent): void {
  game.enqueue({ ...event, sequence: sequence.value++ } as GameInputEvent)
}

function choosePower(game: GameplaySimulation, sequence: Sequence): boolean {
  const state = game.getState()
  if (state.mode !== 'awaiting-upgrade') return false
  const index = state.upgrade.offered.indexOf('power')
  if (index < 0) throw new Error('power upgrade was not offered')
  enqueue(game, sequence, {
    applyTick: state.combatTick,
    kind: 'choose-upgrade',
    index: index as 0 | 1 | 2,
  })
  return true
}

function livingEnemyPositions(state: Readonly<GameState>): Vec2[] {
  const positions = state.normalEnemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy) => enemy.position)
  if (state.elite.spawned && state.elite.hp > 0) positions.push(state.elite.position)
  return positions
}

function directionAwayFromNearestEnemy(state: Readonly<GameState>): Vec2 {
  const center = state.squads[state.activeSquad].lastCenter
  const nearest = livingEnemyPositions(state)
    .sort((left, right) => distanceSquared(left, center) - distanceSquared(right, center))[0]
  if (!nearest) return { x: 0, y: 0 }
  return { x: center.x - nearest.x, y: center.y - nearest.y }
}

function directionAwayFromNearestEnemyForSquad(state: Readonly<GameState>, squad: Squad): Vec2 {
  const center = state.squads[squad].lastCenter
  const nearest = state.normalEnemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy) => enemy.position)
    .sort((left, right) => distanceSquared(left, center) - distanceSquared(right, center))[0]
  if (!nearest) return { x: 0, y: 0 }
  return { x: center.x - nearest.x, y: center.y - nearest.y }
}

function mostUrgentSafeCasualty(state: Readonly<GameState>, squad: Squad) {
  const livingNormals = state.normalEnemies.filter((enemy) => enemy.hp > 0)
  return state.friendlies
    .filter((friendly) => friendly.squad === squad && friendly.life === 'downed')
    .filter((casualty) => livingNormals.every((enemy) => (
      distanceSquared(enemy.position, casualty.position) >= RESCUE_SAFETY_DISTANCE ** 2
    )))
    .sort((left, right) => left.downedTicks - right.downedTicks || left.id - right.id)[0] ?? null
}

function eligibleRescuer(state: Readonly<GameState>, squad: Squad, casualty: GameState['friendlies'][number]) {
  return state.friendlies
    .filter((friendly) => (
      friendly.squad === squad
      && friendly.life === 'standing'
      && distanceSquared(friendly.position, casualty.position) <= RESCUE_RANGE ** 2
    ))
    .sort((left, right) => (
      distanceSquared(left.position, casualty.position) - distanceSquared(right.position, casualty.position)
      || left.id - right.id
    ))[0] ?? null
}

function enqueueMovementOnly(game: GameplaySimulation, sequence: Sequence): void {
  const state = game.getState()
  const direction = directionAwayFromNearestEnemy(state)
  enqueue(game, sequence, {
    applyTick: state.combatTick,
    kind: 'set-move',
    x: direction.x,
    y: direction.y,
  })
}

export function decideSkilledCommands(state: Readonly<GameState>): readonly UnsequencedGameInputEvent[] {
  const tick = state.combatTick
  const shouldSwitch = state.squads[state.activeSquad].fatigue >= SKILLED_SWITCH_FATIGUE && state.switchCooldown === 0
  const squad = shouldSwitch ? (state.activeSquad === 'teal' ? 'scarlet' : 'teal') : state.activeSquad
  const center = state.squads[squad].lastCenter
  const telegraphDirection = state.elite.telegraphCenter
    ? { x: center.x - state.elite.telegraphCenter.x, y: center.y - state.elite.telegraphCenter.y }
    : null
  const fallback = state.squads[squad].lastDirection
  const casualty = state.elite.telegraphCenter ? null : mostUrgentSafeCasualty(state, squad)
  const rescuing = casualty ? eligibleRescuer(state, squad, casualty) !== null : false
  const direction = telegraphDirection
    ? Math.hypot(telegraphDirection.x, telegraphDirection.y) > 0
      ? telegraphDirection
      : Math.hypot(fallback.x, fallback.y) > 0
        ? fallback
        : { x: 0, y: 1 }
    : casualty
      ? rescuing
        ? { x: 0, y: 0 }
        : { x: casualty.position.x - center.x, y: casualty.position.y - center.y }
      : state.elite.spawned && state.elite.hp > 0
        ? { x: state.elite.position.x - center.x, y: state.elite.position.y - center.y }
        : directionAwayFromNearestEnemyForSquad(state, squad)
  return [
    ...(shouldSwitch ? [{ applyTick: tick, kind: 'switch-squad' } as const] : []),
    { applyTick: tick, kind: 'set-rescue', held: rescuing },
    { applyTick: tick, kind: 'set-move', x: direction.x, y: direction.y },
  ]
}

function enqueueSkilled(game: GameplaySimulation, sequence: Sequence): void {
  for (const event of decideSkilledCommands(game.getState())) enqueue(game, sequence, event)
}

function recordCheckpoint(
  game: GameplaySimulation,
  checkpoints: Array<{ tick: number; digest: string }>,
): void {
  const tick = game.getState().combatTick
  if (checkpoints.at(-1)?.tick === tick) {
    checkpoints[checkpoints.length - 1] = { tick, digest: game.getDigest() }
    return
  }
  checkpoints.push({ tick, digest: game.getDigest() })
}

function observeDeterminismState(game: GameplaySimulation): DeterminismObservation {
  const state = game.getState()
  return {
    tick: state.combatTick,
    digest: game.getDigest(),
    normalPositions: state.normalEnemies
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => ({ id: enemy.id, position: { ...enemy.position } })),
    spawnPrng: state.prng.spawn,
    wave: { ...state.wave },
    downedTimers: state.friendlies
      .filter((friendly) => friendly.life === 'downed')
      .map((friendly) => ({ id: friendly.id, ticks: friendly.downedTicks })),
    warningTicks: [...state.elite.warningTicks],
    damageTicks: [...state.elite.damageTicks],
  }
}

export function runDeterminismFixture(seed: string): {
  checkpoints: readonly { tick: number; digest: string }[]
  zeroStandingTick: number | null
  postWipeObservations: readonly DeterminismObservation[]
} {
  const game = createGameplaySimulation({ seed, fixture: 'determinism' })
  const sequence = { value: 0 }
  const checkpoints: Array<{ tick: number; digest: string }> = []
  const postWipeObservations: DeterminismObservation[] = []
  let zeroStandingTick: number | null = null
  enqueue(game, sequence, { applyTick: 0, kind: 'start-battle' })
  recordCheckpoint(game, checkpoints)

  while (game.getState().combatTick < 900) {
    choosePower(game, sequence)
    game.step()
    if ((CHECKPOINT_TICKS as readonly number[]).includes(game.getState().combatTick)) {
      recordCheckpoint(game, checkpoints)
    }
    if (!game.getState().friendlies.some((friendly) => friendly.life === 'standing')) {
      zeroStandingTick ??= game.getState().combatTick
      postWipeObservations.push(observeDeterminismState(game))
    }
  }

  return { checkpoints, zeroStandingTick, postWipeObservations }
}

export function runGameplayPolicy(seed: string, policy: GameplayPolicy): PolicyRun {
  const game = createGameplaySimulation({ seed })
  const sequence = { value: 0 }
  const checkpoints: Array<{ tick: number; digest: string }> = []
  let firstAttackTick: number | null = null
  let firstDownedTick: number | null = null
  let upgradeTick: number | null = null

  enqueue(game, sequence, { applyTick: 0, kind: 'start-battle' })
  recordCheckpoint(game, checkpoints)

  while (game.getState().mode === 'running' || game.getState().mode === 'awaiting-upgrade') {
    if (game.getState().mode === 'awaiting-upgrade') {
      upgradeTick ??= game.getState().combatTick
      choosePower(game, sequence)
    }

    if (policy === 'movement-only') enqueueMovementOnly(game, sequence)
    if (policy === 'skilled') enqueueSkilled(game, sequence)

    const processedTick = game.getState().combatTick
    game.step()
    const state = game.getState()
    if (firstAttackTick === null && state.friendlies.some((friendly) => friendly.attackCooldown > 0)) {
      firstAttackTick = processedTick
    }
    if (firstDownedTick === null && state.friendlies.some((friendly) => friendly.life !== 'standing')) {
      firstDownedTick = processedTick
    }
    if (upgradeTick === null && state.mode === 'awaiting-upgrade') upgradeTick = state.combatTick
    if ((CHECKPOINT_TICKS as readonly number[]).includes(state.combatTick)) recordCheckpoint(game, checkpoints)
  }

  const state = game.getState()
  if (state.mode !== 'won' && state.mode !== 'lost') throw new Error(`policy did not terminate at tick ${state.combatTick}`)
  recordCheckpoint(game, checkpoints)
  return {
    seed,
    policy,
    mode: state.mode,
    failureReason: state.failureReason,
    terminalTick: state.combatTick,
    checkpoints,
    firstAttackTick,
    firstDownedTick,
    upgradeTick,
    rescues: state.stats.rescues,
  }
}

export function runRescueAgencyScenario(seed: string): RescueAgencyRun {
  const game = createGameplaySimulation({ seed, fixture: 'rescue-agency' })
  const sequence = { value: 0 }
  const commands: GameInputEvent[] = []
  const progress: Array<{ tick: number; rescuerId: number; casualtyId: number; progress: number }> = []
  let casualtyId: number | null = null
  let approachStartDistance: number | null = null
  let approachEndDistance: number | null = null
  let approachMinimumNormalDistance: number | null = null
  let completedTick: number | null = null

  const issue = (event: UnsequencedGameInputEvent) => {
    const command = { ...event, sequence: sequence.value++ } as GameInputEvent
    commands.push({ ...command })
    game.enqueue(command)
  }
  const issuePower = () => {
    const state = game.getState()
    if (state.mode !== 'awaiting-upgrade') return
    const index = state.upgrade.offered.indexOf('power')
    if (index < 0) throw new Error('power upgrade was not offered')
    issue({ applyTick: state.combatTick, kind: 'choose-upgrade', index: index as 0 | 1 | 2 })
  }

  issue({ applyTick: 0, kind: 'start-battle' })
  while ((game.getState().mode === 'running' || game.getState().mode === 'awaiting-upgrade') && completedTick === null) {
    issuePower()
    const state = game.getState()
    const lockedCasualty: GameState['friendlies'][number] | null = casualtyId === null
      ? null
      : state.friendlies.find((friendly) => friendly.id === casualtyId && friendly.life === 'downed') ?? null
    const tealCenter = state.squads.teal.lastCenter
    const safeCasualty = state.friendlies
      .filter((friendly) => friendly.squad === 'teal' && friendly.life === 'downed')
      .filter((friendly) => state.normalEnemies
        .filter((enemy) => enemy.hp > 0)
        .every((enemy) => distanceSquared(enemy.position, friendly.position) >= RESCUE_SAFETY_DISTANCE ** 2))
      .filter((friendly) => distanceSquared(tealCenter, friendly.position) > RESCUE_RANGE ** 2)
      .sort((left, right) => distanceSquared(tealCenter, left.position) - distanceSquared(tealCenter, right.position) || left.id - right.id)[0]
    const casualty: GameState['friendlies'][number] | null = lockedCasualty ?? safeCasualty ?? null
    casualtyId = casualty?.id ?? null

    if (!casualty) {
      const direction = directionAwayFromNearestEnemy(state)
      issue({ applyTick: state.combatTick, kind: 'set-rescue', held: false })
      issue({ applyTick: state.combatTick, kind: 'set-move', x: direction.x, y: direction.y })
    } else {
      const shouldSwitch = state.activeSquad !== 'teal' && state.switchCooldown === 0
      const squad: Squad = shouldSwitch ? 'teal' : state.activeSquad
      const center = state.squads[squad].lastCenter
      const rescuer = eligibleRescuer(state, squad, casualty)
      if (shouldSwitch) issue({ applyTick: state.combatTick, kind: 'switch-squad' })
      if (squad === 'teal' && rescuer) {
        const distance = Math.sqrt(distanceSquared(center, casualty.position))
        approachEndDistance = distance
        issue({ applyTick: state.combatTick, kind: 'set-rescue', held: true })
        issue({ applyTick: state.combatTick, kind: 'set-move', x: 0, y: 0 })
      } else {
        const direction = { x: casualty.position.x - center.x, y: casualty.position.y - center.y }
        if (approachStartDistance === null) {
          approachStartDistance = Math.sqrt(distanceSquared(center, casualty.position))
          approachMinimumNormalDistance = state.normalEnemies
            .filter((enemy) => enemy.hp > 0)
            .reduce((minimum, enemy) => Math.min(minimum, Math.sqrt(distanceSquared(enemy.position, casualty.position))), Number.POSITIVE_INFINITY)
        }
        issue({ applyTick: state.combatTick, kind: 'set-rescue', held: false })
        issue({ applyTick: state.combatTick, kind: 'set-move', x: direction.x, y: direction.y })
      }
    }

    game.step()
    const after = game.getState()
    const lock = after.friendlies
      .filter((friendly) => friendly.rescueTargetId !== null && friendly.rescueProgress > 0)
      .sort((left, right) => left.id - right.id)[0]
    if (lock && lock.rescueTargetId !== null) {
      progress.push({
        tick: after.combatTick,
        rescuerId: lock.id,
        casualtyId: lock.rescueTargetId,
        progress: lock.rescueProgress,
      })
    }
    if (after.stats.rescues > 0) completedTick = after.combatTick
  }

  if (completedTick === null || approachStartDistance === null || approachEndDistance === null || approachMinimumNormalDistance === null) {
    throw new Error(`rescue agency scenario did not complete for seed ${seed}`)
  }
  const state = game.getState()
  return {
    seed,
    approach: {
      startDistance: approachStartDistance,
      endDistance: approachEndDistance,
      minimumNormalDistance: approachMinimumNormalDistance,
    },
    commands,
    progress,
    completedTick,
    rescues: state.stats.rescues,
    finalDigest: game.getDigest(),
  }
}
