import { expect, test, type Page } from '@playwright/test'

/**
 * The health gauge over a miniature's head, and the class silhouettes under it.
 *
 * DRIVEN BY HAND-BUILT SNAPSHOTS, not by playing a battle. The gauge's rule has four branches
 * — a friendly always shows one, a hostile only once damaged, a downed body never, a swept-away
 * body never — and three of them cannot be reached at a chosen moment of a real run: a browser
 * test that waits for a friendly to go down waits most of ninety seconds and then asserts
 * whatever the balance happened to produce. Building the snapshot puts every branch on the
 * board at once, and the renderer reads nothing but the snapshot, so a hand-built one is
 * exactly as real to it as the authority's.
 *
 * The values below are display inputs (`hp01`, `state`, `kind`), never authority state: this
 * file makes no claim about the simulation and cannot affect it. `battle-play.spec.ts` is
 * where the same renderer is checked against a live authority run.
 */

const BODIES = [
  'miniature:command',
  'miniature:soldier',
  'miniature:melee',
  'miniature:shooter',
  'miniature:elite',
] as const

async function drive(page: Page) {
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
  return page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')

    const host = document.createElement('div')
    host.style.width = '960px'
    host.style.height = '600px'
    document.body.append(host)

    const renderer = createRenderer()
    await renderer.mount(host)

    const unit = (
      id: number,
      kind: string,
      team: string,
      hp01: number,
      state: string,
      x: number,
    ) => ({
      id,
      kind,
      team,
      squad: team === 'enemy' ? null : team,
      x,
      y: 0,
      facingRadians: 0,
      radius: 0.45,
      hp01,
      fatigue01: 0,
      morale01: 1,
      state,
    })

    // One board carrying every branch of the rule and every class of body.
    const units = [
      unit(1, 'commander', 'scarlet', 1, 'idle', -8),
      unit(2, 'soldier', 'teal', 1, 'idle', -6),
      unit(3, 'soldier', 'teal', 0.42, 'attacking', -4),
      unit(4, 'soldier', 'teal', 0, 'downed', -2),
      unit(5, 'soldier', 'teal', 0, 'dead', 0),
      unit(6, 'enemy', 'enemy', 1, 'idle', 2),
      unit(7, 'enemy', 'enemy', 0.55, 'attacking', 4),
      unit(8, 'enemy-commander', 'enemy', 1, 'idle', 6),
      unit(9, 'enemy-commander', 'enemy', 0.2, 'idle', 8),
      unit(10, 'elite', 'enemy', 0.75, 'idle', 10),
    ]
    const snapshot = {
      tick: 12,
      elapsedMs: 400,
      units,
      projectiles: [],
      effects: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 48, worldHeight: 30 },
      playArea: { centerX: 0, centerY: 0, worldWidth: 48, worldHeight: 30 },
      activeSquad: 'teal',
    }

    // The first two frames build the diorama and let the per-unit animation state settle — the
    // body that is already dead when the board is built finishes its sweep here, and comparing
    // across that would be comparing two different boards.
    renderer.render(snapshot, 0)
    renderer.render({ ...snapshot, tick: 13 }, 0)
    renderer.render({ ...snapshot, tick: 14 }, 0)

    const state = window.__SQUADING_TEST__!.rendererScene!()!
    const withGauges = renderer.collectMetrics().drawCalls

    // The same board with every hostile back at full health, which is the only difference the
    // gauge rule reacts to. What the two frames differ by IS what the hostile gauges cost.
    renderer.render({
      ...snapshot,
      tick: 15,
      units: units.map((body) => (body.team === 'enemy' ? { ...body, hp01: 1 } : body)),
    }, 0)
    const withoutHostileGauges = renderer.collectMetrics().drawCalls
    const restored = window.__SQUADING_TEST__!.rendererScene!()!.healthGauges.visible

    // And the marginal cost of a WHOLE unit, gauge and all: the same board with one more body
    // standing on it, drawn twice so the added figure's animation state has settled the way
    // every other one has.
    const oneMore = [...units, unit(11, 'enemy', 'enemy', 0.6, 'idle', -10)]
    renderer.render({ ...snapshot, tick: 16, units: oneMore }, 0)
    renderer.render({ ...snapshot, tick: 17, units: oneMore }, 0)
    const withOneMoreUnit = renderer.collectMetrics().drawCalls
    renderer.render({ ...snapshot, tick: 18 }, 0)
    const baseline = renderer.collectMetrics().drawCalls

    renderer.dispose()
    host.remove()
    return { state, withGauges, withoutHostileGauges, restored, withOneMoreUnit, baseline }
  })
}

