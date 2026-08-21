import { describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { digestBattleState } from '../../src/core/battle/digest'
import { ELITE_SPAWN_TICK } from '../../src/core/battle/constants'
import { COMMANDER_ID, createEnemy, createInitialBattleState } from '../../src/core/battle/state'
import type { BattleState, DamageEvent } from '../../src/core/battle/types'
import { projectBattleSnapshot, type BattleTickEvents } from '../../src/core/battle-view/snapshot'

/**
 * The channel batch L exists to build: `advanceBattleTick -> ResolvedTick -> controller ->
 * projection -> RenderActionEvent`.
 *
 * The defect this replaces was not "the animations were never written" — `combat-fx.ts` and the
 * renderer's lunge, flash, topple and scrap burst were all there. It was that the projection
 * published `elite-telegraph` and `rescue-signal` and NOTHING ELSE, so the renderer had to guess
 * every blow out of a drop in `hp01`: one flash per frame no matter how many blows landed, the
 * killing blow silently dropped (a body that dies is never seen to lose health), and the attacker
 * attributed to whichever hostile happened to be nearest.
 *
 * So the assertions here are about COUNT and IDENTITY, not about "an effect exists". N damage
 * events must produce N action events; zero must produce zero; and the ids must be the
 * authority's own rather than a nearest-neighbour guess.
 */
function stateAt(seed = 'events-a'): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'running'
  return state
}

function damage(over: Partial<DamageEvent> = {}): DamageEvent {
  return { side: 'enemy', attackerId: 101, targetId: COMMANDER_ID, amount: 4, cause: 'melee-contact', ...over }
}

/**
 * A real `EnemyDeath` carries a `kind` the projection never reads. Built through a helper so the
 * tests hand over the authority's own shape rather than the narrower one this file consumes.
 */
function enemyDeath(id: number) {
  return { id, kind: 'melee' as const }
}

const NO_TRANSITIONS: BattleTickEvents['transitions'] = {
  enemyDeaths: [],
  friendlyDowns: [],
  friendlyDeaths: [],
}

function tickEvents(over: Partial<BattleTickEvents> = {}): BattleTickEvents {
  return { tick: 10, damageEvents: [], transitions: NO_TRANSITIONS, ...over }
}

