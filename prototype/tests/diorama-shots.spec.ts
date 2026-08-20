import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

import { COMBAT_TICK_LIMIT, ELITE_SPAWN_TICK } from '../src/core/battle/constants'
import { FORMATION_MAX_SLOT_RADIUS } from '../src/core/battle/formation'

/**
 * The capture harness behind the screenshots in `artifacts/`.
 *
 * It is a spec so it runs the same browser, the same dev server and the same route the rest of
 * the e2e suite runs, and it is SKIPPED unless `DIORAMA_SHOTS=1` — a capture run plays several
 * whole battles in real time and has no assertion the suite needs on every run.
 *
 *   DIORAMA_SHOTS=1 npx playwright test tests/diorama-shots.spec.ts --workers=1
 */
const CAPTURING = process.env.DIORAMA_SHOTS === '1'
const ARTIFACTS = new URL('../artifacts/', import.meta.url).pathname

test.skip(!CAPTURING, 'set DIORAMA_SHOTS=1 to re-capture the diorama screenshots')
test.describe.configure({ mode: 'serial' })

test.use({ viewport: { width: 1600, height: 1000 } })

async function start(page: Page, seed: string): Promise<void> {
  await page.goto(`?seed=${seed}`)
  await expect(page.locator('[data-battle-ready]')).toBeVisible()
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('.bt-stage canvas')).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => (window.__SQUADING_TEST__?.battle?.hud().tick ?? 0) > 0, undefined, {
    polling: 'raf',
    timeout: 30_000,
  })
}

function tick(page: Page): Promise<number> {
  return page.evaluate(() => window.__SQUADING_TEST__!.battle!.hud().tick)
}

async function answerCardScreenIfShowing(page: Page): Promise<void> {
  if (!(await page.locator('[data-battle-upgrade]').isVisible())) return
  await page.keyboard.press('Digit1')
  await expect(page.locator('[data-battle-upgrade]')).toBeHidden()
}

async function playTicks(page: Page, ticks: number, timeout = 180_000): Promise<void> {
  const goal = Math.min((await tick(page)) + ticks, COMBAT_TICK_LIMIT)
  for (let guard = 0; guard < 12; guard += 1) {
    await page.waitForFunction(
      (target) => {
        const hud = window.__SQUADING_TEST__?.battle?.hud()
        return hud ? hud.tick >= target || hud.mode !== 'running' : false
      },
      goal,
      { polling: 'raf', timeout },
    )
    const mode = await page.evaluate(() => window.__SQUADING_TEST__!.battle!.hud().mode)
    if (mode === 'won' || mode === 'lost') return
    if ((await tick(page)) >= goal) return
    await answerCardScreenIfShowing(page)
  }
}

const UPGRADE_MODAL = '[data-battle-upgrade]'

/**
 * Takes the shot, and takes it of the BOARD.
 *
 * §1.13's card screen is a DOM modal over the stage that stops the clock, and an element
 * screenshot photographs whatever is on top of the element — so a frame caught while one is up
 * is a picture of the modal with a dimmed diorama behind it. It cannot simply be answered once
 * either: on a fast route the next one can open within twenty ticks. So the battle is PAUSED for
 * the exposure, which freezes the authority clock and makes it impossible for another card
 * screen to open between the check and the shutter, and unpaused afterwards.
 */
/**
 * The shutter, plus the reading. Nothing here advances the battle clock — a transient state like
 * the elite's warning ring is gone in a handful of ticks, so a capture that stepped the sim
 * before firing would photograph the moment after the one it was asked for.
 */
async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true })
  await page.locator('.bt-stage canvas').screenshot({ path: `${ARTIFACTS}${name}.png` })
  // The occlusion reading belongs with the shot it was taken from: §카메라 asks for the cost of
  // the lowered camera to be measured and written down, and this is where the number comes from.
  const framing = await page.evaluate(() => window.__SQUADING_TEST__!.rendererScene!()!.framing)
  console.log(
    `[shot] ${name} pitch=${framing.cameraPitchDegrees.toFixed(1)}deg halfW=${framing.viewHalfWidth.toFixed(2)}`
    + ` units=${framing.units} inView=${framing.unitsInView}`
    + ` occl bodies=${framing.occlusion.bodies} max=${framing.occlusion.maxHiddenFraction.toFixed(2)}`
    + ` mean=${framing.occlusion.meanHiddenFraction.toFixed(3)} mostly=${framing.occlusion.mostlyHidden}`
    + ` fully=${framing.occlusion.fullyHidden}`,
  )
}

