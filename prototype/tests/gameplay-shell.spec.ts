import { expect, test } from '@playwright/test'

test('does not expose renderer or performance controls on the default route', async ({ page }) => {
  await page.goto('')
  await expect(page.getByText('Phaser 2D')).toHaveCount(0)
  await expect(page.getByText(/FPS|드로우콜|JSON 내보내기/)).toHaveCount(0)
  // The design spec explicitly hides seed/enemy-count info from normal play.
  await expect(page.getByText('시드')).toHaveCount(0)
  await expect(page.getByText('적 수')).toHaveCount(0)
})

test('shows the objective, controls and start button on the default route without scrolling', async ({ page }) => {
  await page.goto('')
  await expect(page.getByText('30초 안에 정예 지휘관을 쓰러뜨리십시오.')).toBeVisible()
  await expect(page.getByText('WASD / 방향키 / 포인터 드래그')).toBeVisible()
  await expect(page.getByText('Q 또는 Tab')).toBeVisible()
  await expect(page.getByText('쓰러진 병사 곁에서 Space 유지')).toBeVisible()
  const startButton = page.getByRole('button', { name: '전투 시작' })
  await expect(startButton).toBeVisible()

  // "without scrolling" means contained in the viewport at a normal desktop
  // size, not merely a non-empty bounding box (toBeVisible() alone would pass
  // even if the button were pushed off-screen by a centered-but-clipped flex column).
  const box = await startButton.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (box && viewport) {
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  }
})

test('keeps the start button reachable by scrolling on a short viewport instead of clipping it', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 })
  await page.goto('')
  const startButton = page.getByRole('button', { name: '전투 시작' })
  // Regression guard: with `overflow: hidden` on the shell and a centered flex
  // column with no `overflow-y` of its own, this content overflows a 360px-tall
  // viewport and the button is clipped out of reach with no scrollbar to recover it.
  await startButton.scrollIntoViewIfNeeded()
  await expect(startButton).toBeInViewport()
  await startButton.click()
  await expect(page.locator('[data-hud]')).toBeVisible()
})

test('starts the battle and shows the running HUD after clicking the start button', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('[data-hud]')).toBeVisible()
  await expect(page.locator('[data-ready]')).toBeHidden()
})

test('focuses the start button so Enter/Space can begin the battle without a mouse', async ({ page }) => {
  await page.goto('')
  await expect(page.locator('[data-begin-battle]')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-hud]')).toBeVisible()
})

test('shows the pause overlay under real CSS, not just an unrendered hidden attribute', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('[data-hud]')).toBeVisible()
  // Escape is handled by the keyboard input adapter, which only attaches once
  // the Three.js renderer has finished loading and mounting — wait for its
  // canvas so the keypress below isn't a race against that async load.
  await expect(page.locator('.gp-stage canvas')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-pause]')).toBeVisible()
  await expect(page.locator('[data-pause]')).toHaveAttribute('role', 'dialog')
})

test('the upgrade and terminal overlays actually render once unhidden, guarding against a repeat of the [hidden] display-override bug', async ({ page }) => {
  // Reaching `awaiting-upgrade` or `won`/`lost` through real play takes up to
  // 30s of real-time ticks with no production fast-forward hook. This exercises
  // the exact regression class that was self-caught during Task 10 review — an
  // author-level `display` rule silently beating the UA `[hidden]` rule — by
  // toggling the real attribute under real Chromium layout, independent of
  // game-state plumbing.
  await page.goto('')

  const upgrade = page.locator('[data-upgrade]')
  await expect(upgrade).toBeHidden()
  await page.evaluate(() => document.querySelector('[data-upgrade]')?.removeAttribute('hidden'))
  await expect(upgrade).toBeVisible()
  await page.evaluate(() => document.querySelector('[data-upgrade]')?.setAttribute('hidden', ''))
  await expect(upgrade).toBeHidden()

  const terminal = page.locator('[data-terminal]')
  await expect(terminal).toBeHidden()
  await page.evaluate(() => document.querySelector('[data-terminal]')?.removeAttribute('hidden'))
  await expect(terminal).toBeVisible()
  await page.evaluate(() => document.querySelector('[data-terminal]')?.setAttribute('hidden', ''))
  await expect(terminal).toBeHidden()
})

test('shows a player-visible alert when the renderer fails to load', async ({ page }) => {
  await page.route('**/src/renderers/three-hybrid/**', (route) => route.abort())
  await page.goto('')
  await expect(page.getByRole('alert')).toBeVisible()
})
