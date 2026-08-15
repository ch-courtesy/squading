import { BATTLE_TICKS } from './constants'
import { advanceAttackCooldowns, advanceFriendlyAttacks, advanceNormalAttacks } from './combat'
import { digestGameState } from './digest'
import { advanceEliteMovement, advanceEliteTelegraph, resolveOutcome, spawnElite } from './elite'
import { createGameplayInputQueue } from './input-queue'
import { advanceMovement } from './movement'
import { applyPendingUpgrade, applyUpgradeChoice, enterUpgradeIfEligible, spawnForTick } from './progression'
import { advanceSelectedRescueProgress, prepareRescueLock, resolveRescueAndDownedTimers } from './rescue'
import { advanceFatigue, applySquadSwitch, createSquadActivity } from './squads'
import type { SquadActivity } from './squads'
import { projectRenderSnapshot } from './snapshot'
import { createInitialGameState } from './state'
import type { GameInputEvent, GameState, GameplayFixture, GameplaySimulation } from './types'

type PhaseName =
  | 'cooldowns'
  | 'input'
  | 'spawn'
  | 'commandsUpgrades'
  | 'fatigue'
  | 'movement'
  | 'rescueProgress'
  | 'friendlyAttacks'
  | 'normalAttacks'
  | 'eliteTelegraph'
  | 'rescueDeathXp'
  | 'tick'
  | 'outcome'
  | 'upgradeEntry'

export type GameplayStepPhases = Record<PhaseName, () => void>

export type GameplaySimulationOptions = {
  readonly seed: string
  readonly fixture?: GameplayFixture
  readonly phases?: Partial<GameplayStepPhases>
}

function copyEvent(event: GameInputEvent): GameInputEvent {
  return { ...event }
}

function byEventOrder(left: GameInputEvent, right: GameInputEvent): number {
  return left.applyTick - right.applyTick || left.sequence - right.sequence
}

function assertFiniteEvent(event: GameInputEvent): void {
  if (!Number.isFinite(event.applyTick) || !Number.isFinite(event.sequence)) throw new TypeError('event schedule must be finite')
  if (event.kind === 'set-move' && (!Number.isFinite(event.x) || !Number.isFinite(event.y))) {
    throw new TypeError('movement input must be finite')
  }
  if (event.kind === 'choose-upgrade' && (!Number.isInteger(event.index) || event.index < 0 || event.index > 2)) {
    throw new TypeError('upgrade index must be 0, 1, or 2')
  }
}

export function createGameplaySimulation(options: GameplaySimulationOptions): GameplaySimulation {
  const seed = options.seed
  const fixture = options.fixture
  const queue = createGameplayInputQueue()
  let state = createInitialGameState(seed, fixture)
  let squadActivity: SquadActivity = createSquadActivity()

  const syncPendingEvents = () => {
    state.pendingEvents = [...state.pendingEvents].sort(byEventOrder)
  }

  const clearPersistentInput = () => {
    state.input = { move: { x: 0, y: 0 }, rescueHeld: false }
  }

  const applyZeroTimeControl = (event: GameInputEvent): boolean => {
    switch (event.kind) {
      case 'start-battle':
        if (event.applyTick !== 0) throw new TypeError('start-battle must apply at tick zero')
        if (state.mode === 'ready') state.mode = 'running'
        return true
      case 'toggle-pause':
        if (state.mode === 'running') {
          state.mode = 'paused'
          clearPersistentInput()
        } else if (state.mode === 'paused') {
          state.mode = 'running'
          clearPersistentInput()
        }
        return true
      case 'choose-upgrade': {
        if (state.mode === 'awaiting-upgrade') {
          applyUpgradeChoice(state, event.index)
          state.mode = 'running'
          clearPersistentInput()
        }
        return true
      }
      default:
        return false
    }
  }

  const applyInput = (event: GameInputEvent) => {
    switch (event.kind) {
      case 'set-move':
        state.input = { ...state.input, move: { x: event.x, y: event.y } }
        return
      case 'set-rescue':
        state.input = { ...state.input, rescueHeld: event.held }
        return
      case 'switch-squad':
        applySquadSwitch(state)
        return
      case 'toggle-pause':
        state.mode = state.mode === 'running' ? 'paused' : state.mode === 'paused' ? 'running' : state.mode
        return
      case 'choose-upgrade':
        return
      case 'start-battle':
        return
    }
  }

  const defaults: GameplayStepPhases = {
    cooldowns: () => {
      state.switchCooldown = Math.max(0, state.switchCooldown - 1)
      advanceAttackCooldowns(state)
    },
    input: () => {
      const due = queue.take(state.combatTick)
      state.pendingEvents = state.pendingEvents.filter((event) => event.applyTick > state.combatTick)
      for (const event of due) applyInput(event)
    },
    spawn: () => {
      spawnForTick(state, state.combatTick)
      spawnElite(state, state.combatTick)
    },
    commandsUpgrades: () => { applyPendingUpgrade(state) },
    fatigue: () => { squadActivity = createSquadActivity() },
    movement: () => {
      prepareRescueLock(state)
      squadActivity.moved = advanceMovement(state)
      advanceEliteMovement(state)
    },
    rescueProgress: () => { squadActivity.rescued = advanceSelectedRescueProgress(state) },
    friendlyAttacks: () => { squadActivity.attacked = advanceFriendlyAttacks(state) },
    normalAttacks: () => { advanceNormalAttacks(state) },
    eliteTelegraph: () => { advanceEliteTelegraph(state, state.combatTick) },
    rescueDeathXp: () => {
      resolveRescueAndDownedTimers(state)
      advanceFatigue(state, squadActivity)
    },
    tick: () => { state.combatTick += 1 },
    outcome: () => { if (fixture !== 'determinism') resolveOutcome(state) },
    upgradeEntry: () => { if (state.mode === 'running') enterUpgradeIfEligible(state) },
  }

  const run = (name: PhaseName) => {
    defaults[name]()
    options.phases?.[name]?.()
  }

  return {
    getState: () => state,
    getSnapshot: () => projectRenderSnapshot(state),
    getDigest: () => digestGameState(state),
    enqueue(event) {
      assertFiniteEvent(event)
      const copied = copyEvent(event)
      if (applyZeroTimeControl(copied)) return
      queue.enqueue(copied)
      state.pendingEvents.push(copied)
      syncPendingEvents()
    },
    step() {
      if (state.mode !== 'running' || state.combatTick >= BATTLE_TICKS) return
      run('cooldowns')
      run('input')
      run('spawn')
      run('commandsUpgrades')
      run('fatigue')
      run('movement')
      run('rescueProgress')
      run('friendlyAttacks')
      run('normalAttacks')
      run('eliteTelegraph')
      run('rescueDeathXp')
      run('tick')
      run('outcome')
      run('upgradeEntry')
    },
    restart() {
      queue.clear()
      state = createInitialGameState(seed, fixture)
    },
  }
}
