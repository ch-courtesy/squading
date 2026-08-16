## I9 diagnostics — the passable-low-cover artefact

A unit standing strictly inside a low-cover rectangle is blind and invisible in
every direction (§1.6: low cover blocks sight, low cover is passable, and any ray
out of the interior crosses that interior). These are the consequences.

| config | low placed | low area | free-space share inside low | bodies of 16 inside low | any body inside low |
|---|---:|---:|---:|---:|---:|
| thin/many (spec ratio band) (1.5-2, req 40) | 40.0 | 122 | 7.3% | 1.14 (7.1%) | 51.4% |
| medium (2-4, req 40) | 35.4 | 294 | 17.3% | 2.72 (17.0%) | 66.1% |
| strict-feasible best (3-5, req 40) | 24.0 | 357 | 20.7% | 3.31 (20.7%) | 63.8% |
| thick/few (5-6, req 40) | 13.4 | 401 | 23.0% | 3.76 (23.5%) | 56.6% |
