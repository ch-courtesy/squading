import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

import { ARRIVE_EPSILON, COMBAT_TICK_LIMIT, ELITE_SPAWN_TICK } from '../src/core/battle/constants'
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

// ---------------------------------------------------------------------------
// §액션 피드백 — the four moments batch L is answerable for
// ---------------------------------------------------------------------------
// These are captured from an OFFLINE run of the real v2 battle rather than from the live route,
// and the reason is the shutter. A lunge lasts 7 ticks and a hit flash 5 — about 230 and 170
// milliseconds — and a Playwright screenshot takes longer than that to arrange. A live capture
// would be polling for a moment that is already over by the time the shutter opens.
//
// So the same three calls the controller makes (`battle.step()`, `projectBattleSnapshot`,
// `renderer.render`) are driven by the test, one tick at a time, and the loop STOPS on the frame
// where the renderer's own counters say the animation is at its peak. The pixels are the
// renderer's, the events are the authority's, and the frame is chosen by measurement.
//
// The route is `seed-h` with `battle-play.spec.ts`'s winning circuit, because the elite arrives
// at tick 1800 and a squad that took no input is long dead by then.

const ACTION_CIRCUIT: readonly (readonly [string, number])[] = [
  ['KeyD', 300], ['KeyS', 130], ['KeyA', 300], ['KeyW', 130],
]

type ActionMoment = {
  tick: number
  maxLungeOffset: number
  maxFlash: number
  topplingUnits: number
  livePuffs: number
  liveScraps: number
  eventsPlayed: number
  bodiesInside: number
  /** Where on the board the moment happened, so a detail crop can be aimed at it. */
  focusX: number
  focusY: number
} | null

/** Nothing is shot before this tick: the opening second is two bodies meeting, not a fight. */
const ACTION_SHOT_MIN_TICK = 150

/** Installs the offline board and `window.__actionShot(want, maxTicks)` over it. */
async function openActionBoard(page: Page, seed: string): Promise<void> {
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
  await page.evaluate(async ({ seed, circuit }) => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const { createBattle } = await (0, eval)('import("/src/core/battle/battle.ts")')
    const { projectBattleSnapshot } = await (0, eval)('import("/src/core/battle-view/snapshot.ts")')
    document.body.style.margin = '0'
    const host = document.createElement('div')
    host.id = 'action-shot-host'
    host.style.cssText = 'position:fixed;inset:0;width:1600px;height:1000px;z-index:9999'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)
    renderer.resize(1600, 1000, 1)
    const battle = createBattle(seed)
    battle.start()

    let held: string | null = null
    let boundary = 0
    let leg = 0
    const bridge = () => window.__SQUADING_TEST__!.rendererScene!()!

    ;(window as unknown as { __actionShot?: unknown }).__actionShot = (want: string, maxTicks: number, minTick: number) => {
      for (let step = 0; step < maxTicks; step += 1) {
        if (battle.state().combatTick >= boundary) {
          if (held) battle.keyUp(held)
          const leom = circuit[leg % circuit.length]!
          leg += 1
          boundary += leom[1]
          battle.keyDown(leom[0])
          held = leom[0]
        }
        const result = battle.step()
        if (!result.ran) {
          if (result.mode === 'awaiting-upgrade') {
            battle.enqueue({ kind: 'choose-upgrade', slot: 1 })
            continue
          }
          return null
        }
        const snapshot = projectBattleSnapshot(battle.state(), [result])
        renderer.render(snapshot, 0)
        if (result.tick < minTick) continue
        const view = bridge()
        const action = view.action
        // Where to aim the detail crop: the authority's own coordinates for the event that made
        // this frame the one worth photographing.
        const events = snapshot.actionEvents
        const attacker = events.find((event: { kind: string }) => event.kind === 'shot' || event.kind === 'melee')
        const death = events.find((event: { kind: string }) => event.kind === 'death')
        const telegraphEffect = snapshot.effects.find((effect: { kind: string }) => effect.kind === 'elite-telegraph')
        const found = want === 'attack'
          ? action.maxLungeOffset > 0.30 && action.livePuffs > 4 && attacker !== undefined
          : want === 'hit'
            ? action.maxFlash > 0.7 && action.flashingUnits >= 2 && attacker !== undefined
            : want === 'death'
              ? action.topplingUnits > 0 && action.liveScraps > 20 && death !== undefined
              : view.eliteTelegraph.visible && view.eliteTelegraph.bodiesInside >= 2
        if (!found) continue
        const focus = want === 'attack'
          ? { x: attacker!.sourceX, y: attacker!.sourceY }
          : want === 'hit'
            ? { x: attacker!.targetX, y: attacker!.targetY }
            : want === 'death'
              ? { x: death!.targetX, y: death!.targetY }
              : { x: telegraphEffect!.x, y: telegraphEffect!.y }
        return {
          tick: result.tick,
          maxLungeOffset: action.maxLungeOffset,
          maxFlash: action.maxFlash,
          topplingUnits: action.topplingUnits,
          livePuffs: action.livePuffs,
          liveScraps: action.liveScraps,
          eventsPlayed: action.eventsPlayed,
          bodiesInside: view.eliteTelegraph.bodiesInside,
          focusX: focus.x,
          focusY: focus.y,
        }
      }
      return null
    }
  }, { seed, circuit: ACTION_CIRCUIT.map((leg) => [leg[0], leg[1]] as [string, number]) })
}

