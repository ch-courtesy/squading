import { appendFileSync } from 'node:fs'
import { it } from 'vitest'
import { createBattle } from '../src/core/battle/battle'
const SCRIPT: Array<[number, (b: ReturnType<typeof createBattle>) => void]> = [
  [0, b => b.keyDown('KeyD')], [300, b => b.keyUp('KeyD')], [310, b => b.keyDown('KeyS')],
  [440, b => b.keyUp('KeyS')], [450, b => b.keyDown('KeyA')], [750, b => b.keyUp('KeyA')],
  [760, b => b.keyDown('KeyW')], [890, b => b.keyUp('KeyW')], [900, b => b.keyDown('KeyD')],
  [1200, b => b.keyUp('KeyD')], [1210, b => b.keyDown('KeyS')], [1340, b => b.keyUp('KeyS')],
  [1350, b => b.keyDown('KeyA')], [1650, b => b.keyUp('KeyA')], [1660, b => b.keyDown('KeyW')],
  [1790, b => b.keyUp('KeyW')], [1800, b => b.keyDown('KeyD')], [2100, b => b.keyUp('KeyD')],
]
it('h', () => {
  const seeds = ['seed-a','seed-b','seed-c','seed-d','seed-e','seed-f','seed-g','seed-h']
  let won = 0; const rows: string[] = []
  for (const seed of seeds) {
    const b = createBattle(seed); b.start()
    const by = new Map(SCRIPT); let steps = 0
    while (b.mode() === 'running' || b.mode() === 'paused' || b.mode() === 'awaiting-upgrade') {
      if (steps > 6000) break
      by.get(steps)?.(b)
      if (b.mode() === 'awaiting-upgrade') b.enqueue({ kind: 'choose-upgrade', slot: 1 })
      b.step(); steps += 1
    }
    const st = b.state()
    if (st.result === 'won') won += 1
    rows.push(`${seed}:${st.result}@${st.combatTick}`)
  }
  appendFileSync('/tmp/h.txt', `kite-route wins=${won}/8  ${rows.join(' ')}\n`)
}, 900000)
