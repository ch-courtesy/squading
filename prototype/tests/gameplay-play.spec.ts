import { expect, test, type Page } from '@playwright/test'

// Real browser playthroughs of the shipped gameplay route. Every input below is a
// real key press, key hold or pointer drag, and every expectation is read from the
// player-visible UI — this spec never touches the dev-only renderer test bridge, so
// it also runs unchanged against the production Pages build.

const POWER_UPGRADE = '화력 강화'
const SEGMENT_SECONDS = 2
const SWITCH_FATIGUE_PERCENT = 55
const MAX_SEGMENTS = 40

type Segment =
  | { readonly kind: 'key'; readonly key: 'w' | 's' }
  | { readonly kind: 'drag'; readonly toward: -1 | 1 }

// A human-shaped kiting route: back off, sweep right, drop down, sweep left. Two of
// the four legs are keyboard holds and two are pointer drags, so a single asserted
// outcome proves both input paths reach the authority simulation.
const KITE_ROUTE: readonly Segment[] = [
  { kind: 'key', key: 'w' },
  { kind: 'drag', toward: 1 },
  { kind: 'key', key: 's' },
  { kind: 'drag', toward: -1 },
]

async function startSeed47Battle(page: Page): Promise<void> {
  await page.goto('?lab=v1&seed=47')
  await page.getByRole('button', { name: '전투 시작' }).click()
  // Keyboard and pointer input only reach the simulation once the Three.js renderer
  // chunk has loaded and the controller has attached its adapter.
  await expect(page.locator('.gp-stage canvas')).toBeVisible()
}

async function chooseThePowerUpgrade(page: Page): Promise<void> {
  await page.getByRole('button', { name: POWER_UPGRADE }).click()
  await expect(page.locator('[data-upgrade]')).toBeHidden()
}

// Waits out `seconds` of *battle* time by watching the HUD clock the player sees,
// so the route stays aligned to authority ticks instead of to frame pacing. Returns
// early when the battle stops advancing because an overlay took over.
async function waitBattleSeconds(page: Page, seconds: number): Promise<void> {
  const text = await page.locator('[data-remaining]').textContent()
  const target = Number.parseFloat(text ?? '0') - seconds
  await page.waitForFunction(
    (limit) => {
      const overlayShowing = ['[data-upgrade]', '[data-terminal]', '[data-pause]']
        .some((selector) => document.querySelector(selector)?.hasAttribute('hidden') === false)
      if (overlayShowing) return true
      const remaining = document.querySelector('[data-remaining]')?.textContent ?? ''
      return Number.parseFloat(remaining) <= limit
    },
    target,
    { polling: 'raf', timeout: 60_000 },
  )
}

async function activeSquadFatiguePercent(page: Page): Promise<number> {
  const active = await page.locator('[data-active-squad]').textContent()
  const squad = active === '청록' ? 'teal' : 'scarlet'
  const status = await page.locator(`[data-squad-status="${squad}"]`).textContent()
  return Number.parseInt(/피로 (\d+)%/.exec(status ?? '')?.[1] ?? '0', 10)
}

async function switchSquadsWhenTired(page: Page): Promise<void> {
  const cooldown = await page.locator('[data-switch-cooldown]').textContent()
  if (cooldown !== '교대 가능') return
  if (await activeSquadFatiguePercent(page) < SWITCH_FATIGUE_PERCENT) return
  await page.keyboard.press('q')
}

async function playSegment(page: Page, segment: Segment): Promise<void> {
  if (segment.kind === 'key') {
    await page.keyboard.down(segment.key)
    await waitBattleSeconds(page, SEGMENT_SECONDS)
    await page.keyboard.up(segment.key)
    return
  }
  const box = (await page.locator('.gp-stage').boundingBox())!
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  await page.mouse.move(centerX, centerY)
  await page.mouse.down()
  // The authority normalises the drag vector, so a short drag along the horizontal
  // centre line is the same command as holding the matching movement key.
  await page.mouse.move(centerX + segment.toward * 200, centerY)
  await waitBattleSeconds(page, SEGMENT_SECONDS)
  await page.mouse.up()
}

