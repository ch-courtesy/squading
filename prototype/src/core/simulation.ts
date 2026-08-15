import { createPrng } from './prng'
import type {
  RenderEffect,
  RenderProjectile,
  RenderSnapshot,
  RenderUnit,
  Simulation,
  SimulationConfig,
  SimulationInput,
  SimulationResult,
  Squad,
} from './types'

export const TICKS_PER_SECOND = 30
export const FIXED_STEP_MS = 1000 / TICKS_PER_SECOND
const SUCCESS_TICK = 75 * TICKS_PER_SECOND
const MAX_TICKS_PER_FRAME = 5

type MutableUnit = { -readonly [Key in keyof RenderUnit]: RenderUnit[Key] }
type MutableProjectile = { -readonly [Key in keyof RenderProjectile]: RenderProjectile[Key] }

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function byId(a: { id: number }, b: { id: number }): number {
  return a.id - b.id
}

export function createSimulation(config: SimulationConfig): Simulation {
  const ownedConfig = { ...config }
  let tick = 0
  let result: SimulationResult = 'running'
  let units: MutableUnit[] = []
  let projectiles: MutableProjectile[] = []
  let effects: RenderEffect[] = []
  let nextEventId = 10_000
  let activeSquad: Squad = 'teal'

  const initialize = () => {
    const random = createPrng(ownedConfig.seed)
    let nextUnitId = 1
    tick = 0
    result = 'running'
    projectiles = []
    effects = []
    nextEventId = 10_000
    activeSquad = 'teal'
    units = []

    units.push(
      makeUnit(nextUnitId++, 'commander', 'teal', null, 0, 0, random.range(-0.25, 0.25)),
    )

    for (const [squad, baseX] of [
      ['teal', -5],
      ['scarlet', 5],
    ] as const) {
      for (let index = 0; index < 8; index += 1) {
        const unit = makeUnit(
          nextUnitId++,
          'soldier',
          squad,
          squad,
          baseX + (index % 4) * 1.1 + random.range(-0.15, 0.15),
          2 + Math.floor(index / 4) * 1.2 + random.range(-0.15, 0.15),
          random.range(-0.2, 0.2),
        )
        units.push(unit)
      }
    }

    const casualty = units.find((unit) => unit.kind === 'soldier')
    if (casualty) {
      casualty.hp01 = 0
      casualty.state = 'downed'
    }

    units.push(
      makeUnit(
        nextUnitId++,
        'enemy-commander',
        'enemy',
        null,
        0,
        -15,
        random.range(-0.15, 0.15),
      ),
    )

    for (let index = 0; index < ownedConfig.enemyCount; index += 1) {
      const angle = random.range(0, Math.PI * 2)
      const radius = random.range(12, 28)
      units.push(
        makeUnit(
          nextUnitId++,
          'enemy',
          'enemy',
          null,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          angle + Math.PI,
        ),
      )
    }

    units.sort(byId)
  }

  const step = (input: SimulationInput) => {
    if (result !== 'running') return

    assertFiniteInput('moveX', input.moveX)
    assertFiniteInput('moveY', input.moveY)

    tick += 1
    effects = effects.filter((effect) => tick < effect.startedTick + effect.durationTicks)
    projectiles = projectiles
      .map((projectile) => ({ ...projectile, progress01: projectile.progress01 + 0.2 }))
      .filter((projectile) => projectile.progress01 < 1)

    for (const unit of units) {
      if (unit.state === 'moving' || unit.state === 'attacking') unit.state = 'idle'
    }

    if (input.switchSquad) activeSquad = activeSquad === 'teal' ? 'scarlet' : 'teal'
    moveActiveSquad(input)
    if (input.rescue) rescueCasualty()
    advanceEnemyWaves()
    advanceAutoCombat()
    applyOverrun()

    const friendlies = units.filter((unit) => unit.team !== 'enemy')
    if (friendlies.every((unit) => unit.state === 'downed' || unit.state === 'dead')) {
      result = 'failure'
    } else if (tick >= SUCCESS_TICK) {
      result = 'success'
    }
  }

  const moveActiveSquad = (input: SimulationInput) => {
    const moveX = clampAxis(input.moveX)
    const moveY = clampAxis(input.moveY)
    if (moveX === 0 && moveY === 0) return

    for (const unit of units) {
      if (unit.squad !== activeSquad || !isStanding(unit)) continue
      unit.x += moveX * 0.12
      unit.y += moveY * 0.12
      unit.facingRadians = Math.atan2(moveY, moveX)
      unit.state = 'moving'
    }
  }

  const rescueCasualty = () => {
    const casualty = units.find(
      (unit) => unit.team !== 'enemy' && unit.kind === 'soldier' && unit.state === 'downed',
    )
    if (!casualty) return

    casualty.hp01 = 0.35
    casualty.state = 'rescuing'
    effects.push({
      id: nextEventId++,
      kind: 'rescue-signal',
      team: casualty.team,
      x: casualty.x,
      y: casualty.y,
      startedTick: tick,
      durationTicks: 45,
    })
  }

  const advanceAutoCombat = () => {
    const attackers = units.filter(
      (unit) => unit.team !== 'enemy' && unit.state !== 'downed' && unit.state !== 'dead',
    )
    const targets = units.filter((unit) => unit.team === 'enemy' && isStanding(unit))

    for (const unit of attackers) {
      unit.fatigue01 = clamp01(unit.fatigue01 + 1 / (TICKS_PER_SECOND * 120))
      if (
        unit.state === 'rescuing' &&
        !effects.some(
          (effect) =>
            effect.kind === 'rescue-signal' && effect.x === unit.x && effect.y === unit.y,
        )
      ) {
        unit.state = 'idle'
      }
    }

    if (tick % 15 !== 0 || attackers.length === 0 || targets.length === 0) return

    const attacker = attackers[(tick / 15 - 1) % attackers.length]
    const target = targets[0]
    attacker.state = 'attacking'
    target.hp01 = clamp01(target.hp01 - 0.08)
    projectiles.push({
      id: nextEventId++,
      kind: 'friendly',
      ownerId: attacker.id,
      x: attacker.x,
      y: attacker.y,
      targetX: target.x,
      targetY: target.y,
      progress01: 0,
    })

    const previousMorale = target.morale01
    target.morale01 = clamp01(target.morale01 - 0.1)
    if (previousMorale > 0 && target.morale01 === 0) {
      effects.push({
        id: nextEventId++,
        kind: 'morale-break',
        team: 'enemy',
        x: target.x,
        y: target.y,
        startedTick: tick,
        durationTicks: 30,
      })
    }
    if (target.hp01 === 0) target.state = 'dead'
  }

  const advanceEnemyWaves = () => {
    const enemies = units.filter((unit) => unit.kind === 'enemy' && isStanding(unit))
    const activeCount = Math.min(enemies.length, Math.ceil(tick / 30) * 25)

    for (let index = 0; index < activeCount; index += 1) {
      const enemy = enemies[index]
      const distance = Math.hypot(enemy.x, enemy.y)
      if (distance === 0) continue
      enemy.x -= (enemy.x / distance) * 0.01
      enemy.y -= (enemy.y / distance) * 0.01
      enemy.facingRadians = Math.atan2(-enemy.y, -enemy.x)
      enemy.state = 'moving'
    }
  }

  const applyOverrun = () => {
    if (
      ownedConfig.enemyCount < 300 ||
      tick < 60 * TICKS_PER_SECOND ||
      tick % 25 !== 0
    ) {
      return
    }

    const victim = units.find((unit) => unit.team !== 'enemy' && isStanding(unit))
    if (!victim) return
    victim.hp01 = 0
    victim.state = 'downed'
  }

  const getSnapshot = (): RenderSnapshot => ({
    tick,
    elapsedMs: tick * FIXED_STEP_MS,
    units: units.map((unit) => ({ ...unit })).sort(byId),
    projectiles: projectiles.map((projectile) => ({ ...projectile })).sort(byId),
    effects: effects.map((effect) => ({ ...effect })).sort(byId),
    camera: {
      centerX: 0,
      centerY: 0,
      worldWidth: 64,
      worldHeight: 36,
    },
  })

  initialize()

  return {
    get result() {
      return result
    },
    get activeSquad() {
      return activeSquad
    },
    step,
    getSnapshot,
    restart: initialize,
  }
}

