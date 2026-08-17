## I9 diagnostics — units standing inside passable low cover

Low cover blocks sight and is passable (§1.6), so bodies end up standing inside it.
§1.6's endpoint exemption means such a body is NOT blind: the rectangle it stands in
does not block its own segments, so it shoots over its sandbags and is visible in
return. This table counts how often that happens — i.e. how much of the roster gets
the exemption. (Before the exemption was added to the spec, these same positions
were blind and untargetable, which is the artefact the stage-1 report measured at
65% of blocked samples.)

| config | low placed | low area | free-space share inside low | bodies of 16 inside low | any body inside low |
|---|---:|---:|---:|---:|---:|
| thin/many (spec ratio band) (1.5-2, req 40) | 40.0 | 122 | 7.3% | 1.14 (7.1%) | 51.4% |
| medium (2-4, req 40) | 35.4 | 294 | 17.3% | 2.72 (17.0%) | 66.1% |
| strict-feasible best (3-5, req 40) | 24.0 | 357 | 20.7% | 3.31 (20.7%) | 63.8% |
| thick/few (5-6, req 40) | 13.4 | 401 | 23.0% | 3.76 (23.5%) | 56.6% |
