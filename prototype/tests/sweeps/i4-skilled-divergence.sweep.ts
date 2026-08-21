// Where one `skilled` seed's verdict comes apart — a MEASUREMENT TOOL, not a regression test.
//
//   I4_TRACE_POLICY=skilled I4_TRACE_SEED=seed-e \
//     npx vitest run --config vitest.sweep.config.ts tests/sweeps/i4-skilled-divergence.sweep.ts
//
// It records one tick-by-tick trace of a single (policy, seed) run and writes it to
// `I4_TRACE_OUT`. Run the same file in a tree WITHOUT §1.4.2 and diff the two traces: the first
// row that differs is where the rule reached the run, and the columns say what it moved.
//
// The trace deliberately contains the POLICY'S OWN OBSERVABLE (the command unit's position and
// the move vector it sent) next to the world state, because the question it answers is whether
// `skilled` — which does not know melee exists — changed what it did, or only what happened to it.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { policyFactory, type PolicyId } from '../../src/core/harness/policy/policies'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const OUT = process.env.I4_TRACE_OUT ?? 'artifacts/i4-trace.jsonl'
const POLICY = (process.env.I4_TRACE_POLICY ?? 'skilled') as PolicyId
const SEED = process.env.I4_TRACE_SEED ?? 'seed-e'
const STEP_BUDGET = 5400

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

describe('one run, tick by tick', () => {
  it(`traces ${POLICY} on ${SEED}`, () => {
    const battle = createBattle(SEED)
    const policy = policyFactory(POLICY)(SEED)
    battle.start()

    const rows: string[] = []
    let steps = 0
    let melee = 0

    while (battle.mode() !== 'won' && battle.mode() !== 'lost' && steps < STEP_BUDGET) {
      const before = battle.state()
      const commands = policy.decide(projectPolicyView(before))
      for (const command of commands) battle.enqueue(command)
      const result = battle.step()

      if (result.ran) {
        const state = battle.state()
        const holder = state.friendlies.find((unit) => unit.id === state.commandUnitId)
        let meleeThisTick = 0
        let friendlyDealt = 0
        let friendlyTaken = 0
        for (const applied of result.damage.applied) {
          if (applied.event.side === 'friendly') {
            friendlyDealt += applied.dealt
            if (applied.event.cause === 'friendly-melee') meleeThisTick += 1
          } else friendlyTaken += applied.dealt
        }
        melee += meleeThisTick

        rows.push(
          JSON.stringify({
            t: result.tick,
            cmd: state.commandUnitId,
            // The command unit's position, to 6 places — §1.1's digest precision.
            x: holder ? round(holder.position.x) : null,
            y: holder ? round(holder.position.y) : null,
            hp: holder ? round(holder.hp) : null,
            // What the policy actually sent this tick, so a changed DECISION is visible.
            sent: commands.map((c) =>
              c.kind === 'set-move'
                ? `mv(${round(c.move.x)},${round(c.move.y)})`
                : c.kind === 'set-rescue'
                  ? `rsc(${c.held})`
                  : c.kind,
            ),
            enemies: state.enemies.filter((enemy) => enemy.life === 'standing').length,
            standing: state.friendlies.filter((unit) => unit.life === 'standing').length,
            kills: state.stats.kills,
            mel: meleeThisTick,
            melTotal: melee,
            dealt: round(friendlyDealt),
            taken: round(friendlyTaken),
            elite:
              state.elite.enemyId === null
                ? null
                : round(
                    state.enemies.find((enemy) => enemy.id === state.elite.enemyId)?.hp ?? -1,
                  ),
            digest: battle.digest(),
          }),
        )
      }
      steps += 1
    }

    const final = battle.state()
    rows.push(
      JSON.stringify({
        t: final.combatTick,
        end: true,
        mode: final.mode,
        failureReason: final.failureReason,
        kills: final.stats.kills,
        melTotal: melee,
      }),
    )

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, `${rows.join('\n')}\n`)
    expect(rows.length).toBeGreaterThan(0)
  })
})
