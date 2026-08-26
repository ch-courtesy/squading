import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 1280x720 at dpr 1 keeps the recorded video that exact size.
test.use({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  video: { mode: 'on', size: { width: 1280, height: 720 } },
})

const hold = async (page: import('@playwright/test').Page, code: string, ms: number) => {
  await page.keyboard.down(code)
  await page.waitForTimeout(ms)
  await page.keyboard.up(code)
}

test('demo', async ({ page }) => {
  test.setTimeout(300_000)
  mkdirSync('artifacts', { recursive: true })
  await page.goto('/?seed=demo-a')

  // Title screen, so the video opens on the name.
  await page.waitForTimeout(2200)
  await page.screenshot({ path: 'artifacts/thumb-title.png' })

  await page.getByRole('button', { name: '전투 시작' }).click()
  // THE HUD, not the canvas. The canvas exists on the ready screen too — the renderer mounts
  // before the battle starts — so asserting on it recorded two minutes of a title card once.
  await expect(page.locator('[data-battle-hud]')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'artifacts/thumb-open.png' })

  // A kiting circuit: push in, cut across, come back. Holding an axis into the fight is what the
  // charge and the dodge are gated on, so this is the play the game is about.
  for (let lap = 0; lap < 6; lap += 1) {
    await hold(page, 'KeyD', 2600)
    await hold(page, 'KeyS', 1200)
    await hold(page, 'KeyA', 2600)
    await hold(page, 'KeyW', 1200)
    // Cards land mid-fight; answer them so the run keeps going.
    if (await page.locator('[data-battle-upgrade]').isVisible().catch(() => false)) {
      await page.keyboard.press('Digit1')
      await page.waitForTimeout(400)
    }
    if (lap === 1) await page.screenshot({ path: 'artifacts/thumb-fight.png' })
    if (await page.locator('[data-battle-terminal]').isVisible().catch(() => false)) break
    if (await page.locator('[data-campaign-transition]').isVisible().catch(() => false)) break
  }
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'artifacts/thumb-end.png' })
})