describe('battle-view: this tick\'s blows, as display events (§액션 피드백)', () => {
  it('publishes an empty account rather than none, which is what tells the renderer not to guess', () => {
    const snapshot = projectBattleSnapshot(stateAt())
    // `undefined` would send the renderer back to inferring hits from `hp01` deltas, and it
    // would then play every blow twice: once from the event, once from the delta.
    expect(snapshot.actionEvents).toEqual([])
    expect(snapshot.actionEvents).toBeDefined()
  })

  it('turns zero damage events into zero action events', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(101, 'melee', { x: 29, y: 16 }))

    const snapshot = projectBattleSnapshot(state, [tickEvents(), tickEvents({ tick: 11 })])

    expect(snapshot.actionEvents).toEqual([])
  })

  it('turns N damage events into N action events, one for one', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(101, 'melee', { x: 29, y: 16 }))
    const events = [
      damage({ targetId: COMMANDER_ID }),
      damage({ targetId: 2 }),
      damage({ targetId: 3 }),
      damage({ targetId: 4 }),
      damage({ targetId: 5 }),
    ]

    const actions = projectBattleSnapshot(state, [tickEvents({ damageEvents: events })]).actionEvents!

    expect(actions).toHaveLength(events.length)
    expect(actions.map((action) => action.targetId)).toEqual([COMMANDER_ID, 2, 3, 4, 5])
    expect(actions.every((action) => action.sourceId === 101)).toBe(true)
  })

  it('carries the authority\'s own attacker, not the nearest body that happens to be shooting', () => {
    const state = stateAt()
    // The near enemy is the one a nearest-neighbour guess would blame. The far one struck.
    state.enemies.push(createEnemy(101, 'melee', { x: 28.5, y: 16 }))
    state.enemies.push(createEnemy(102, 'shooter', { x: 34, y: 16 }))

    const [action] = projectBattleSnapshot(state, [
      tickEvents({ damageEvents: [damage({ attackerId: 102, cause: 'shooter-shot' })] }),
    ]).actionEvents!

    expect(action!.sourceId).toBe(102)
    expect(action!.sourceX).toBe(34)
    expect(action!.sourceY).toBe(16)
    expect(action!.targetId).toBe(COMMANDER_ID)
  })

  it('splits the five causes into the three things they look like', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(101, 'melee', { x: 29, y: 16 }))
    state.enemies.push(createEnemy(102, 'shooter', { x: 34, y: 16 }))
    state.enemies.push(createEnemy(103, 'elite', { x: 36, y: 16 }))

    const kindOf = (event: DamageEvent) =>
      projectBattleSnapshot(state, [tickEvents({ damageEvents: [event] })]).actionEvents![0]!.kind

    // A gun gets the muzzle puff; a body that walked into you must not produce one.
    expect(kindOf(damage({ side: 'friendly', attackerId: COMMANDER_ID, targetId: 101, cause: 'friendly-attack' }))).toBe('shot')
    expect(kindOf(damage({ attackerId: 102, cause: 'shooter-shot' }))).toBe('shot')
    expect(kindOf(damage({ attackerId: 101, cause: 'melee-contact' }))).toBe('melee')
    expect(kindOf(damage({ attackerId: 103, cause: 'elite-blast' }))).toBe('blast')
    // §1.4.2's swing (batch N). The one cause where the attacker IS carrying a gun and still must
    // not fire it: `friendly-melee` comes from the command unit, whose miniature is a rifleman,
    // so nothing about the body it came off would tell the renderer this was not a shot. A
    // muzzle puff here is the defect §액션 피드백 names, and this line is what stands on it —
    // measured, not assumed: `scripts/mutate.mjs`'s "paint a muzzle puff on the commander's
    // swing" was MISSED by the whole suite until this assertion existed.
    expect(kindOf(damage({ side: 'friendly', attackerId: COMMANDER_ID, targetId: 101, cause: 'friendly-melee' }))).toBe('melee')
  })

  it('scales the blow by what fraction of the target it took', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(101, 'melee', { x: 29, y: 16 }))
    const target = state.friendlies.find((unit) => unit.id === COMMANDER_ID)!

    const half = projectBattleSnapshot(state, [
      tickEvents({ damageEvents: [damage({ amount: target.maxHp / 2 })] }),
    ]).actionEvents![0]!
    const overkill = projectBattleSnapshot(state, [
      tickEvents({ damageEvents: [damage({ amount: target.maxHp * 4 })] }),
    ]).actionEvents![0]!

    expect(half.strength01).toBeCloseTo(0.5, 6)
    // Overkill is real in the authority and meaningless on screen: a flash cannot be 400%.
    expect(overkill.strength01).toBe(1)
  })

  it('reports a death for each body that fell, on either side', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(101, 'melee', { x: 29, y: 16 }))

    const actions = projectBattleSnapshot(state, [
      tickEvents({
        transitions: { enemyDeaths: [enemyDeath(101)], friendlyDowns: [], friendlyDeaths: [7] },
      }),
    ]).actionEvents!

    const deaths = actions.filter((action) => action.kind === 'death')
    expect(deaths.map((death) => death.targetId).sort((a, b) => a - b)).toEqual([7, 101])
    // A death has no striker: nothing on screen should lunge for it.
    expect(deaths.every((death) => death.sourceId === null)).toBe(true)
    expect(deaths.every((death) => death.strength01 === 0)).toBe(true)
  })

  it('keeps §1.11 downed apart from dead, because the player has to tell them apart to answer §4.5', () => {
    const state = stateAt()

    const actions = projectBattleSnapshot(state, [
      tickEvents({ transitions: { enemyDeaths: [], friendlyDowns: [7, 8], friendlyDeaths: [] } }),
    ]).actionEvents!

    // A downed squadmate can be carried out; a dead one has come apart into paper. Publishing
    // a death for a down would scatter the very body §1.11 asks the player to run to.
    expect(actions).toEqual([])
  })

  it('emits every tick that shared the frame, in tick order, and drops none of them', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(101, 'melee', { x: 29, y: 16 }))
    const ticks: BattleTickEvents[] = [
      tickEvents({ tick: 40, damageEvents: [damage({ targetId: 2 })] }),
      tickEvents({ tick: 41, damageEvents: [damage({ targetId: 3 }), damage({ targetId: 4 })] }),
      tickEvents({
        tick: 42,
        damageEvents: [damage({ targetId: 5 })],
        transitions: { enemyDeaths: [], friendlyDowns: [], friendlyDeaths: [6] },
      }),
    ]

    const actions = projectBattleSnapshot(state, ticks).actionEvents!

    // Four blows and one death across three ticks. A "merge into one" or a "last tick only"
    // policy would answer 1, 2 or 3 here; the policy is ALL OF THEM.
    expect(actions).toHaveLength(5)
    expect(actions.map((action) => action.tick)).toEqual([40, 41, 41, 42, 42])
    expect(actions.map((action) => action.targetId)).toEqual([2, 3, 4, 5, 6])
  })

  it('never writes to the state it reads, and hands back no reference into it', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(101, 'melee', { x: 29, y: 16 }))
    const before = digestBattleState(state)

    const snapshot = projectBattleSnapshot(state, [
      tickEvents({
        damageEvents: [damage()],
        transitions: { enemyDeaths: [enemyDeath(101)], friendlyDowns: [], friendlyDeaths: [] },
      }),
    ])

    expect(digestBattleState(state)).toBe(before)
    expect(snapshot.actionEvents).toHaveLength(2)
    for (const action of snapshot.actionEvents!) {
      expect(typeof action.sourceX).toBe('number')
      expect(typeof action.targetY).toBe('number')
    }
  })

  it('accounts for every blow of a real battle, over hundreds of ticks', () => {
    // The one that cannot pass vacuously. A whole run is stepped, every tick's own events are
    // projected, and the totals are compared against what the authority actually resolved.
    const battle = createBattle('events-live')
    battle.start()
    let damageEvents = 0
    let deaths = 0
    let actionsFromDamage = 0
    let actionsFromDeath = 0
    for (let step = 0; step < 1500; step += 1) {
      const result = battle.step()
      if (!result.ran) {
        // §1.13's card screen stops the clock. Answering it is what keeps the run going far
        // enough for this to be a measurement of a battle rather than of its first minute.
        if (result.mode === 'awaiting-upgrade') battle.enqueue({ kind: 'choose-upgrade', slot: 1 })
        else break
        continue
      }
      const actions = projectBattleSnapshot(battle.state(), [result]).actionEvents!
      damageEvents += result.damageEvents.length
      deaths += result.transitions.enemyDeaths.length + result.transitions.friendlyDeaths.length
      actionsFromDamage += actions.filter((action) => action.kind !== 'death').length
      actionsFromDeath += actions.filter((action) => action.kind === 'death').length
    }

    expect(damageEvents).toBeGreaterThan(200)
    expect(deaths).toBeGreaterThan(5)
    expect(actionsFromDamage).toBe(damageEvents)
    expect(actionsFromDeath).toBe(deaths)
  })

  it('reports §1.12 blast only when a body was standing in it, on a real run', () => {
    // The `blast` branch is the one a fixture could leave permanently untested, so it is
    // exercised against the authority twice on the SAME seed and the same route, differing only
    // in whether the squad walks out of the circle. The kite that batch I's `seed-h` route uses
    // produces no blast events at all — which is §4.5's dodging question answered in the data —
    // so a test that only kited would have proved nothing about this branch.
    const run = (standStill: boolean): number => {
      const battle = createBattle('seed-h')
      battle.start()
      const circuit: [string, number][] = [['KeyD', 300], ['KeyS', 130], ['KeyA', 300], ['KeyW', 130]]
      let held: string | null = null
      let boundary = 0
      let leg = 0
      let blasts = 0
      for (let step = 0; step < 4000; step += 1) {
        const tick = battle.state().combatTick
        if (standStill && tick === ELITE_SPAWN_TICK && held) {
          battle.keyUp(held)
          held = null
        }
        if ((!standStill || tick < ELITE_SPAWN_TICK) && tick >= boundary) {
          if (held) battle.keyUp(held)
          const [code, ticks] = circuit[leg % circuit.length]!
          leg += 1
          boundary += ticks
          battle.keyDown(code)
          held = code
        }
        const result = battle.step()
        if (!result.ran) {
          if (result.mode === 'awaiting-upgrade') battle.enqueue({ kind: 'choose-upgrade', slot: 1 })
          else break
          continue
        }
        blasts += projectBattleSnapshot(battle.state(), [result]).actionEvents!
          .filter((action) => action.kind === 'blast').length
      }
      return blasts
    }

    expect(run(true)).toBeGreaterThan(0)
    expect(run(false)).toBe(0)
  })

  it('leaves the digest of a stepped battle byte-identical to one that was never projected', () => {
    const projected = createBattle('events-parallel')
    const bare = createBattle('events-parallel')
    projected.start()
    bare.start()
    for (let step = 0; step < 400; step += 1) {
      const result = projected.step()
      if (result.ran) projectBattleSnapshot(projected.state(), [result])
      bare.step()
      // An empty batch is applied on the same steps, so a projection that pushed a field onto
      // the state would show up here rather than only in the digest at the end.
      projectBattleSnapshot(bare.state(), [])
    }
    expect(projected.digest()).toBe(bare.digest())
  })

  it('takes a ResolvedTick straight from the authority without a converter in between', () => {
    // The channel's shape, pinned: whatever `advanceBattleTick` returns must be usable as the
    // projection's second argument. A wrapper type here would be a place for the two to drift.
    const battle = createBattle('events-shape')
    battle.start()
    battle.enqueue({ kind: 'toggle-pause' })
    const paused = battle.step()
    expect(paused.ran).toBe(false)
    battle.enqueue({ kind: 'toggle-pause' })
    const ran = battle.step()
    expect(ran.ran).toBe(true)
    if (!ran.ran) return
    const batch: readonly BattleTickEvents[] = [ran]
    expect(projectBattleSnapshot(battle.state(), batch).actionEvents).toBeDefined()
  })
})
