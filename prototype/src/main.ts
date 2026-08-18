import './app/styles.css'

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('App root not found')
}

// Three routes, and only one of them is the game.
//
//   (default)         the v2 commander battle (§1, batch G) — what a player gets.
//   ?lab=renderers    the renderer comparison lab. §6 keeps this route.
//   ?lab=v1           the shipped 30-second v1 slice. `core/gameplay/` holds the v1 game and
//                     the cover 폐기 근거, and batch G does not delete either; the route stays
//                     reachable so the v1 browser gates keep running against it.
const lab = new URLSearchParams(location.search).get('lab')

const module = lab === 'renderers'
  ? await import('./app/app-shell')
  : lab === 'v1'
    ? await import('./app/gameplay-shell')
    : await import('./app/battle/battle-shell')

module.mountApp(root)