test('gives every class its own body and every eligible unit one health gauge', async ({ page }) => {
  const { state, withGauges, withoutHostileGauges, restored, withOneMoreUnit, baseline } = await drive(page)

  // The five classes the authority can publish get five sculpted bodies. `UnitKind` is the
  // only class signal in the snapshot, and `core/battle-view` projects §1.9's melee class as
  // `enemy` and its ranged class as `enemy-commander` — before batch J those two shared one
  // body, as did the command unit and its fifteen.
  expect(state.presentation.bodyArchetypes.slice().sort()).toEqual(BODIES.slice().sort())
  expect(state.presentation.mergedBodyGeometries).toBe(5)

  // The budget, and it is the whole reason the gauge is one mesh rather than a track and a
  // fill: body + base ring + contact shadow + gauge.
  expect(state.presentation.meshesPerUnit).toBe(4)

  // Which gauges are up. Both friendlies that are neither downed nor swept away carry one
  // whatever their health; of the four hostiles, only the three that have been hurt do.
  expect(state.healthGauges.friendlyStanding).toBe(3)
  expect(state.healthGauges.friendlyVisible).toBe(3)
  expect(state.healthGauges.hostileFull).toBe(2)
  expect(state.healthGauges.hostileFullVisible).toBe(0)
  expect(state.healthGauges.hostileDamaged).toBe(3)
  expect(state.healthGauges.hostileDamagedVisible).toBe(3)
  // The downed body shows no bar: its health is pinned at zero and §1.11's countdown is the
  // fact of that moment. The countdown is printed on the shell's roster strip, not on the
  // board — `tests/app/battle-hud.test.ts` is where that readout is pinned.
  expect(state.healthGauges.downed).toBe(1)
  expect(state.healthGauges.downedVisible).toBe(0)
  expect(state.healthGauges.visible).toBe(6)

  // Every bar faces the camera, clears the body under it, and is filled to that body's own
  // `hp01`. The renderer keeps no health number of its own — this is the whole claim that the
  // gauge is display-only.
  expect(state.healthGauges.billboarded).toBe(6)
  expect(state.healthGauges.maxFillError).toBeLessThan(1e-3)
  expect(state.healthGauges.minHeadroom).toBeGreaterThan(0)

  // And the budget as the GPU counts it, not as the scene graph promises it. A total is not
  // the measurement — the scene carries a board, four rails, props, decals, particle pools and
  // a shadow pass — so what is measured are two DIFFERENCES.
  //
  // First, what the gauge itself costs: put the three damaged hostiles back at full health and
  // exactly three draw calls go away. One gauge, one draw call.
  expect(withGauges).not.toBeNull()
  expect(restored).toBe(3)
  expect(withGauges! - withoutHostileGauges!).toBe(3)

  // Second, what a whole unit costs: one more body on the board is FIVE draw calls, and the
  // five are named — the four meshes the spec budgets (body, base ring, contact shadow,
  // gauge), plus the body a second time in the directional light's shadow-map pass. The
  // shadow pass is not a fifth mesh and the ring, the contact shadow and the gauge do not
  // enter it; a unit is four drawn objects, which is the budget, drawn from two cameras.
  expect(withOneMoreUnit! - baseline!).toBe(5)
})

test('follows the value: the fill drains with hp01 and a hostile bar appears on the first hit', async ({ page }) => {
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
  const frames = await page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const host = document.createElement('div')
    host.style.width = '960px'
    host.style.height = '600px'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)

    const body = (id: number, kind: string, team: string, hp01: number, x: number) => ({
      id, kind, team, squad: team === 'enemy' ? null : team,
      x, y: 0, facingRadians: 0, radius: 0.45, hp01, fatigue01: 0, morale01: 1,
      state: 'idle',
    })

    const observed: { hp: number; visible: number; fillError: number; drawCalls: number }[] = []
    // The friendly bleeds out from full; the hostile is untouched for the first two frames and
    // then starts taking damage. Ten frames, one hp step each.
    for (let frame = 0; frame < 10; frame += 1) {
      const friendlyHp = Math.max(0.05, 1 - frame * 0.1)
      const hostileHp = frame < 2 ? 1 : Math.max(0.05, 1 - (frame - 1) * 0.12)
      renderer.render({
        tick: frame,
        elapsedMs: frame * 33,
        units: [body(1, 'soldier', 'teal', friendlyHp, -3), body(2, 'enemy', 'enemy', hostileHp, 3)],
        projectiles: [],
        effects: [],
        camera: { centerX: 0, centerY: 0, worldWidth: 48, worldHeight: 30 },
        playArea: { centerX: 0, centerY: 0, worldWidth: 48, worldHeight: 30 },
        activeSquad: 'teal',
      }, 0)
      const state = window.__SQUADING_TEST__!.rendererScene!()!
      observed.push({
        hp: hostileHp,
        visible: state.healthGauges.visible,
        fillError: state.healthGauges.maxFillError,
        drawCalls: renderer.collectMetrics().drawCalls ?? 0,
      })
    }
    renderer.dispose()
    host.remove()
    return observed
  })

  // The friendly's bar is up from the very first frame, alone, while the hostile is untouched.
  expect(frames[0]!.visible).toBe(1)
  expect(frames[1]!.visible).toBe(1)
  // The frame the hostile first loses health is the frame its bar appears, and it stays. One
  // extra bar, one extra draw call — the same measurement the budget test takes, taken here
  // across the transition rather than across two boards.
  expect(frames.slice(2).every((frame) => frame.visible === 2)).toBe(true)
  expect(frames.slice(2).every((frame) => frame.hp < 1)).toBe(true)
  expect(frames[2]!.drawCalls - frames[1]!.drawCalls).toBe(1)
  // And through the whole drain, no bar ever disagrees with the `hp01` it is drawn from.
  expect(Math.max(...frames.map((frame) => frame.fillError))).toBeLessThan(1e-3)
})