async function runToMoment(page: Page, want: string, maxTicks: number): Promise<ActionMoment> {
  return page.evaluate(
    ({ want, maxTicks, minTick }) =>
      (window as unknown as { __actionShot: (w: string, m: number, t: number) => ActionMoment })
        .__actionShot(want, maxTicks, minTick),
    { want, maxTicks, minTick: ACTION_SHOT_MIN_TICK },
  ) as Promise<ActionMoment>
}

const SHOT_WIDTH = 1600
const SHOT_HEIGHT = 1000
/** The detail crop, in pixels. Wide enough to hold two bodies and the ground between them. */
const DETAIL_WIDTH = 620
const DETAIL_HEIGHT = 420

/**
 * The whole board, and a crop of the moment inside it.
 *
 * A miniature is a small thing in a 1600-wide board shot, and a puff of smoke at its weapon is
 * smaller. The full frame is what a player sees; the crop is what a reader can judge. The crop is
 * aimed by projecting the AUTHORITY'S OWN coordinates for the event through the live camera, so
 * it is centred on the thing the shot is evidence of rather than on a guess.
 */
async function snapAction(page: Page, name: string, moment: ActionMoment): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true })
  await page.locator('#action-shot-host canvas').screenshot({ path: `${ARTIFACTS}${name}.png` })
  if (!moment) return
  const point = await page.evaluate(
    ({ x, y }) => window.__SQUADING_TEST__!.projectGroundPoint!(x, y),
    { x: moment.focusX, y: moment.focusY },
  )
  if (!point) return
  const centreX = ((point.x + 1) / 2) * SHOT_WIDTH
  const centreY = ((1 - point.y) / 2) * SHOT_HEIGHT
  await page.screenshot({
    path: `${ARTIFACTS}${name}-detail.png`,
    clip: {
      x: Math.max(0, Math.min(SHOT_WIDTH - DETAIL_WIDTH, centreX - DETAIL_WIDTH / 2)),
      y: Math.max(0, Math.min(SHOT_HEIGHT - DETAIL_HEIGHT, centreY - DETAIL_HEIGHT / 2)),
      width: DETAIL_WIDTH,
      height: DETAIL_HEIGHT,
    },
  })
}

