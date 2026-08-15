import {
  EXHAUSTED_THRESHOLD,
  FATIGUE_GAIN_PER_TICK,
  FATIGUE_RECOVERY_PER_TICK,
  SQUAD_SWITCH_COOLDOWN_TICKS,
} from './constants'
import type { FriendlyState, GameState, SquadState } from './types'
import type { Squad } from '../types'

const FATIGUE_SCALE = 900
const EXHAUSTED_MULTIPLIER = 0.7

function fatigueUnits(fatigue: number): number {
  return Math.round(fatigue * FATIGUE_SCALE)
}

function setFatigue(squad: SquadState, units: number): void {
  squad.fatigue = Math.max(0, Math.min(FATIGUE_SCALE, units)) / FATIGUE_SCALE
  squad.exhausted = squad.fatigue >= EXHAUSTED_THRESHOLD
}

function activeSquadIsExerting(state: GameState): boolean {
  if (state.input.move.x !== 0 || state.input.move.y !== 0 || state.input.rescueHeld) return true
  return state.friendlies.some(
    (friendly: FriendlyState) =>
      friendly.squad === state.activeSquad &&
      friendly.life === 'standing' &&
      (friendly.attackCooldown > 0 || friendly.targetId !== null || friendly.rescueTargetId !== null || friendly.rescueProgress > 0),
  )
}

export function applySquadSwitch(state: GameState): void {
  if (state.switchCooldown !== 0) return
  state.activeSquad = state.activeSquad === 'teal' ? 'scarlet' : 'teal'
  state.switchCooldown = SQUAD_SWITCH_COOLDOWN_TICKS
}

export function advanceFatigue(state: GameState): void {
  const activeExerting = activeSquadIsExerting(state)
  for (const squad of ['teal', 'scarlet'] as const) {
    const squadState = state.squads[squad]
    if (squad === state.activeSquad && activeExerting) {
      setFatigue(squadState, fatigueUnits(squadState.fatigue) + FATIGUE_GAIN_PER_TICK * FATIGUE_SCALE)
    } else if (squad !== state.activeSquad) {
      setFatigue(squadState, fatigueUnits(squadState.fatigue) - FATIGUE_RECOVERY_PER_TICK * FATIGUE_SCALE)
    }
  }
}

export function movementMultiplier(state: GameState, squad: Squad): number {
  const exhaustedMultiplier = squad === state.activeSquad && state.squads[squad].exhausted
    ? EXHAUSTED_MULTIPLIER
    : 1
  return state.squads[squad].movementMultiplier * exhaustedMultiplier
}
