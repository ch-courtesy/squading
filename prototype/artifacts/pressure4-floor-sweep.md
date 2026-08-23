# `minPressureFraction` across §2's whole box — the measurement the shipped 0.65 was chosen on

§2 gives `minPressureFraction` a search range of `0.3 ~ 0.8` and nothing narrower. This file is the
sweep over that range, kept as a compact table rather than as six 341 KB artifacts: the full JSON
for the shipped value is `pressure4-stage-band.json` and `pressure4-campaign-band.json`, and every
other row here is reproducible in about 40 seconds with one command.

Reproduce, from `prototype/`:

```
PRESSURE_FLOOR=0.7 CAMPAIGN2_STAGE_OUT=/tmp/stage-0.7.json \
  npx vitest run --config tests/sweeps/pressure/pressure-floor.config.ts \
  tests/sweeps/campaign2-stage-band.sweep.ts

PRESSURE_FLOOR=0.7 CAMPAIGN3_CAMPAIGN_OUT=/tmp/camp-0.7.json \
  npx vitest run --config tests/sweeps/pressure/pressure-floor.config.ts \
  tests/sweeps/campaign3-campaign-band.sweep.ts
```

`tests/sweeps/pressure/pressure-floor.config.ts` rewrites the one constant at import time and does
not touch `src/`; §2's `[0.3, 0.8]` assert in `constants.ts` still runs, so a floor outside the box
fails the sweep exactly as it would fail the game.

## The per-stage band, 448 runs per row, fixed eight seeds, fresh roster

| floor | `skilled` | §2.4 non-increasing | §2.4 S1 = 8/8 | §2.4 S7 < 8/8 | I3 `tactical-no-input` | I8 `flees-always` | I10 `camps-in-place` | I13 gap at S1 |
|---:|---|:--:|:--:|:--:|---|---|---|---:|
| 0.30 | `8·8·8·8·7·6·5` | ✅ | ✅ | ✅ | `2·3·3·2·2·2·0` ❌ | `7·4·5·2·2·2·1` ❌ | `3·5·3·2·3·2·0` ❌ | +2.25 ❌ |
| 0.50 | `8·8·8·8·7·6·5` | ✅ | ✅ | ✅ | `2·2·3·2·2·2·0` ❌ | `6·4·5·1·2·1·1` ❌ | `2·2·2·2·2·2·0` ✅ | +2.25 ❌ |
| **0.65** | `8·8·8·8·7·6·5` | ✅ | ✅ | ✅ | `2·2·2·1·2·2·0` ❌ | `5·3·3·1·2·0·0` ❌ | `2·2·2·2·2·2·0` ✅ | +2.25 ❌ |
| 0.70 | `7·8·8·8·7·6·5` | ❌ | ❌ | ✅ | `2·2·2·1·2·2·0` ❌ | `3·3·3·1·2·0·0` ❌ | `2·2·2·2·2·1·0` ✅ | +2.25 ❌ |
| 0.75 | `7·8·8·8·7·6·5` | ❌ | ❌ | ✅ | `2·1·2·1·2·2·0` ❌ | `2·3·2·1·2·0·0` ❌ | `2·2·2·2·2·1·0` ✅ | +2.38 ❌ |
| 0.80 | `7·8·8·8·7·6·5` | ❌ | ❌ | ✅ | `2·1·2·1·2·2·0` ❌ | `3·2·2·1·1·0·1` ❌ | `2·2·2·2·2·1·0` ✅ | +2.38 ❌ |

Gates: I3 requires `0/8` on every stage, I8 requires `0/8`, I10 requires `≤ 2/8`, I13 requires a
gap of `≥ 3` bodies standing at the end of stage 1 (`skilled` minus `abandons-downed`).

## The campaign band, 64 campaigns per row

`skilled` completions out of 8. §4's target is `1~6`.

| floor | 0.30 | 0.50 | 0.65 | 0.80 |
|---|---:|---:|---:|---:|
| `skilled` completes | 3/8 | 2/8 | **2/8** | 2/8 |
| `skilled` mean stages cleared | 4.13 | 3.63 | 3.50 | 3.13 |
| `tactical-no-input` completes | 0/8 | 0/8 | 0/8 | 0/8 |

**Every floor in §2's box puts the campaign band inside the target.** The band is not what
separates the box; §2.4 and I10 are.

## What the table decides

* **0.7, 0.75 and 0.8 are out on §2.4.** All three break the same way — stage 1 falls to 7/8, so
  the row opens `7 · 8`, which is an increase, and "`skilled` wins stage 1 8/8" fails with it.
* **0.3 is out on I10.** `camps-in-place` reaches 3, 5 and 3 wins on stages 1, 2 and 3 against a
  gate of 2.
* **0.5 and 0.65 both clear those two, and 0.65 is taken because it is the larger** — the weakest
  scaling that clears them. §1.10.1's named hazard is scaling that is too strong, so where the
  measurement cannot separate two points the tie goes to the one nearer the absolute cap this rule
  replaced. It is also the better of the two on the invariants the rule damages: `flees-always` is
  `5·3·3·1·2·0·0` at 0.65 against `6·4·5·1·2·1·1` at 0.5, and `tactical-no-input` is `2·2·2·1·2·2·0`
  against `2·2·3·2·2·2·0`.

## What the table does NOT decide, said here because it is the first thing a reader will ask

**No floor in §2's box makes I3 or I8 hold, and no floor makes I13 reach 3.** Those are properties
of the rule at these stage values, not of the floor: the spread across the whole box is 10 to 14
`flees-always` wins out of 56 and 10 to 12 `tactical-no-input` wins out of 56, against a gate of 0
for both. Choosing inside the box picks the least bad point on a range that has no good one.
`pressure-scaling-report.md` §5 is where that is argued.
