import './app/styles.css'

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('App root not found')
}

const module = new URLSearchParams(location.search).get('lab') === 'renderers'
  ? await import('./app/app-shell')
  : await import('./app/gameplay-shell')

module.mountApp(root)