test('loses seed 47 with the exact no-input result and restarts to a tick-zero HUD', async ({ page }) => {
  // Seed 47 with no movement, rescue or squad-switch input is the tactical policy
  // the 8-seed evidence records as a loss; the whole 753-tick battle runs in real time.
  test.setTimeout(180_000)
  await startSeed47Battle(page)
  await chooseThePowerUpgrade(page)

  const terminal = page.locator('[data-terminal]')
  await expect(terminal).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('[data-terminal-title]')).toHaveText('패배')
  await expect(page.locator('[data-terminal-cause]')).toHaveText('두 분대가 모두 쓰러졌습니다.')
  await expect(page.locator('[data-kills]')).toHaveText('50')
  await expect(page.locator('[data-rescues]')).toHaveText('0')
  // `all-units-lost` fires exactly when nothing is standing, so 생존 must read 0 — the
  // rest of the roster is downed, not dead, and downed soldiers are not survivors.
  await expect(page.locator('[data-survivors]')).toHaveText('0')
  await expect(page.locator('[data-choice]')).toHaveText(POWER_UPGRADE)

  await page.getByRole('button', { name: '다시 시작' }).click()
  await expect(terminal).toBeHidden()
  await expect(page.locator('[data-ready]')).toBeVisible()
  await expect(page.locator('[data-remaining]')).toHaveText('30.0초')
  await expect(page.locator('[data-xp]')).toHaveText('0 / 16')
  await expect(page.locator('[data-elite-hp]')).toHaveText('정예 대기 중')
  await expect(page.locator('[data-active-squad]')).toHaveText('주홍')
  await expect(page.locator('[data-squad-status="teal"]')).toHaveText('8명 · 피로 0%')
  await expect(page.locator('[data-squad-status="scarlet"]')).toHaveText('8명 · 피로 0%')

  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('[data-hud]')).toBeVisible()
  await expect(page.locator('[data-ready]')).toBeHidden()
})

// MEASURED FLAKY, 2026-08-23: 2 failures in 6 consecutive isolated runs (33%), always at the
// same assertion — the run reads 패배 where the test expects 승리. Five batches called this
// "intermittent" without measuring it; this is the measurement. It is a v1 test on the
// `?lab=v1` route and no v2 batch has touched it: `src/core/gameplay/` references neither
// `core/battle` nor `core/campaign`. Cause not yet diagnosed. It is not skipped, because a
// third of runs still prove the route works and skipping would hide a real regression behind
// a known one.
test('wins seed 47 by kiting with the keyboard and pointer and switching tired squads', async ({ page }) => {
  test.setTimeout(180_000)
  await startSeed47Battle(page)

  const terminal = page.locator('[data-terminal]')
  const upgrade = page.locator('[data-upgrade]')
  for (let index = 0; index < MAX_SEGMENTS; index += 1) {
    if (await terminal.isVisible()) break
    if (await upgrade.isVisible()) {
      await chooseThePowerUpgrade(page)
      continue
    }
    await switchSquadsWhenTired(page)
    await playSegment(page, KITE_ROUTE[index % KITE_ROUTE.length])
  }

  await expect(terminal).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('[data-terminal-title]')).toHaveText('승리')
  await expect(page.locator('[data-terminal-cause]')).toHaveText('정예 지휘관을 처치했습니다.')
  // No Space was ever held, so the run must report no completed rescue.
  await expect(page.locator('[data-rescues]')).toHaveText('0')
  await expect(page.locator('[data-choice]')).toHaveText(POWER_UPGRADE)
})

test('switches squads with Q and refuses a second switch until the cooldown clears', async ({ page }) => {
  test.setTimeout(60_000)
  await startSeed47Battle(page)
  const activeSquad = page.locator('[data-active-squad]')
  const cooldown = page.locator('[data-switch-cooldown]')
  await expect(activeSquad).toHaveText('주홍')
  await expect(cooldown).toHaveText('교대 가능')

  await page.keyboard.press('q')
  await expect(activeSquad).toHaveText('청록')
  await expect(cooldown).not.toHaveText('교대 가능')

  // A switch pressed during the cooldown is never queued, so once the cooldown has
  // fully drained the active squad must still be the one Q selected.
  await page.keyboard.press('q')
  await expect(cooldown).toHaveText('교대 가능', { timeout: 30_000 })
  await expect(activeSquad).toHaveText('청록')

  await page.keyboard.press('Tab')
  await expect(activeSquad).toHaveText('주홍')
})

test('locks a real rescue while Space is held and drops it when Space is released', async ({ page }) => {
  test.setTimeout(180_000)
  await startSeed47Battle(page)
  await chooseThePowerUpgrade(page)

  const rescue = page.locator('[data-rescue]')
  await expect(rescue).toHaveText('구조 대상 없음')
  await page.keyboard.down('Space')
  // The scarlet squad starts active, so its rescue window is the 45-tick one.
  await expect(rescue).toHaveText(/^#\d+ 구조 중 \d+\/45$/, { timeout: 120_000 })
  await page.keyboard.up('Space')
  await expect(rescue).toHaveText('구조 대상 없음')
})

test('never ships the dev-only renderer test bridge in a production build', async ({ page }) => {
  await page.goto('?lab=v1')
  await expect(page.locator('.gp-stage canvas')).toBeVisible()
  const servedByViteDevServer = await page.evaluate(() => Boolean(document.querySelector('script[src$="/@vite/client"]')))
  const bridgeInstalled = await page.evaluate(() => '__SQUADING_TEST__' in window)
  expect(bridgeInstalled).toBe(servedByViteDevServer)
})
