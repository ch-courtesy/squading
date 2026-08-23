# `minPressureFraction` across §2's whole `0.3 ~ 0.8` box — under the ENTERING denominator

Produced by `tests/sweeps/pressure/pressure-floor.config.ts`, which rewrites
`MIN_PRESSURE_FRACTION` at import time. `src/` is not edited and §2's `[0.3, 0.8]` assert still
runs, so a floor outside the box fails here exactly as it would in the game.

```
PRESSURE_FLOOR=<f> CAMPAIGN2_STAGE_OUT=<out> npx vitest run \
  --config tests/sweeps/pressure/pressure-floor.config.ts tests/sweeps/campaign2-stage-band.sweep.ts
PRESSURE_FLOOR=<f> CAMPAIGN3_CAMPAIGN_OUT=<out> npx vitest run \
  --config tests/sweeps/pressure/pressure-floor.config.ts tests/sweeps/campaign3-campaign-band.sweep.ts
PRESSURE_FLOOR=<f> PRESSURE_ENTRY_OUT=<out> npx vitest run \
  --config tests/sweeps/pressure/pressure-floor.config.ts tests/sweeps/pressure/entry-cost.sweep.ts
```

---

## 1. The per-stage band cannot see the floor at all

All six floors were played on the full 448-run per-stage band. **Every one of the 448 rows is
identical in every field** (`digest`, `outcome`, `endTick`, `kills`, `standing`, `downed`, `dead`,
`rosterHp`, `damageTaken`, `damageTakenByWindow`, `damageDealt`, `longestIdleRun`, `meanEngaged`,
the four arena bounds, `clampedTicks`, both elite ticks) at every floor:

| floor | rows differing from the 0.65 band |
|---:|---:|
| 0.30 | 0 / 448 |
| 0.50 | 0 / 448 |
| 0.65 | — (the reference) |
| 0.70 | 0 / 448 |
| 0.75 | 0 / 448 |
| 0.80 | 0 / 448 |

The reason is structural: every run of that band is `createBattle(seed, { stageId })`, a fresh
sixteen, so `enteringStanding / ROSTER_SIZE` is `1` and the floor multiplies nothing. So §2.4's
three checks, I1, I2, I3, I8, I10 and I13 are the SAME NUMBER at every point of §2's box, and the
argument that selected `0.65` in the previous batch — that 0.7 and above broke §2.4 — cannot be
made under this denominator.

The whole 448-run band is also identical to `artifacts/campaign2-stage-band.json`, which is the
pre-§1.10.1 record.

---

## 2. The campaign band — 64 campaigns per floor

| floor | `skilled` 완주 | `skilled` cleared per seed | campaigns reaching S1..S7 (of 64) |
|---:|---:|---|---|
| 0.30 | **2/8** | `1,7,1,2,2,6,1,7` | 64 / 29 / 22 / 20 / 18 / 16 / 14 |
| 0.50 | 1/8 | `1,6,1,1,2,6,1,7` | 64 / 29 / 20 / 18 / 16 / 14 / 13 |
| **0.65** | **1/8** | `1,6,1,1,2,6,1,7` | 64 / 29 / 20 / 17 / 16 / 14 / 13 |
| 0.70 | 1/8 | `1,6,1,1,1,6,1,7` | 64 / 29 / 19 / 17 / 15 / 14 / 11 |
| 0.75 | 1/8 | `1,6,1,1,1,6,1,7` | 64 / 29 / 16 / 15 / 14 / 13 / 10 |
| 0.80 | **2/8** | `1,5,1,1,1,7,1,7` | 64 / 29 / 18 / 15 / 14 / 13 / 8 |

Every point is inside §4's `1~6` target. The spread is ONE campaign, which is not a separation.
`tactical-no-input`, `flees-always` and `camps-in-place` complete `0/8` at every floor.

The reach column is the rule's own purpose (§1.10.1: the relay's exponential decay breaks) and it
falls monotonically as the floor rises — `14 / 13 / 13 / 11 / 10 / 8` at stage 7, against `3` with
no scaling at all (`artifacts/campaign3-campaign-band.json`).

---

## 3. `entry-cost.sweep.ts` — the clause the floor exists for

`skilled`, seven stages × eight fixed seeds, played by squads that walked in at each size. Wins out
of 56 per row.

| entering | 0.30 | 0.50 | **0.65** | 0.70 | 0.75 | 0.80 |
|---:|---:|---:|---:|---:|---:|---:|
| 16 | 45 | 45 | **45** | 45 | 45 | 45 |
| 14 | 45 | 45 | **45** | 45 | 45 | 45 |
| 12 | 31 | 31 | **31** | 31 | 31 | 21 |
| 10 | 28 | 28 | **23** | 18 | 11 | 9 |
|  8 | 20 | 20 | **5** | 3 | 1 | 0 |
|  6 | 14 | 4 | **0** | 1 | 0 | 0 |
|  4 | 9 | 1 | **0** | 1 | 0 | 0 |
|  2 | 0 | 0 | **0** | 0 | 0 | 0 |

Damage taken per entering body, all 56 runs of a row, at the shipped floor: `1.417 / 1.506 / 1.676
/ 1.754 / 2.373 / 2.929 / 3.104 / 3.683`.

**§1.10.1's clause holds at every floor in the box**: wins fall and damage per entering body rises
as the entering squad shrinks. Arriving short is always a cost, everywhere in `0.3 ~ 0.8`. Nothing
here excludes a point either.

Rows above a floor's knee (`16 × floor`) are exactly proportional and therefore identical between
floors — 16, 14 and 12 agree at every floor up to 0.75, and 12 moves only at 0.80 where the knee
passes it. That is the floor being a floor, visible as a column.

---

## 4. What was chosen, and it is not a measurement

`MIN_PRESSURE_FRACTION` stays at `0.65`. **No gate separates the box**: the per-stage band cannot
see the floor, the campaign band is inside the target at all six points with a one-campaign spread,
and the entry-cost clause holds at all six. The box's two ends are two clauses trading off
monotonically with no kink — a smaller floor removes more of the relay's decay, a larger one makes
arriving short cost more — so the choice is unforced by measurement. Moving a placeholder toward a
one-campaign difference would be tuning against noise. §5 stage 4 owns the balance.