async function shoot(page: Page, name: string): Promise<void> {
  let clean = false
  for (let attempt = 0; attempt < 30 && !clean; attempt += 1) {
    await answerCardScreenIfShowing(page)
    if (await page.locator(UPGRADE_MODAL).isVisible()) continue
    await snap(page, name)
    // Re-checked AFTER the shutter, not only before it: a card screen that opened in between is
    // a card screen in the picture, and the check that catches it has to be on the other side.
    clean = !(await page.locator(UPGRADE_MODAL).isVisible())
    if (!clean) await playTicks(page, 12)
  }
  expect(clean, 'never found a frame without §1.13 card screen over it').toBe(true)
}

/** How far the furthest live friendly has strayed from the body the player drives. */
async function squadSpread(page: Page): Promise<number> {
  return page.evaluate(() => {
    const snapshot = window.__SQUADING_TEST__!.battle!.snapshot()
    const command = snapshot.units.find((unit) => unit.kind === 'commander')
    if (!command) return 0
    const squad = snapshot.units.filter((unit) => unit.team !== 'enemy' && unit.state !== 'dead')
    return Math.max(...squad.map((unit) => Math.hypot(unit.x - command.x, unit.y - command.y)))
  })
}

test('captures a mid-fight board', async ({ page }) => {
  test.setTimeout(240_000)
  await start(page, 'seed-a')
  await page.keyboard.down('KeyD')
  await playTicks(page, 300)
  await page.keyboard.up('KeyD')
  await playTicks(page, 120)
  await shoot(page, 'shot-mid-fight')
})

test('captures the squad scattered by the leash', async ({ page }) => {
  test.setTimeout(240_000)
  await start(page, 'seed-a')
  // §1.4.1 pulls the fifteen off their slots to fight; the shot has to be taken while they
  // are actually out there, so the capture waits for a spread the formation cannot produce.
  await page.keyboard.down('KeyA')
  await page.keyboard.down('KeyW')
  await playTicks(page, 240)
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')
  for (let guard = 0; guard < 20 && (await squadSpread(page)) <= FORMATION_MAX_SLOT_RADIUS * 1.6; guard += 1) {
    await playTicks(page, 30)
  }
  expect(await squadSpread(page)).toBeGreaterThan(FORMATION_MAX_SLOT_RADIUS)
  await shoot(page, 'shot-scattered')
})

/**
 * The elite arrives at `ELITE_SPAWN_TICK`, and a run only gets there if it is still alive: on a
 * standing-still route the squad is wiped long before. So the capture drives the same kiting
 * circuit `battle-play.spec.ts` uses to reach the elite on `seed-h`, and polls for the moment
 * the warning ring is actually painted.
 */
const CIRCUIT: readonly { code: string; ticks: number }[] = [
  { code: 'KeyD', ticks: 300 },
  { code: 'KeyS', ticks: 130 },
  { code: 'KeyA', ticks: 300 },
  { code: 'KeyW', ticks: 130 },
]

function telegraphShowing(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__SQUADING_TEST__?.rendererScene?.()?.eliteTelegraph.visible === true)
}

/**
 * The camera widens to whatever the furthest stray soldier needs (§4.4(a)), so a telegraph frame
 * caught while one of the fifteen is halfway across the arena shows the warning ring three
 * pixels wide. This prefers a frame where the squad has come back together enough for the ring
 * to be legible, and settles for any telegraph frame if it never does.
 */
const TELEGRAPH_READABLE_HALF_WIDTH = 22

/**
 * Is the warning ring both up AND somewhere a reader can see it?
 *
 * "Visible" in the scene-graph sense only says the mesh exists. The ring is painted on the
 * ground at the authoritative strike centre, and that centre is projected through the live
 * camera here — so a frame where it has been pushed to the edge of a zoomed-out view is not
 * accepted as the picture of it.
 */
async function telegraphIsFramed(page: Page): Promise<boolean> {
  if ((await viewHalfWidth(page)) >= TELEGRAPH_READABLE_HALF_WIDTH) return false
  return page.evaluate(() => {
    const snapshot = window.__SQUADING_TEST__!.battle!.snapshot()
    const telegraph = snapshot.effects.find((effect) => effect.kind === 'elite-telegraph')
    if (!telegraph) return false
    const point = window.__SQUADING_TEST__!.projectGroundPoint!(telegraph.x, telegraph.y)
    return point !== null && Math.abs(point.x) < 0.65 && Math.abs(point.y) < 0.6
  })
}

function viewHalfWidth(page: Page): Promise<number> {
  return page.evaluate(() => window.__SQUADING_TEST__!.rendererScene!()!.framing.viewHalfWidth)
}

