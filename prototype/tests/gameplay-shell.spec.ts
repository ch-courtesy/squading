import { expect, test } from '@playwright/test'

test('does not expose renderer or performance controls on the default route', async ({ page }) => {
  await page.goto('')
  await expect(page.getByText('Phaser 2D')).toHaveCount(0)
  await expect(page.getByText(/FPS|드로우콜|JSON 내보내기/)).toHaveCount(0)
  // The design spec explicitly hides seed/enemy-count info from normal play.
  await expect(page.getByText('시드')).toHaveCount(0)
  await expect(page.getByText('적 수')).toHaveCount(0)
})

test('never requests a Phaser or Three-3D module on the default route', async ({ page }) => {
  // The lab renderers are reachable only through the dynamic imports in registry.ts,
  // which the default route never calls — but that is a static-analysis conclusion.
  // This turns it into a regression guard at the request level, so a stray static import
  // (or a re-added eager preload) fails here instead of silently shipping the lab
  // renderer bytes to every player. Matches the dev server's `/src/renderers/phaser-2d/*.ts`
  // and `/src/renderers/three-3d/*.ts` modules, the pre-bundled `deps/phaser.js`, and the
  // built `assets/phaser-*.js` / `assets/three-3d-*.js` chunks alike.
  const labRequests: string[] = []
  page.on('request', (request) => {
    if (/phaser|three-3d/i.test(request.url())) labRequests.push(request.url())
  })

  await page.goto('')
  // The gameplay renderer resolves through the same registry module, so waiting for its
  // canvas proves the dynamic-import path really ran before this assertion is made.
  await expect(page.locator('.gp-stage canvas')).toBeVisible()
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('[data-hud]')).toBeVisible()

  expect(labRequests).toEqual([])
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
  // The shell re-asserts `hidden` from game state on every rendered frame, so the
  // with/without comparison has to happen inside one synchronous task rather than
  // across separate Playwright round trips that the render loop can interleave with.
  await page.goto('')

  const upgrade = page.locator('[data-upgrade]')
  const terminal = page.locator('[data-terminal]')
  await expect(upgrade).toBeHidden()
  await expect(terminal).toBeHidden()

  const rendering = await page.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!
      const hiddenDisplay = getComputedStyle(element).display
      element.removeAttribute('hidden')
      const style = getComputedStyle(element)
      const shown = { display: style.display, visibility: style.visibility, height: element.getBoundingClientRect().height }
      element.setAttribute('hidden', '')
      return { hiddenDisplay, shown }
    }
    return { upgrade: measure('[data-upgrade]'), terminal: measure('[data-terminal]') }
  })

  for (const overlay of [rendering.upgrade, rendering.terminal]) {
    expect(overlay.hiddenDisplay).toBe('none')
    expect(overlay.shown.display).not.toBe('none')
    expect(overlay.shown.visibility).toBe('visible')
    expect(overlay.shown.height).toBeGreaterThan(0)
  }

  await expect(upgrade).toBeHidden()
  await expect(terminal).toBeHidden()
})

test('shows a player-visible alert when the renderer fails to load', async ({ page }) => {
  // Matched as a regular expression so this covers the dev server's
  // `/src/renderers/three-hybrid/*.ts` modules and the built `assets/three-hybrid-*.js`
  // chunk alike — the production Pages artifact has to fail visibly too.
  await page.route(/three-hybrid/, (route) => route.abort())
  await page.goto('')
  await expect(page.getByRole('alert')).toBeVisible()
})