function makeUnit(
  id: number,
  kind: RenderUnit['kind'],
  team: RenderUnit['team'],
  squad: RenderUnit['squad'],
  x: number,
  y: number,
  facingRadians: number,
): MutableUnit {
  return {
    id,
    kind,
    team,
    squad,
    x,
    y,
    facingRadians,
    radius: kind.includes('commander') ? 0.65 : 0.45,
    hp01: 1,
    fatigue01: 0,
    morale01: 1,
    state: 'idle',
  }
}

function isStanding(unit: RenderUnit): boolean {
  return unit.state !== 'downed' && unit.state !== 'dead'
}

function clampAxis(value: number | undefined): number {
  return Math.max(-1, Math.min(1, value ?? 0))
}

function assertFiniteInput(name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`)
  }
}

export type FixedStepFrame = {
  ticks: number
  alpha: number
  validSample: boolean
  droppedTicks: number
}

export type FixedStepAccumulator = {
  advance(elapsedMs: number, step: () => void): FixedStepFrame
}

export function createFixedStepAccumulator(): FixedStepAccumulator {
  let accumulatedMs = 0

  return {
    advance(elapsedMs, step) {
      if (!Number.isFinite(elapsedMs)) {
        throw new TypeError('elapsedMs must be finite')
      }
      accumulatedMs += Math.max(0, elapsedMs)
      const availableTicks = Math.floor(accumulatedMs / FIXED_STEP_MS)
      const ticks = Math.min(availableTicks, MAX_TICKS_PER_FRAME)

      for (let index = 0; index < ticks; index += 1) step()

      if (availableTicks > MAX_TICKS_PER_FRAME) {
        accumulatedMs = 0
        return {
          ticks,
          alpha: 0,
          validSample: false,
          droppedTicks: availableTicks - MAX_TICKS_PER_FRAME,
        }
      }

      accumulatedMs -= ticks * FIXED_STEP_MS
      return {
        ticks,
        alpha: accumulatedMs / FIXED_STEP_MS,
        validSample: true,
        droppedTicks: 0,
      }
    },
  }
}