test('captures the attack, the hit, the death and the warning with bodies in it', async ({ page }) => {
  test.setTimeout(420_000)
  await openActionBoard(page, 'seed-h')

  const attack = await runToMoment(page, 'attack', 900)
  expect(attack, 'no frame reached a full lunge with smoke in the air').not.toBeNull()
  await snapAction(page, 'shot-action-attack', attack)
  console.log(`[shot] shot-action-attack tick=${attack!.tick} lunge=${attack!.maxLungeOffset.toFixed(3)} puffs=${attack!.livePuffs} events=${attack!.eventsPlayed}`)

  const hit = await runToMoment(page, 'hit', 900)
  expect(hit, 'no frame caught two bodies flashing at once').not.toBeNull()
  await snapAction(page, 'shot-action-hit', hit)
  console.log(`[shot] shot-action-hit tick=${hit!.tick} flash=${hit!.maxFlash.toFixed(3)} events=${hit!.eventsPlayed}`)

  const death = await runToMoment(page, 'death', 1500)
  expect(death, 'no frame caught a figure toppling in a shower of scraps').not.toBeNull()
  await snapAction(page, 'shot-action-death', death)
  console.log(`[shot] shot-action-death tick=${death!.tick} toppling=${death!.topplingUnits} scraps=${death!.liveScraps}`)

  // §정예 예고. The run has to survive to tick 1800 for this one, which is what the circuit is for.
  const telegraph = await runToMoment(page, 'telegraph', 3000)
  expect(telegraph, 'the elite never telegraphed a strike with bodies standing in it').not.toBeNull()
  await snapAction(page, 'shot-elite-telegraph-bodies', telegraph)
  const legibility = await page.evaluate(() => window.__SQUADING_TEST__!.telegraphLegibility!())
  expect(legibility).not.toBeNull()
  console.log(
    `[shot] shot-elite-telegraph-bodies tick=${telegraph!.tick} bodiesInside=${telegraph!.bodiesInside}`
    + ` samples=${legibility!.samples} occluded=${legibility!.occludedSamples}`
    + ` groundOnlyPainted=${legibility!.groundOnlyPaintedSamples} painted=${legibility!.paintedSamples}`,
  )
  // The picture is only evidence if the ring in it really is behind bodies and really is whole.
  expect(telegraph!.bodiesInside).toBeGreaterThanOrEqual(2)
  expect(legibility!.paintedSamples).toBe(legibility!.samples)
})

// --- Batch M: the walk ---------------------------------------------------------------------
//
// A STILL CANNOT SHOW MOTION, and these three are honest about what they are: they are pictures
// of POSES, chosen by measurement. What each frame is evidence of is written in the log line
// beside it — how many friendlies were striding, how far the authority had moved them that
// tick, and how fast the closing melee was going compared with the commander it was chasing.
// The motion itself is pinned by `tests/figure-rig.test.ts` and `tests/figure-walk.spec.ts`.

type WalkMoment = {
  tick: number
  striding: number
  settled: number
  friendlies: number
  /** The largest per-tick step among the live friendlies, in world units. */
  maxStep: number
  commandStep: number
  /** The nearest melee: its step this tick, and how far it still has to close. */
  chaserStep: number
  chaserRange: number
  focusX: number
  focusY: number
} | null

/**
 * Installs an offline board and `window.__walkShot(want, maxTicks, hold)` over it.
 *
 * Same three calls the controller makes — `battle.step()`, `projectBattleSnapshot`, `render` —
 * driven a tick at a time so a pose that lasts a handful of ticks can actually be caught. The
 * step every unit took is computed here from consecutive AUTHORITY snapshots, which is the same
 * quantity the renderer's stride reads, so the number in the log line and the legs in the
 * picture come from one source.
 */
