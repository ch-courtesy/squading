export const TICKS_PER_SECOND = 30
export const BATTLE_TICKS = 900
export const ARENA_WIDTH = 48
export const ARENA_HEIGHT = 27
export const ROSTER_SIZE = 16
export const SQUAD_SIZE = 8
export const SQUAD_SWITCH_COOLDOWN_TICKS = 60
export const FATIGUE_GAIN_PER_TICK = 1 / 450
export const FATIGUE_RECOVERY_PER_TICK = 1 / 300
export const EXHAUSTED_THRESHOLD = 0.6

export const TEAL_MAX_HP = 1.2
export const SCARLET_MAX_HP = 0.75
export const NORMAL_ENEMY_MAX_HP = 1
export const NORMAL_ENEMY_CAP = 20
export const NORMAL_ENEMY_SPAWN_RADIUS = 23
export const UPGRADE_XP = 16
export const ELITE_MAX_HP = 24.5
export const TEAL_MOVE_SPEED = 0.11
export const SCARLET_MOVE_SPEED = 0.12
export const NORMAL_ENEMY_MOVE_SPEED = 0.07
export const ELITE_MOVE_SPEED = 0.14
export const TEAL_ATTACK_DAMAGE = 0.14
export const SCARLET_ATTACK_DAMAGE = 0.11
export const NORMAL_ENEMY_ATTACK_DAMAGE = 0.09
export const ELITE_AREA_DAMAGE = 0.35
export const TEAL_ATTACK_INTERVAL = 18
export const SCARLET_ATTACK_INTERVAL = 10
export const NORMAL_ENEMY_ATTACK_INTERVAL = 12
export const ELITE_ATTACK_INTERVAL = 40
export const TEAL_ATTACK_RANGE = 4
export const SCARLET_ATTACK_RANGE = 6
export const NORMAL_ENEMY_ATTACK_RANGE = 0.75
export const ELITE_AREA_RADIUS = 2
export const DOWNED_TICKS = 240
export const TEAL_RESCUE_TICKS = 30
export const SCARLET_RESCUE_TICKS = 45
export const RESCUE_RANGE = 1.5
export const FORMATION_JITTER = 0.15
export const TEAL_INITIAL_CENTER = { x: 21, y: 13 } as const
export const SCARLET_INITIAL_CENTER = { x: 27, y: 13 } as const

export const INITIAL_FORMATION_OFFSETS = [
  { x: -1.65, y: -0.55 },
  { x: -0.55, y: -0.55 },
  { x: 0.55, y: -0.55 },
  { x: 1.65, y: -0.55 },
  { x: -1.65, y: 0.55 },
  { x: -0.55, y: 0.55 },
  { x: 0.55, y: 0.55 },
  { x: 1.65, y: 0.55 },
] as const
