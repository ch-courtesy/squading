# Task 6 Report — Normal Spawn Schedule and One-Time Upgrade

## Scope

Implemented only Task 6 in the assigned vertical-slice worktree:

- 35 scheduled normal spawn events / 97 requests, 20-active-enemy cap, deterministic request IDs, one spawn angle per request, and no-reroll arena clamp.
- XP gain from normal kills and the one-time XP-16 `awaiting-upgrade` transition.
- Cards-stream-only three-card display shuffle, atomic choice validation, and one-time phase-4 multiplier application.
- No elite production/outcome/UI/renderer work.

## RED evidence

1. `cd prototype && npm test -- tests/core/gameplay-progression.test.ts`
   - Failed as intended before production code: Vite could not resolve `../../src/core/gameplay/progression`.
2. After the first implementation, the focused suite added an event idempotence regression. It failed as intended: second `spawnForTick(state, 0)` produced `wave.requested: 4`, expected `2`.

## GREEN evidence

- `cd prototype && npm test -- tests/core/gameplay-progression.test.ts tests/core/gameplay-determinism.test.ts tests/core/gameplay-combat.test.ts`
  - `3` files passed, `36` tests passed.
- `cd prototype && npm test`
  - `13` files passed, `125` tests passed.
- `cd prototype && npm run build`
  - TypeScript no-emit check and Vite production build passed. Existing Vite >500 kB chunk warning remained.
- `git diff --check`
  - Passed before the local commit.

## Self-review

- The schedule has literal hand-checked event expectations, including the tick-870 two-request tail.
- The cap advances the spawn PRNG once per request before deciding discard; IDs use request count so discard does not renumber later spawns.
- The cards stream is the only stream consumed to shuffle offers. Different cards therefore preserve spawn state/positions, while different applied choices change the authority digest.
- Choice records at zero time; `applyPendingUpgrade` is called only in phase 4 and marks the upgrade applied to make repeat calls inert.
- Normal-kill XP is recorded only on a positive-to-zero HP transition.
- Task 7 remains unimplemented. Existing phase order means tick-540 normal requests occur in phase 3 before the reserved elite phase 10 hook.

## Advisor note

An Advisor script invocation was attempted before the controller clarified the dispatch prohibition; it returned no usable JSON/result. No approval was inferred, no additional Advisor call was made, and it did not block the implementation.

## Commit

`f969418f10514d6f2c2cf1b3f8a31beb92d0b820` (superseded by the amend that records this SHA in the report).

## Concerns

- No functional concerns found. The Vite large-chunk warning pre-existed this task and is unrelated to the gameplay reducer changes.