async function openWalkBoard(page: Page, seed: string, arriveEpsilon: number): Promise<void> {
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
  await page.evaluate(async ({ seed, arriveEpsilon }) => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const { createBattle } = await (0, eval)('import("/src/core/battle/battle.ts")')
    const { projectBattleSnapshot } = await (0, eval)('import("/src/core/battle-view/snapshot.ts")')
    document.body.style.margin = '0'
    const host = document.createElement('div')
    host.id = 'action-shot-host'
    host.style.cssText = 'position:fixed;inset:0;width:1600px;height:1000px;z-index:9999'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)
    renderer.resize(1600, 1000, 1)
    const battle = createBattle(seed)
    battle.start()
    let held: string | null = null
    const previous = new Map<number, { x: number; y: number }>()

    ;(window as unknown as { __walkShot?: unknown }).__walkShot = (want: string, maxTicks: number, hold: string | null) => {
      if (held !== hold) {
        if (held) battle.keyUp(held)
        if (hold) battle.keyDown(hold)
        held = hold
      }
      for (let step = 0; step < maxTicks; step += 1) {
        const result = battle.step()
        if (!result.ran) {
          if (result.mode === 'awaiting-upgrade') { battle.enqueue({ kind: 'choose-upgrade', slot: 1 }); continue }
          return null
        }
        const snapshot = projectBattleSnapshot(battle.state(), [result])
        renderer.render(snapshot, 0)
        type Unit = { id: number; kind: string; team: string; state: string; x: number; y: number }
        const units = snapshot.units as Unit[]
        const stepOf = (unit: Unit) => {
          const last = previous.get(unit.id)
          return last ? Math.hypot(unit.x - last.x, unit.y - last.y) : 0
        }
        const friendlies = units.filter((unit) => unit.team !== 'enemy' && unit.state !== 'dead' && unit.state !== 'downed')
        const command = units.find((unit) => unit.kind === 'commander')
        const striding = friendlies.filter((unit) => stepOf(unit) > arriveEpsilon).length
        const maxStep = friendlies.reduce((max, unit) => Math.max(max, stepOf(unit)), 0)
        const commandStep = command ? stepOf(command) : 0
        // §1.9's melee class is `enemy`; `enemy-commander` is the shooter. The one that matters
        // here is the melee closing on the body the player drives.
        const chasers = command
          ? units.filter((unit) => unit.kind === 'enemy' && unit.state !== 'dead')
            .map((unit) => ({ unit, range: Math.hypot(unit.x - command.x, unit.y - command.y) }))
            .sort((left, right) => left.range - right.range)
          : []
        const chaser = chasers[0]
        const reading: NonNullable<WalkMoment> = {
          tick: result.tick,
          striding,
          settled: friendlies.length - striding,
          friendlies: friendlies.length,
          maxStep,
          commandStep,
          chaserStep: chaser ? stepOf(chaser.unit) : 0,
          chaserRange: chaser ? chaser.range : Infinity,
          focusX: command?.x ?? 0,
          focusY: command?.y ?? 0,
        }
        units.forEach((unit) => previous.set(unit.id, { x: unit.x, y: unit.y }))
        if (result.tick < 12) continue
        const found = want === 'walking'
          ? striding >= Math.max(10, friendlies.length - 2) && commandStep > arriveEpsilon
          : want === 'settled'
            ? striding === 0 && friendlies.length >= 14
            : chaser !== undefined && reading.chaserRange < 4.5 && reading.chaserStep > commandStep
              && reading.chaserStep > arriveEpsilon
        if (!found) continue
        if (want === 'closing' && chaser) {
          reading.focusX = (chaser.unit.x + reading.focusX) / 2
          reading.focusY = (chaser.unit.y + reading.focusY) / 2
        }
        return reading
      }
      return null
    }
  }, { seed, arriveEpsilon })
}

function walkTo(page: Page, want: string, maxTicks: number, hold: string | null): Promise<WalkMoment> {
  return page.evaluate(
    ({ want, maxTicks, hold }) =>
      (window as unknown as { __walkShot: (w: string, m: number, h: string | null) => WalkMoment })
        .__walkShot(want, maxTicks, hold),
    { want, maxTicks, hold },
  ) as Promise<WalkMoment>
}

