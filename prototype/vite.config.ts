import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
  const repositoryName = process.env.GITHUB_REPOSITORY?.split('/').at(-1) ?? 'squading'
  const pagesBase = repositoryName.endsWith('.github.io') ? '/' : `/${repositoryName}/`

  return {
    base: process.env.VITE_BASE_PATH ?? (command === 'build' ? pagesBase : '/'),
    server: {
      port: 4173,
      strictPort: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  }
})
