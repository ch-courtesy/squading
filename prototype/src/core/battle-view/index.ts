// `core/battle-view/` — the display-only projection of a commander battle (§6, batch G).
//
// It sits BESIDE `core/battle/`, never inside it, and the dependency runs one way: this
// module imports the core, and nothing under `core/battle/` imports this. That is the same
// shape batch F used for `core/harness/policy/view.ts`, and for the same reason — the core
// declares itself display-agnostic (`battle.ts`) and a camera in there would be a display
// decision inside the object §1.17's digest walks.
//
// Two projections, because they answer two different questions:
//
//   `projectBattleSnapshot`  what the diorama renderer draws — bodies, effects and §4.4's
//                            camera rectangle, in `core/types.ts`'s shared `RenderSnapshot`.
//   `projectBattleHud`       what the shell prints — §1.1's clock, §1.13's cards, §1.11's
//                            rescue, §1.14's result screen.
//
// Neither writes. The shell and the renderer get these and §1.15's public commands, and
// nothing else; `tests/battle/battle-no-cover.test.ts` watches this directory along with the
// core, so the archived cover modules cannot come back through the display side either.

export * from './hud'
export * from './snapshot'
