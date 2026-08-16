import { expect, test } from '@playwright/test'

test('does not expose renderer or performance controls on the default route', async ({ page }) => {
  await page.goto('')
  await expect(page.getByText('Phaser 2D')).toHaveCount(0)
  await expect(page.getByText(/FPS|드로우콜|JSON 내보내기/)).toHaveCount(0)
})

test('shows the objective, controls and start button on the default route without scrolling', async ({ page }) => {
  await page.goto('')
  await expect(page.getByText('30초 안에 정예 지휘관을 쓰러뜨리십시오.')).toBeVisible()
  await expect(page.getByText('WASD / 방향키 / 포인터 드래그')).toBeVisible()
  await expect(page.getByText('Q 또는 Tab')).toBeVisible()
  await expect(page.getByText('쓰러진 병사 곁에서 Space 유지')).toBeVisible()
  await expect(page.getByRole('button', { name: '전투 시작' })).toBeVisible()
})

test('starts the battle and shows the running HUD after clicking the start button', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('[data-hud]')).toBeVisible()
  await expect(page.locator('[data-ready]')).toBeHidden()
})
