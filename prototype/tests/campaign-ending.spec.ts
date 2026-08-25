// The ending, on a real page with the real stylesheet.
//
// `tests/app/battle-shell.test.ts` asserts the DOM in jsdom, which is where the LOGIC belongs —
// which screen, which fields, which names. What jsdom cannot answer is whether the thing is
// legible: jsdom has no layout, no cascade and no animation, so a screen that renders as a column
// of unstyled text passes every assertion there.
//
// This mounts the same shell in Chromium against a stub controller in the campaign's finished
// state, screenshots it, and asserts the two properties a jsdom test structurally cannot: that the
// staged reveal ENDS (nothing is left invisible) and that the panel is the size of a screen rather
// than of a dialog.

import { mkdirSync } from 'node:fs'

import { expect, test } from '@playwright/test'

const ARTIFACTS = 'artifacts/'

test('reveals a legible ending, and finishes revealing it', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/?lab=renderers')
  await page.waitForTimeout(300)

  await page.evaluate(async () => {
    const shell = await (0, eval)('import("/src/app/battle/battle-shell.ts")')
    const hudModule = await (0, eval)('import("/src/core/battle-view/hud.ts")')
    const campaignModule = await (0, eval)('import("/src/core/campaign/state.ts")')
    const battleModule = await (0, eval)('import("/src/core/battle/state.ts")')
    const campaignHudModule = await (0, eval)('import("/src/core/campaign-view/hud.ts")')

    const battle = battleModule.createInitialBattleState('ending-shot')
    battle.mode = 'won'
    battle.result = 'won'
    battle.stats.kills = 214
    const hud = hudModule.projectBattleHud(battle)

    const base = campaignModule.createCampaignState('ending-shot')
    const campaignState = {
      ...base,
      phase: 'campaign-over',
      end: 'complete',
      stageId: 7,
      kills: 1462,
      cardLevels: { ...base.cardLevels, firepower: 3, vitality: 2, rapid: 3, cohesion: 1 },
      squad: {
        commandUnitId: 5,
        members: [2, 5, 7, 11, 14].map((id, index) => ({
          id,
          role: 'soldier',
          nameIndex: index * 3,
          hp: 1.4,
          maxHp: 1.4,
        })),
      },
      fallen: [
        { id: 3, nameIndex: 1, stageId: 2 },
        { id: 9, nameIndex: 4, stageId: 4 },
        { id: 12, nameIndex: 8, stageId: 6 },
        { id: 15, nameIndex: 13, stageId: 7 },
      ],
    }
    const campaign = campaignHudModule.projectCampaignHud(campaignState)

    // A controller that answers the four questions the shell asks and does nothing else. The shell
    // is what is under test; the controller is scenery.
    const noop = () => {}
    const controller = {
      start: async () => {},
      audio: () => ({
        resume: async () => {},
        playFrame: noop,
        cue: noop,
        stopMusic: noop,
        enabled: () => true,
        setEnabled: (next: boolean) => next,
        dispose: noop,
      }),
      begin: noop,
      restart: noop,
      advanceStage: noop,
      subscribe: () => () => {},
      hud: () => hud,
      campaign: () => campaign,
      snapshot: () => ({
        tick: 0,
        elapsedMs: 0,
        units: [],
        projectiles: [],
        effects: [],
        camera: { centerX: 0, centerY: 0, worldWidth: 56, worldHeight: 32 },
      }),
      seed: () => 'ending-shot',
      digest: () => '0',
      keyDown: noop,
      keyUp: noop,
      pointerDrag: noop,
      pointerRelease: noop,
      chooseUpgrade: noop,
      togglePause: noop,
      inputLog: () => [],
      stepCount: () => 0,
      frameSamples: () => [],
      dispose: noop,
    }

    document.body.innerHTML = '<div id="ending-host" style="position:fixed;inset:0"></div>'
    shell.mountApp(document.querySelector('#ending-host')!, {
      createController: () => controller,
    })
  })

  const ending = page.locator('[data-campaign-ending]')
  await expect(ending).toBeVisible()

  // The reveal is staged, so the assertions wait for it to FINISH. A screen that animates in and
  // leaves a step at zero opacity is the failure this catches, and it is invisible to jsdom.
  await expect.poll(
    async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.bt-ending-step')).every(
          (node) => Number(getComputedStyle(node).opacity) > 0.95,
        ),
      ),
    { timeout: 15_000 },
  ).toBe(true)

  // Seven marks, laid out in a row rather than stacked — the shape of the run.
  const marks = ending.locator('[data-campaign-ending-stages] li')
  await expect(marks).toHaveCount(7)
  const first = await marks.first().boundingBox()
  const last = await marks.last().boundingBox()
  expect(first!.y).toBeCloseTo(last!.y, 0)
  expect(last!.x).toBeGreaterThan(first!.x)

  // It reads as a screen, not as a dialog box.
  const box = await ending.boundingBox()
  const viewport = page.viewportSize()!
  expect(box!.width).toBeGreaterThan(viewport.width * 0.9)
  expect(box!.height).toBeGreaterThan(viewport.height * 0.9)

  // The last step is the only thing on this screen the player can DO. An ending whose button is
  // below the fold ends with a scrollbar, so its position is asserted rather than eyeballed.
  const restart = ending.locator('[data-campaign-ending-restart]')
  const restartBox = await restart.boundingBox()
  expect(restartBox!.y + restartBox!.height).toBeLessThanOrEqual(viewport.height)

  mkdirSync(ARTIFACTS, { recursive: true })
  await page.screenshot({ path: `${ARTIFACTS}shot-ending.png` })
})