test('captures the elite telegraph', async ({ page }) => {
  test.setTimeout(420_000)
  await start(page, 'seed-h')
  let leg = 0
  let showing = false
  let readable = false
  while (!readable && (await tick(page)) < COMBAT_TICK_LIMIT) {
    const step = CIRCUIT[leg % CIRCUIT.length]!
    leg += 1
    await page.keyboard.down(step.code)
    for (let chunk = 0; chunk < step.ticks / 3 && !readable; chunk += 1) {
      await playTicks(page, 3)
      if (await page.locator('[data-battle-terminal]').isVisible()) break
      if (await page.locator(UPGRADE_MODAL).isVisible()) continue
      if (!(await telegraphShowing(page))) continue
      showing = true
      if (!(await telegraphIsFramed(page))) continue
      // Fire NOW. The warning runs for a handful of ticks and then the strike lands; anything
      // between finding it and the shutter is a chance to photograph the moment after it.
      readable = true
      await snap(page, 'shot-elite-telegraph')
    }
    await page.keyboard.up(step.code)
    if (await page.locator('[data-battle-terminal]').isVisible()) break
  }
  expect(await tick(page)).toBeGreaterThan(ELITE_SPAWN_TICK)
  expect(showing, 'the elite never telegraphed a strike in this run').toBe(true)
  expect(readable, 'the telegraph was never framed where it could be read').toBe(true)
})

test('captures a unit standing inside the field clutter', async ({ page }) => {
  test.setTimeout(300_000)
  await start(page, 'seed-a')
  // The clutter is walk-through, and a screenshot of a body standing *on* a piece of it is the
  // fastest way to say so. The wait is for that overlap to actually be on screen.
  for (let guard = 0; guard < 40; guard += 1) {
    const overlapping = await page.evaluate(
      () => window.__SQUADING_TEST__?.rendererScene?.()?.fieldClutter.unitsOverlappingClutter ?? 0,
    )
    if (overlapping > 0) break
    await page.keyboard.down('KeyD')
    await playTicks(page, 30)
    await page.keyboard.up('KeyD')
  }
  expect(await page.evaluate(() => window.__SQUADING_TEST__!.rendererScene!()!.fieldClutter.unitsOverlappingClutter)).toBeGreaterThan(0)
  await shoot(page, 'shot-clutter-walkthrough')
})

/**
 * The five class silhouettes, side by side on one board.
 *
 * §미니어처 디테일 asks for the class to be readable from the silhouette alone, and a mid-fight
 * screenshot is the worst possible evidence for that: the bodies overlap, they face wherever
 * they are shooting, and half of them are mid-animation. This lines one of each up, facing the
 * same way, on the same board, under the same light — which is the picture a person can actually
 * judge "these five are different shapes" from.
 *
 * The snapshot is hand-built and carries display inputs only (`kind`, `hp01`, `state`). It makes
 * no claim about the simulation and cannot reach it.
 */
test('captures the five class silhouettes lined up', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
  await page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    document.body.style.margin = '0'
    const host = document.createElement('div')
    host.id = 'silhouette-host'
    host.style.cssText = 'position:fixed;inset:0;width:1600px;height:1000px;z-index:9999'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)
    renderer.resize(1600, 1000, 1)

    // Turned three-quarters towards the camera, the way a painted miniature is photographed —
    // the renderer's own yaw is `PI/2 - facingRadians`, and in a live battle it is derived from
    // where the body is walking, which is never a fixed angle.
    const body = (id: number, kind: string, team: string, x: number) => ({
      id, kind, team, squad: team === 'enemy' ? null : team,
      x, y: 0, facingRadians: Math.PI / 2 + 0.5, radius: 0.45, hp01: 1, fatigue01: 0, morale01: 1, state: 'idle',
    })
    const snapshot = {
      tick: 40,
      elapsedMs: 1333,
      units: [
        body(1, 'commander', 'scarlet', -6.6),
        body(2, 'soldier', 'teal', -3.4),
        body(3, 'enemy', 'enemy', -0.2),
        body(4, 'enemy-commander', 'enemy', 3),
        body(5, 'elite', 'enemy', 6.6),
      ],
      projectiles: [],
      effects: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 18, worldHeight: 11 },
      // The play area is the real arena's size even though the camera looks at a slice of it:
      // the clutter is planned across the whole board, and a fixture that shrank the board would
      // pack every piece of it into the frame and show a density the game never has.
      playArea: { centerX: 0, centerY: 0, worldWidth: 56, worldHeight: 32 },
      activeSquad: 'teal',
    }
    // Several frames: the first builds the diorama, the rest let each figure settle out of its
    // spawn state so nothing is caught mid-animation.
    for (let frame = 0; frame < 6; frame += 1) renderer.render({ ...snapshot, tick: 40 + frame }, 0)
    ;(window as unknown as { __shotRenderer?: unknown }).__shotRenderer = renderer
  })
  mkdirSync(ARTIFACTS, { recursive: true })
  await page.locator('#silhouette-host canvas').screenshot({ path: `${ARTIFACTS}shot-class-silhouettes.png` })
})