async function snapWalk(page: Page, name: string, moment: WalkMoment): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true })
  await page.locator('#action-shot-host canvas').screenshot({ path: `${ARTIFACTS}${name}.png` })
  if (!moment) return
  const point = await page.evaluate(
    ({ x, y }) => window.__SQUADING_TEST__!.projectGroundPoint!(x, y),
    { x: moment.focusX, y: moment.focusY },
  )
  if (!point) return
  const centreX = ((point.x + 1) / 2) * SHOT_WIDTH
  const centreY = ((1 - point.y) / 2) * SHOT_HEIGHT
  await page.screenshot({
    path: `${ARTIFACTS}${name}-detail.png`,
    clip: {
      x: Math.max(0, Math.min(SHOT_WIDTH - DETAIL_WIDTH, centreX - DETAIL_WIDTH / 2)),
      y: Math.max(0, Math.min(SHOT_HEIGHT - DETAIL_HEIGHT, centreY - DETAIL_HEIGHT / 2)),
      width: DETAIL_WIDTH,
      height: DETAIL_HEIGHT,
    },
  })
}

test('captures the squad walking, the squad settled, and a melee closing on the command unit', async ({ page }) => {
  test.setTimeout(420_000)
  await openWalkBoard(page, 'seed-a', ARRIVE_EPSILON)

  // The pair is taken off ONE board in ONE run, walking then stopped, because that is the
  // comparison the brief asks for: the same sixteen figures, a tick apart, and the only
  // difference is whether the authority is moving them. It has to be taken before contact —
  // §1.4.1 sends the fifteen out to fight the moment there is anything to fight, and a squad
  // with a leash out never comes to a full stop again.
  const walking = await walkTo(page, 'walking', 400, 'KeyD')
  expect(walking, 'the squad never had ten of its own walking at once').not.toBeNull()
  await snapWalk(page, 'shot-walk-squad', walking)
  console.log(
    `[shot] shot-walk-squad tick=${walking!.tick} striding=${walking!.striding}/${walking!.friendlies}`
    + ` commandStep=${walking!.commandStep.toFixed(4)} maxStep=${walking!.maxStep.toFixed(4)}`,
  )

  const settled = await walkTo(page, 'settled', 120, null)
  expect(settled, 'the squad never came to a full stop inside §1.4 ARRIVE_EPSILON').not.toBeNull()
  await snapWalk(page, 'shot-walk-settled', settled)
  console.log(
    `[shot] shot-walk-settled tick=${settled!.tick} striding=${settled!.striding}/${settled!.friendlies}`
    + ` maxStep=${settled!.maxStep.toFixed(5)}`,
  )

  const closing = await walkTo(page, 'closing', 1600, 'KeyA')
  expect(closing, 'no melee ever closed on the command unit while outrunning it').not.toBeNull()
  await snapWalk(page, 'shot-walk-melee-closing', closing)
  console.log(
    `[shot] shot-walk-melee-closing tick=${closing!.tick} range=${closing!.chaserRange.toFixed(2)}`
    + ` meleeStep=${closing!.chaserStep.toFixed(4)} commandStep=${closing!.commandStep.toFixed(4)}`
    + ` ratio=${(closing!.chaserStep / Math.max(1e-6, closing!.commandStep)).toFixed(2)}`,
  )

  // The pictures are only evidence if the frames they were taken from say what the captions do.
  // §1.3's `MELEE_MOVE_SPEED > COMMANDER_MOVE_SPEED` is a structural constant; this is that
  // constant caught on the board, in the frame that was shot.
  expect(closing!.chaserStep).toBeGreaterThan(closing!.commandStep)
  expect(settled!.maxStep).toBeLessThanOrEqual(ARRIVE_EPSILON)
  expect(walking!.striding).toBeGreaterThanOrEqual(10)
})
