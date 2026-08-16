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

// The 14 hooks below are the spec's 14 tick steps in the spec's order, but two of them
// do NOT do the work their spec number names. Both placements are deliberate and the
// phase-order test (tests/core/gameplay-determinism.test.ts) only proves the hooks fire
// in this order — it is not evidence that each step's work happens in its own hook:
//
//  - Spec step 5 "피로 증감과 exhausted 상태를 판정한다": this hook only *resets* the
//    per-tick activity accumulator. The actual advanceFatigue() runs at the end of
//    phase 11, because fatigue is measured from activity that is not resolved until
//    steps 6-8 (movement, rescue work, attacks) — judging it at step 5 could only ever
//    read the previous tick's activity.
//  - Spec step 11 "... kill과 XP를 집계한다": recordNormalKill() fires inside phase 8
//    (combat.ts), at the moment a normal's hp crosses to 0, because the killing blow is
//    the only place the transition is observable. Nothing between phases 8 and 11 reads
//    stats.xp (upgrade entry is phase 14), so the counter is identical either way.
//
// Moving either one would change every determinism digest and the recorded 8-seed
// agency bands, so the placements stay and the names/comments carry the truth.
type PhaseName =
  | 'cooldowns'
  | 'input'
  | 'spawn'
  | 'commandsUpgrades'
  | 'activityReset'
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
    // Spec step 5's slot. Resets the accumulator only; advanceFatigue() runs in phase 11.
    activityReset: () => { squadActivity = createSquadActivity() },
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
      // Spec step 5's real work: it needs the activity resolved by phases 6-8 above.
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
      run('activityReset')
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
