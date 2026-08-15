import { afterEach, expect, test } from 'vitest'

import { mountApp } from '../src/app/app-shell'

afterEach(() => {
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
})

test('disables WebGL renderer choices and explains the unavailable capability', () => {
  const root = document.createElement('div')
  document.body.append(root)

  mountApp(root, { webglSupported: () => false })

  expect(root.querySelector<HTMLButtonElement>('[data-renderer="hybrid"]')?.disabled).toBe(true)
  expect(root.querySelector<HTMLButtonElement>('[data-renderer="3d"]')?.disabled).toBe(true)
  expect(root.textContent).toContain('WebGL을 사용할 수 없어')
})

test('normalizes a WebGL renderer from the URL to 2D before game start', () => {
  window.history.replaceState({}, '', '?renderer=hybrid')
  const root = document.createElement('div')
  document.body.append(root)
  const selectedKinds: string[] = []

  mountApp(root, {
    webglSupported: () => false,
    createController: ({ kind }) => {
      selectedKinds.push(kind)
      return { start: async () => undefined, dispose: () => undefined }
    },
  })

  expect(root.querySelector('[data-renderer="2d"]')?.getAttribute('aria-pressed')).toBe('true')
  root.querySelector<HTMLButtonElement>('[data-start-game]')?.click()

  expect(selectedKinds).toEqual(['2d'])
})

test('returns to renderer selection with an error boundary when renderer startup fails', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  mountApp(root, {
    webglSupported: () => true,
    createController: () => ({
      start: async () => {
        throw new Error('renderer boom')
      },
      dispose: () => undefined,
    }),
  })

  root.querySelector<HTMLButtonElement>('[data-start-game]')?.click()
  await Promise.resolve()
  await Promise.resolve()

  expect(root.querySelector('[data-renderer="2d"]')).not.toBeNull()
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('renderer boom')
})

test('does not make the frame-by-frame HUD an aria-live announcement region', () => {
  const root = document.createElement('div')
  document.body.append(root)
  mountApp(root, {
    webglSupported: () => true,
    createController: () => ({ start: async () => undefined, dispose: () => undefined }),
  })

  root.querySelector<HTMLButtonElement>('[data-start-game]')?.click()

  expect(root.querySelector('[data-hud]')?.getAttribute('aria-live')).toBeNull()
})

test('treats a throwing WebGL context probe as unavailable instead of crashing the selection screen', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = () => {
    throw new Error('context probe failed')
  }
  const root = document.createElement('div')
  document.body.append(root)

  try {
    expect(() => mountApp(root)).not.toThrow()
    expect(root.querySelector<HTMLButtonElement>('[data-renderer="hybrid"]')?.disabled).toBe(true)
  } finally {
    HTMLCanvasElement.prototype.getContext = originalGetContext
  }
})
