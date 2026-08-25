import { expect, test } from '@playwright/test'

test('shows the renderer comparison choices', async ({ page }) => {
  await page.goto('?lab=renderers')

  await expect(
    page.getByRole('heading', { name: '테이블탑 렌더러 비교', level: 1 }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Phaser 2D' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Three.js 2.5D' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Three.js 3D' })).toBeVisible()
})

test('shows reproducible settings and controls', async ({ page }) => {
  await page.goto('?lab=renderers')

  await expect(page.getByLabel('적 수')).toHaveValue('100')
  await expect(page.getByLabel('시드')).toHaveValue('tabletop-001')
  await expect(page.getByText('이동: WASD 또는 방향키')).toBeVisible()
  await expect(page.getByText('분대 전환: Tab')).toBeVisible()
})

test('recovers safe defaults from invalid URL parameters', async ({ page }) => {
  await page.goto('?lab=renderers&renderer=unknown&enemies=999&seed=')

  await expect(page.getByRole('button', { name: 'Phaser 2D' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('적 수')).toHaveValue('100')
  await expect(page.getByLabel('시드')).toHaveValue('tabletop-001')
})

test('loads valid URL settings and updates renderer selection', async ({ page }) => {
  await page.goto('?lab=renderers&renderer=hybrid&enemies=300&seed=fixed-seed')

  const hybrid = page.getByRole('button', { name: 'Three.js 2.5D' })
  await expect(hybrid).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('적 수')).toHaveValue('300')
  await expect(page.getByLabel('시드')).toHaveValue('fixed-seed')

  await page.getByRole('button', { name: 'Three.js 3D' }).click()
  await expect(page.getByRole('button', { name: 'Three.js 3D' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(hybrid).toHaveAttribute('aria-pressed', 'false')
})

test('escapes and limits URL seed text', async ({ page }) => {
  const payload = '<img src=x onerror=window.__seedXss=true>' + 'x'.repeat(100)
  await page.goto(`?lab=renderers&seed=${encodeURIComponent(payload)}`)

  await expect(page.getByLabel('시드')).toHaveValue(payload.slice(0, 64))
  await expect(page.locator('img')).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.get(window, '__seedXss'))).toBeUndefined()
})

test('names the game on the screen the player starts from', async ({ page }) => {
  // The start screen carried a label over a description — "SQUAD SURVIVOR" small, the mode name
  // large — which is a screen with no name on it. Both the heading and the tab say Squading now,
  // and the tab matters as much: it is the name on a bookmark and on a shared link.
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Squading')
  await expect(page).toHaveTitle(/Squading/)
  // The description survived, under the name rather than over it.
  await expect(page.locator('.bt-ready .bt-eyebrow')).toHaveText('90초 지휘관 전투')
})
