# Campaign stage 0 — run outcome comparison, `b59b14a` against this tree

Produced by `tests/sweeps/campaign0-outcomes.sweep.ts`, run once on a `git archive b59b14a`
tree and once here, with `CAMPAIGN0_OUT` pointing at two files. Eight policies x 32 seeds.

Compared per run: `outcome`, `endTick`, `kills`, `standing`, the whole ordered
`damageEvents` stream (folded to one FNV-1a hash over `tick|side|attackerId|targetId|amount|cause`
per row, with the row count and the per-cause blow/total tallies beside it), every §1.13 upgrade
round (tick, offered, chosen), §1.12's arrival tick and the elite's death tick.

**256/256 runs identical on every one of those. 256/256 digests moved.** That pair is the whole
claim of this batch: the state gained `stageId`, so no recorded digest survives; nothing else moved.

| policy | runs | outcomes identical | damageEvents compared | digests moved |
|---|---|---|---|---|
| `tactical-no-input` | 32 | **32/32** | 75,806 | 32/32 |
| `flees-always` | 32 | **32/32** | 78,807 | 32/32 |
| `camps-in-place` | 32 | **32/32** | 76,150 | 32/32 |
| `skilled` | 32 | **32/32** | 85,562 | 32/32 |
| `ignores-range` | 32 | **32/32** | 84,612 | 32/32 |
| `abandons-downed` | 32 | **32/32** | 84,093 | 32/32 |
| `skilled-conservative` | 32 | **32/32** | 84,293 | 32/32 |
| `skilled-aggressive` | 32 | **32/32** | 84,556 | 32/32 |
| **total** | **256** | **256/256** | **653,879** | **256/256** |

## Every run, side by side

`endTick`/`kills`/`standing`/`damageEventCount`/`damageEventsHash` are the BEFORE values; the
AFTER values are equal to them in every row, which is what `same` records. Only `digest` differs,
and it differs in every row.

| policy | seed | outcome | endTick | kills | standing | dmgEvents | dmgHash | elite in/out | rounds | same | digest before -> after |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tactical-no-input` | seed-a | lost | 1653 | 159 | 0 | 2031 | `ad43525f` | —/— | 202,490,867,1358 | yes | `8f30c06d` -> `5b574345` |
| `tactical-no-input` | seed-b | lost | 2190 | 228 | 0 | 3235 | `e276f40f` | 1800/— | 193,444,889,1357 | yes | `91fc34fe` -> `8cc08e76` |
| `tactical-no-input` | seed-c | lost | 1719 | 170 | 0 | 2131 | `cf116143` | —/— | 210,498,887,1351 | yes | `334b1763` -> `12b22be3` |
| `tactical-no-input` | seed-d | lost | 1763 | 170 | 0 | 2202 | `a059a55d` | —/— | 205,465,867,1315 | yes | `5cc58a0b` -> `173132d7` |
| `tactical-no-input` | seed-e | lost | 1767 | 166 | 0 | 2192 | `66974389` | —/— | 194,482,882,1374 | yes | `377ea853` -> `73330463` |
| `tactical-no-input` | seed-f | lost | 1780 | 170 | 0 | 2301 | `7071fcf9` | —/— | 217,489,883,1357 | yes | `36e1b0aa` -> `9470a06a` |
| `tactical-no-input` | seed-g | lost | 1693 | 148 | 0 | 2204 | `f30e4087` | —/— | 188,445,907,1552 | yes | `87b819cc` -> `0ac4fb6c` |
| `tactical-no-input` | seed-h | lost | 2013 | 209 | 0 | 2284 | `736ddbc9` | 1800/— | 214,466,874,1288 | yes | `23b7ad41` -> `1a839ab1` |
| `tactical-no-input` | seed-8 | lost | 1708 | 165 | 0 | 2208 | `aab360b7` | —/— | 215,501,885,1393 | yes | `b8d034e3` -> `8deb1977` |
| `tactical-no-input` | seed-9 | lost | 1906 | 190 | 0 | 2460 | `852a707b` | 1800/— | 185,468,875,1341 | yes | `c20809bf` -> `04841ea7` |
| `tactical-no-input` | seed-10 | lost | 1823 | 177 | 0 | 2054 | `aea51f59` | 1800/— | 209,488,889,1337 | yes | `acfda0ee` -> `e782f472` |
| `tactical-no-input` | seed-11 | lost | 1796 | 170 | 0 | 2358 | `e9c17b88` | —/— | 182,491,870,1386 | yes | `06dd56af` -> `d0e605cf` |
| `tactical-no-input` | seed-12 | won | 1961 | 234 | 14 | 2130 | `33807f91` | 1800/1960 | 210,456,851,1249 | yes | `274de2e7` -> `741d7063` |
| `tactical-no-input` | seed-13 | won | 1983 | 237 | 15 | 2230 | `848618ca` | 1800/1982 | 212,453,863,1254 | yes | `30ea73be` -> `a3d34d36` |
| `tactical-no-input` | seed-14 | lost | 1823 | 181 | 0 | 2335 | `77849ab2` | 1800/— | 189,465,864,1353 | yes | `07fbf7a1` -> `f2d4cf61` |
| `tactical-no-input` | seed-15 | lost | 1855 | 174 | 0 | 2495 | `4dc10af7` | 1800/— | 191,476,895,1370 | yes | `5ab2b460` -> `7e28a5bc` |
| `tactical-no-input` | seed-16 | lost | 1670 | 153 | 0 | 2150 | `0a63d846` | —/— | 198,457,895,1448 | yes | `e69d44e8` -> `5db6b3c4` |
| `tactical-no-input` | seed-17 | lost | 1895 | 196 | 0 | 2100 | `2e46fc7c` | 1800/— | 197,483,865,1298 | yes | `af4607be` -> `ac80caca` |
| `tactical-no-input` | seed-18 | lost | 1476 | 127 | 0 | 1826 | `d800513a` | —/— | 196,462,911 | yes | `567872e6` -> `a518a512` |
| `tactical-no-input` | seed-19 | lost | 1875 | 195 | 0 | 2265 | `684209bb` | 1800/— | 204,470,873,1353 | yes | `a040298d` -> `f6484aa5` |
| `tactical-no-input` | seed-20 | lost | 2031 | 218 | 0 | 2366 | `49ecadf1` | 1800/— | 201,460,885,1257 | yes | `30504a0d` -> `ceaad875` |
| `tactical-no-input` | seed-21 | lost | 2164 | 224 | 0 | 3178 | `5073c59d` | 1800/— | 186,504,872,1345 | yes | `236d181b` -> `8056401f` |
| `tactical-no-input` | seed-22 | lost | 2121 | 221 | 0 | 2992 | `00b9f3fd` | 1800/— | 213,472,893,1277 | yes | `d417e9d1` -> `c7ec0945` |
| `tactical-no-input` | seed-23 | lost | 1855 | 180 | 0 | 2380 | `4a79552e` | 1800/— | 225,482,890,1364 | yes | `b30057d3` -> `4a39d6ab` |
| `tactical-no-input` | seed-24 | lost | 1700 | 152 | 0 | 2209 | `e4468026` | —/— | 188,480,874,1407 | yes | `3a3826fe` -> `9c7ba316` |
| `tactical-no-input` | seed-25 | lost | 2042 | 202 | 0 | 2833 | `f4970e88` | 1800/— | 205,470,873,1376 | yes | `476b2188` -> `63f721cc` |
| `tactical-no-input` | seed-26 | won | 2016 | 244 | 16 | 2495 | `f0b3b6c5` | 1800/2015 | 226,463,841,1247 | yes | `66977dfb` -> `25d6fc83` |
| `tactical-no-input` | seed-27 | lost | 2247 | 233 | 0 | 3113 | `55239550` | 1800/— | 199,486,899,1294 | yes | `117dcc1e` -> `1c942b26` |
| `tactical-no-input` | seed-28 | lost | 1876 | 196 | 0 | 2375 | `b824ede8` | 1800/— | 200,480,878,1322 | yes | `84e8a6c4` -> `c4fc1fb8` |
| `tactical-no-input` | seed-29 | lost | 1815 | 183 | 0 | 2331 | `3a2147fd` | 1800/— | 207,466,880,1342 | yes | `0dc39447` -> `bf66de7f` |
| `tactical-no-input` | seed-30 | lost | 1570 | 146 | 0 | 1954 | `9c595b18` | —/— | 207,469,887,1410 | yes | `361654bd` -> `6e2f5009` |
| `tactical-no-input` | seed-31 | lost | 1847 | 184 | 0 | 2389 | `c7a2067d` | 1800/— | 186,496,892,1332 | yes | `fb0d7bda` -> `122c6726` |
| `flees-always` | seed-a | lost | 1563 | 147 | 0 | 1946 | `ee97309a` | —/— | 215,492,912,1478 | yes | `d8f816f6` -> `0611f83e` |
| `flees-always` | seed-b | lost | 2204 | 225 | 0 | 3266 | `d3add81e` | 1800/— | 198,455,876,1314 | yes | `ffddc7d9` -> `2d46befd` |
| `flees-always` | seed-c | lost | 2099 | 230 | 0 | 2762 | `ffb8021a` | 1800/— | 195,447,840,1263 | yes | `991977cd` -> `65efc479` |
| `flees-always` | seed-d | lost | 1662 | 155 | 0 | 2062 | `fe81cf30` | —/— | 218,453,868,1396 | yes | `5ffd4e11` -> `5f907f01` |
| `flees-always` | seed-e | lost | 1788 | 172 | 0 | 2250 | `cb6afb25` | —/— | 205,491,905,1352 | yes | `1cbec9ef` -> `ebc80827` |
| `flees-always` | seed-f | lost | 2057 | 190 | 0 | 2514 | `c64351a1` | 1800/— | 213,486,896,1353 | yes | `bba8936c` -> `ea925b9c` |
| `flees-always` | seed-g | lost | 1935 | 182 | 0 | 2483 | `dd380e46` | 1800/— | 181,491,892,1383 | yes | `4fb58cd4` -> `ef8ce56c` |
| `flees-always` | seed-h | won | 2123 | 237 | 7 | 2448 | `28cb45b4` | 1800/2122 | 199,470,854,1271 | yes | `d54c7dd1` -> `a9a845b1` |
| `flees-always` | seed-8 | lost | 1903 | 170 | 0 | 2287 | `d1ae796d` | 1800/— | 234,484,879,1411 | yes | `426e64f7` -> `608cdc27` |
| `flees-always` | seed-9 | lost | 1868 | 178 | 0 | 2281 | `d7bd5abb` | 1800/— | 207,471,890,1394 | yes | `29fcd4fd` -> `b8ea9819` |
| `flees-always` | seed-10 | lost | 2032 | 216 | 0 | 2364 | `e5eebbca` | 1800/— | 190,472,861,1267 | yes | `779e42ed` -> `b4d00709` |
| `flees-always` | seed-11 | lost | 1931 | 195 | 0 | 2549 | `91a2bef1` | 1800/— | 216,477,876,1367 | yes | `dc4194fc` -> `348db308` |
| `flees-always` | seed-12 | won | 1955 | 234 | 14 | 2129 | `b671ed3e` | 1800/1954 | 186,469,871,1239 | yes | `a1b79927` -> `e5bc0ceb` |
| `flees-always` | seed-13 | won | 1945 | 233 | 15 | 2181 | `d2351d83` | 1800/1944 | 205,474,846,1241 | yes | `c74c4390` -> `54fd4d8c` |
| `flees-always` | seed-14 | lost | 1792 | 159 | 0 | 2155 | `c0c50505` | —/— | 204,478,872,1450 | yes | `248a5df1` -> `f6b027cd` |
| `flees-always` | seed-15 | lost | 2107 | 190 | 0 | 2647 | `fb03c817` | 1800/— | 216,496,894,1352 | yes | `04797dd8` -> `f1de8614` |
| `flees-always` | seed-16 | lost | 1880 | 191 | 0 | 2428 | `07775b01` | 1800/— | 205,459,873,1341 | yes | `0ab8fe7f` -> `332005b7` |
| `flees-always` | seed-17 | won | 2082 | 239 | 3 | 2442 | `ac8ee776` | 1800/2081 | 207,485,835,1243 | yes | `4c5a17d4` -> `26d54318` |
| `flees-always` | seed-18 | lost | 1580 | 141 | 0 | 1925 | `87e097dc` | —/— | 216,477,913 | yes | `b404d84c` -> `48448a0c` |
| `flees-always` | seed-19 | lost | 2011 | 221 | 0 | 2440 | `1cca4e55` | 1800/— | 205,499,885,1273 | yes | `a0144881` -> `82b15e65` |
| `flees-always` | seed-20 | lost | 2161 | 229 | 0 | 2469 | `1778d135` | 1800/— | 195,492,881,1268 | yes | `6e9db978` -> `fb70da3c` |
| `flees-always` | seed-21 | won | 2024 | 213 | 10 | 2938 | `f310e68b` | 1800/2023 | 197,492,885,1337 | yes | `73f035ce` -> `89bf68be` |
| `flees-always` | seed-22 | won | 1955 | 228 | 14 | 2635 | `c9af50bb` | 1800/1954 | 219,473,860,1249 | yes | `9743d45d` -> `5ef0442d` |
| `flees-always` | seed-23 | lost | 2066 | 208 | 0 | 2602 | `d99ef62c` | 1800/— | 201,478,900,1348 | yes | `2b1bbf0b` -> `cc93a38f` |
| `flees-always` | seed-24 | lost | 1884 | 164 | 0 | 2369 | `71e4224c` | 1800/— | 189,468,880,1387 | yes | `86823d2a` -> `e1948ace` |
| `flees-always` | seed-25 | lost | 2026 | 194 | 0 | 2813 | `06e86077` | 1800/— | 214,451,873,1373 | yes | `2435de13` -> `50f0a1cb` |
| `flees-always` | seed-26 | won | 1988 | 238 | 15 | 2453 | `56c60b57` | 1800/1987 | 213,520,861,1256 | yes | `9fcddcd0` -> `0bcd19b8` |
| `flees-always` | seed-27 | won | 2217 | 228 | 1 | 3127 | `1a216a8e` | 1800/2216 | 197,469,900,1289 | yes | `1ae4ded9` -> `ffbfc165` |
| `flees-always` | seed-28 | lost | 2015 | 212 | 0 | 2514 | `bf216411` | 1800/— | 206,478,852,1301 | yes | `135691d2` -> `592e846a` |
| `flees-always` | seed-29 | lost | 2012 | 196 | 0 | 2461 | `8f30f804` | 1800/— | 229,472,897,1341 | yes | `ba9185f1` -> `44a23cb5` |
| `flees-always` | seed-30 | lost | 1871 | 163 | 0 | 2128 | `fc815ff0` | 1800/— | 209,474,870,1405 | yes | `e310ae15` -> `7959705d` |
| `flees-always` | seed-31 | lost | 2349 | 214 | 0 | 2739 | `2878e0fc` | 1800/— | 197,490,871,1264 | yes | `51074e6f` -> `011f4c37` |
| `camps-in-place` | seed-a | lost | 1653 | 159 | 0 | 2031 | `ad43525f` | —/— | 202,490,867,1358 | yes | `8f30c06d` -> `5b574345` |
| `camps-in-place` | seed-b | lost | 2207 | 232 | 0 | 3290 | `6d64e699` | 1800/— | 193,444,889,1357 | yes | `87715804` -> `39716750` |
| `camps-in-place` | seed-c | lost | 1719 | 170 | 0 | 2131 | `cf116143` | —/— | 210,498,887,1351 | yes | `334b1763` -> `12b22be3` |
| `camps-in-place` | seed-d | lost | 1763 | 170 | 0 | 2202 | `a059a55d` | —/— | 205,465,867,1315 | yes | `5cc58a0b` -> `173132d7` |
| `camps-in-place` | seed-e | lost | 1767 | 166 | 0 | 2192 | `66974389` | —/— | 194,482,882,1374 | yes | `377ea853` -> `73330463` |
| `camps-in-place` | seed-f | lost | 1780 | 170 | 0 | 2301 | `7071fcf9` | —/— | 217,489,883,1357 | yes | `36e1b0aa` -> `9470a06a` |
| `camps-in-place` | seed-g | lost | 1693 | 148 | 0 | 2204 | `f30e4087` | —/— | 188,445,907,1552 | yes | `87b819cc` -> `0ac4fb6c` |
| `camps-in-place` | seed-h | lost | 2021 | 207 | 0 | 2303 | `648d195a` | 1800/— | 214,466,874,1288 | yes | `089ec919` -> `9394b315` |
| `camps-in-place` | seed-8 | lost | 1708 | 165 | 0 | 2208 | `aab360b7` | —/— | 215,501,885,1393 | yes | `b8d034e3` -> `8deb1977` |
| `camps-in-place` | seed-9 | lost | 1915 | 191 | 0 | 2471 | `1ff058ac` | 1800/— | 185,468,875,1341 | yes | `0507014a` -> `7e50fe46` |
| `camps-in-place` | seed-10 | lost | 1814 | 176 | 0 | 2053 | `f2e9810e` | 1800/— | 209,488,889,1337 | yes | `34a96425` -> `5da9e749` |
| `camps-in-place` | seed-11 | lost | 1796 | 170 | 0 | 2358 | `e9c17b88` | —/— | 182,491,870,1386 | yes | `06dd56af` -> `d0e605cf` |
| `camps-in-place` | seed-12 | won | 2009 | 241 | 13 | 2225 | `5927ece0` | 1800/2008 | 210,456,851,1249 | yes | `b6a5691e` -> `4d3c3b22` |
| `camps-in-place` | seed-13 | won | 2035 | 246 | 14 | 2312 | `7b444c00` | 1800/2034 | 212,453,863,1254 | yes | `9b7c8226` -> `609685ce` |
| `camps-in-place` | seed-14 | lost | 1825 | 181 | 0 | 2335 | `c55112d0` | 1800/— | 189,465,864,1353 | yes | `c12c2814` -> `7bb8165c` |
| `camps-in-place` | seed-15 | lost | 1856 | 173 | 0 | 2498 | `df45b104` | 1800/— | 191,476,895,1370 | yes | `a1f1a2d2` -> `9e2b83b6` |
| `camps-in-place` | seed-16 | lost | 1670 | 153 | 0 | 2150 | `0a63d846` | —/— | 198,457,895,1448 | yes | `e69d44e8` -> `5db6b3c4` |
| `camps-in-place` | seed-17 | lost | 1909 | 195 | 0 | 2110 | `27030044` | 1800/— | 197,483,865,1298 | yes | `624cc4e5` -> `66e3d8ed` |
| `camps-in-place` | seed-18 | lost | 1476 | 127 | 0 | 1826 | `d800513a` | —/— | 196,462,911 | yes | `567872e6` -> `a518a512` |
| `camps-in-place` | seed-19 | lost | 1885 | 194 | 0 | 2276 | `6464a18a` | 1800/— | 204,470,873,1353 | yes | `3e29638b` -> `32114d8f` |
| `camps-in-place` | seed-20 | lost | 2051 | 219 | 0 | 2389 | `7789e3b5` | 1800/— | 201,460,885,1257 | yes | `d3b7b3c9` -> `648ee049` |
| `camps-in-place` | seed-21 | lost | 2143 | 215 | 0 | 3187 | `7f7d4ae5` | 1800/— | 186,504,872,1345 | yes | `defb3d59` -> `b35fc3e1` |
| `camps-in-place` | seed-22 | lost | 2125 | 220 | 0 | 3010 | `5468bb12` | 1800/— | 213,472,893,1277 | yes | `2c539e31` -> `c3aacfcd` |
| `camps-in-place` | seed-23 | lost | 1854 | 179 | 0 | 2381 | `7b06fecc` | 1800/— | 225,482,890,1364 | yes | `69759aed` -> `bd0ef259` |
| `camps-in-place` | seed-24 | lost | 1700 | 152 | 0 | 2209 | `e4468026` | —/— | 188,480,874,1407 | yes | `3a3826fe` -> `9c7ba316` |
| `camps-in-place` | seed-25 | lost | 2048 | 200 | 0 | 2840 | `fdeeda90` | 1800/— | 205,470,873,1376 | yes | `fe053f0f` -> `71198cef` |
| `camps-in-place` | seed-26 | won | 2024 | 245 | 15 | 2508 | `88f314d4` | 1800/2023 | 226,463,841,1247 | yes | `0c423f3c` -> `4c1e9c30` |
| `camps-in-place` | seed-27 | lost | 2183 | 228 | 0 | 3095 | `b6d4e3a9` | 1800/— | 199,486,899,1294 | yes | `cf7d71c5` -> `405bb9c5` |
| `camps-in-place` | seed-28 | lost | 1885 | 195 | 0 | 2384 | `943df901` | 1800/— | 200,480,878,1322 | yes | `7b780a85` -> `b35c6f31` |
| `camps-in-place` | seed-29 | lost | 1815 | 184 | 0 | 2332 | `8a4573d7` | 1800/— | 207,466,880,1342 | yes | `9b825538` -> `13921c90` |
| `camps-in-place` | seed-30 | lost | 1570 | 146 | 0 | 1954 | `9c595b18` | —/— | 207,469,887,1410 | yes | `361654bd` -> `6e2f5009` |
| `camps-in-place` | seed-31 | lost | 1844 | 183 | 0 | 2385 | `37ebb7cf` | 1800/— | 186,496,892,1332 | yes | `1ab095c6` -> `fed921de` |
| `skilled` | seed-a | won | 2076 | 228 | 6 | 2796 | `812654ea` | 1800/2075 | 192,480,852,1272 | yes | `61dc9440` -> `5a4cd9f4` |
| `skilled` | seed-b | won | 2055 | 240 | 14 | 2943 | `2d4b847b` | 1800/2054 | 173,459,873,1287 | yes | `b5666b0a` -> `e614d816` |
| `skilled` | seed-c | won | 2000 | 231 | 13 | 2618 | `8ad6ca81` | 1800/1999 | 184,479,877,1266 | yes | `3f7c8015` -> `1e8a57e1` |
| `skilled` | seed-d | lost | 2120 | 221 | 0 | 2846 | `943009f0` | 1800/— | 221,459,862,1303 | yes | `3fc17aec` -> `a6359ea4` |
| `skilled` | seed-e | won | 2011 | 220 | 6 | 2714 | `f75796f7` | 1800/2010 | 178,458,867,1284 | yes | `3f651503` -> `392d02ab` |
| `skilled` | seed-f | won | 2020 | 238 | 13 | 2577 | `da0f99b3` | 1800/2019 | 187,438,873,1288 | yes | `bdcfbae5` -> `105ccdd9` |
| `skilled` | seed-g | won | 2151 | 228 | 4 | 2988 | `0e30f137` | 1800/2150 | 209,466,878,1308 | yes | `87436e52` -> `5416b2ae` |
| `skilled` | seed-h | won | 1993 | 237 | 14 | 2265 | `130af079` | 1800/1992 | 202,442,840,1280 | yes | `ef032ace` -> `df9486be` |
| `skilled` | seed-8 | won | 2107 | 235 | 3 | 2782 | `15ac816b` | 1800/2106 | 209,470,875,1297 | yes | `136e0e11` -> `92fa4955` |
| `skilled` | seed-9 | lost | 2201 | 230 | 0 | 3027 | `4d2932d7` | 1800/— | 169,444,872,1295 | yes | `2f47509d` -> `2b09b1a1` |
| `skilled` | seed-10 | won | 1982 | 233 | 14 | 2291 | `415186e3` | 1800/1981 | 175,453,831,1265 | yes | `1b0c14e3` -> `bcdef8b7` |
| `skilled` | seed-11 | won | 2094 | 241 | 12 | 2832 | `cfd97cba` | 1800/2093 | 213,484,861,1302 | yes | `3d56cb9b` -> `c6bd40ef` |
| `skilled` | seed-12 | won | 1931 | 231 | 16 | 1998 | `49fef789` | 1800/1930 | 187,436,843,1235 | yes | `8d408d57` -> `b83f4847` |
| `skilled` | seed-13 | won | 1998 | 243 | 16 | 2194 | `3010657f` | 1800/1997 | 204,451,856,1231 | yes | `0a23b76c` -> `4a24a2e0` |
| `skilled` | seed-14 | won | 2048 | 231 | 6 | 2812 | `8ae6d244` | 1800/2047 | 195,464,852,1296 | yes | `ca9704c5` -> `0b66d369` |
| `skilled` | seed-15 | won | 2132 | 236 | 13 | 2974 | `8f557d1f` | 1800/2131 | 212,484,874,1300 | yes | `b4de1615` -> `0cc30b25` |
| `skilled` | seed-16 | lost | 2204 | 228 | 0 | 2981 | `367b1011` | 1800/— | 191,466,867,1278 | yes | `33087f47` -> `43fb3f5f` |
| `skilled` | seed-17 | won | 1972 | 234 | 14 | 2179 | `e3449aa9` | 1800/1971 | 176,462,844,1290 | yes | `fe582342` -> `b5d7eebe` |
| `skilled` | seed-18 | lost | 2089 | 218 | 0 | 2754 | `afde7a24` | 1800/— | 173,465,861,1321 | yes | `3e973157` -> `65486033` |
| `skilled` | seed-19 | won | 2001 | 233 | 9 | 2546 | `9bbc4ebe` | 1800/2000 | 202,462,880,1252 | yes | `625994ee` -> `750772f2` |
| `skilled` | seed-20 | won | 1982 | 242 | 16 | 2412 | `94eda459` | 1800/1981 | 183,453,836,1262 | yes | `d1dca410` -> `41d06214` |
| `skilled` | seed-21 | won | 2006 | 227 | 15 | 2725 | `cdf8116d` | 1800/2005 | 176,480,872,1310 | yes | `51be96a7` -> `fee8092b` |
| `skilled` | seed-22 | won | 2013 | 238 | 15 | 2663 | `dccab591` | 1800/2012 | 193,462,835,1260 | yes | `52a0149b` -> `dc0df16f` |
| `skilled` | seed-23 | won | 2086 | 242 | 10 | 2691 | `694e518b` | 1800/2085 | 198,465,852,1314 | yes | `facf7ebe` -> `a09add3a` |
| `skilled` | seed-24 | won | 2105 | 227 | 5 | 3006 | `5c1d4a36` | 1800/2104 | 195,437,846,1302 | yes | `0ea2c3ed` -> `94d24005` |
| `skilled` | seed-25 | won | 2137 | 242 | 10 | 3037 | `c116d858` | 1800/2136 | 207,467,861,1299 | yes | `fdeef08f` -> `e51cb803` |
| `skilled` | seed-26 | won | 1984 | 240 | 16 | 2349 | `40c7b78c` | 1800/1983 | 225,435,857,1257 | yes | `e7f02eae` -> `8e072012` |
| `skilled` | seed-27 | won | 2032 | 244 | 12 | 2844 | `e02ae9c4` | 1800/2031 | 203,482,876,1266 | yes | `df1c60d2` -> `6c21542e` |
| `skilled` | seed-28 | won | 1963 | 230 | 12 | 2451 | `ef2d97af` | 1800/1962 | 178,448,854,1275 | yes | `6833625b` -> `2c85b373` |
| `skilled` | seed-29 | won | 2018 | 233 | 9 | 2481 | `ff2abf15` | 1800/2017 | 187,481,876,1275 | yes | `89bca74c` -> `15426a48` |
| `skilled` | seed-30 | lost | 2109 | 223 | 0 | 2800 | `783158bb` | 1800/— | 207,459,888,1285 | yes | `fa2c892e` -> `4a5309c6` |
| `skilled` | seed-31 | won | 2123 | 237 | 3 | 2986 | `3d75f2f4` | 1800/2122 | 177,493,873,1293 | yes | `daf33f74` -> `0cca8d7c` |
| `ignores-range` | seed-a | won | 2114 | 223 | 3 | 2912 | `4a4bb3e8` | 1800/2113 | 218,481,847,1293 | yes | `e4f2929c` -> `221323c4` |
| `ignores-range` | seed-b | won | 1985 | 232 | 16 | 2807 | `b4338c1b` | 1800/1984 | 197,474,874,1260 | yes | `00e187c9` -> `736c3ba1` |
| `ignores-range` | seed-c | won | 1962 | 229 | 8 | 2648 | `21925ac6` | 1800/1961 | 186,461,819,1274 | yes | `736c35ed` -> `485d5d9d` |
| `ignores-range` | seed-d | won | 2013 | 219 | 7 | 2702 | `17ccd731` | 1800/2012 | 211,442,846,1254 | yes | `ebd4e23b` -> `11746ffb` |
| `ignores-range` | seed-e | won | 2048 | 228 | 7 | 2800 | `422160fd` | 1800/2047 | 183,480,891,1282 | yes | `3cabe9bd` -> `43747455` |
| `ignores-range` | seed-f | won | 2264 | 274 | 10 | 2969 | `f9aebf1a` | 1800/2263 | 199,453,900,1315 | yes | `44b34afc` -> `a84606a0` |
| `ignores-range` | seed-g | won | 2094 | 226 | 7 | 2880 | `38001c48` | 1800/2093 | 196,491,873,1295 | yes | `9112f0bf` -> `d5042207` |
| `ignores-range` | seed-h | won | 1973 | 239 | 16 | 2195 | `64e9ec71` | 1800/1972 | 212,451,857,1265 | yes | `4ffc8d54` -> `76b78804` |
| `ignores-range` | seed-8 | won | 2118 | 244 | 7 | 2735 | `534e5e1b` | 1800/2117 | 237,461,863,1280 | yes | `83b04870` -> `66a60120` |
| `ignores-range` | seed-9 | won | 1971 | 229 | 12 | 2711 | `db7a55b1` | 1800/1970 | 177,438,855,1274 | yes | `d2737fff` -> `a6f5b237` |
| `ignores-range` | seed-10 | won | 1939 | 232 | 16 | 2220 | `34a0e65b` | 1800/1938 | 204,461,848,1238 | yes | `3b7bb4ba` -> `5eda9eca` |
| `ignores-range` | seed-11 | won | 2007 | 231 | 12 | 2739 | `c7e99bbe` | 1800/2006 | 197,438,865,1273 | yes | `fba91a89` -> `3ef3fa25` |
| `ignores-range` | seed-12 | won | 1998 | 239 | 16 | 2116 | `71a4914f` | 1800/1997 | 188,456,822,1243 | yes | `9091c456` -> `ac1f36ca` |
| `ignores-range` | seed-13 | won | 2013 | 248 | 15 | 2202 | `9b16ff4b` | 1800/2012 | 208,480,814,1265 | yes | `f6400bbe` -> `ecd80922` |
| `ignores-range` | seed-14 | won | 2132 | 227 | 2 | 2936 | `bc1c74ee` | 1800/2131 | 220,471,865,1293 | yes | `17af2a47` -> `9bf6e923` |
| `ignores-range` | seed-15 | won | 1947 | 222 | 13 | 2695 | `22ccef48` | 1800/1946 | 193,457,850,1282 | yes | `1221318c` -> `1192eb80` |
| `ignores-range` | seed-16 | lost | 2144 | 230 | 0 | 2993 | `9b9196b3` | 1800/— | 198,504,848,1281 | yes | `0afeda5d` -> `d29c5c91` |
| `ignores-range` | seed-17 | won | 1954 | 231 | 14 | 2219 | `ca37d75d` | 1800/1953 | 198,497,848,1249 | yes | `fb7189c3` -> `b6deee6f` |
| `ignores-range` | seed-18 | lost | 2076 | 220 | 0 | 2720 | `b2b9c720` | 1800/— | 205,450,869,1304 | yes | `cc745df6` -> `63bd6fca` |
| `ignores-range` | seed-19 | won | 1913 | 228 | 14 | 2325 | `7dda4bb7` | 1800/1912 | 204,460,858,1245 | yes | `50db7336` -> `2ad087a6` |
| `ignores-range` | seed-20 | won | 1962 | 232 | 13 | 2347 | `0924e4be` | 1800/1961 | 214,462,844,1280 | yes | `5a25df8e` -> `8df00fca` |
| `ignores-range` | seed-21 | won | 2069 | 231 | 14 | 3035 | `913afa06` | 1800/2068 | 185,477,855,1285 | yes | `98da24bc` -> `860102b0` |
| `ignores-range` | seed-22 | won | 2012 | 234 | 10 | 2803 | `5508d2e8` | 1800/2011 | 211,480,846,1265 | yes | `ec400f1d` -> `0cfd6669` |
| `ignores-range` | seed-23 | won | 2057 | 238 | 13 | 2561 | `3cda5474` | 1800/2056 | 187,493,848,1304 | yes | `73791b30` -> `020b545c` |
| `ignores-range` | seed-24 | won | 1997 | 226 | 13 | 2840 | `dd5f4cdf` | 1800/1996 | 193,478,864,1266 | yes | `809f94bf` -> `f8b2d10b` |
| `ignores-range` | seed-25 | won | 2002 | 235 | 12 | 2796 | `e786ac7f` | 1800/2001 | 203,477,847,1295 | yes | `90aa7a68` -> `e2f24ab0` |
| `ignores-range` | seed-26 | won | 1942 | 232 | 16 | 2289 | `5cc011a6` | 1800/1941 | 220,441,821,1243 | yes | `c96988c1` -> `c81c0921` |
| `ignores-range` | seed-27 | won | 2193 | 260 | 12 | 3126 | `9fce4059` | 1800/2192 | 213,463,862,1271 | yes | `77e26bcf` -> `4ad9bd2b` |
| `ignores-range` | seed-28 | won | 1911 | 224 | 16 | 2400 | `c35e2910` | 1800/1910 | 174,455,879,1299 | yes | `0a3ff0af` -> `95211c7b` |
| `ignores-range` | seed-29 | won | 1980 | 232 | 10 | 2450 | `cd0f514a` | 1800/1979 | 209,464,850,1279 | yes | `328a72e0` -> `df89b6b0` |
| `ignores-range` | seed-30 | lost | 2101 | 219 | 0 | 2720 | `fea0e10f` | 1800/— | 199,448,852,1323 | yes | `c2e95d1b` -> `11714463` |
| `ignores-range` | seed-31 | won | 2036 | 227 | 8 | 2721 | `9f261fcd` | 1800/2035 | 183,476,861,1258 | yes | `85e9d617` -> `7018b58f` |
| `abandons-downed` | seed-a | lost | 2053 | 214 | 0 | 2574 | `cb99c7e5` | 1800/— | 192,480,852,1272 | yes | `db8b66f1` -> `660cf0c9` |
| `abandons-downed` | seed-b | won | 2049 | 238 | 15 | 2933 | `37d544c1` | 1800/2048 | 173,459,873,1287 | yes | `7a0acc72` -> `669d5e9e` |
| `abandons-downed` | seed-c | won | 1988 | 226 | 11 | 2570 | `59cda11d` | 1800/1987 | 184,479,877,1266 | yes | `f3ea3b51` -> `6ad49ac1` |
| `abandons-downed` | seed-d | lost | 2075 | 215 | 0 | 2616 | `6beda3f8` | 1800/— | 221,459,862,1303 | yes | `440a4f26` -> `d5df7cfe` |
| `abandons-downed` | seed-e | lost | 2131 | 221 | 0 | 2756 | `ed79d4b4` | 1800/— | 178,458,867,1295 | yes | `7fe06fdc` -> `c89e8db8` |
| `abandons-downed` | seed-f | won | 2088 | 243 | 10 | 2690 | `9e733ab2` | 1800/2087 | 187,438,873,1288 | yes | `05ffbcd0` -> `586a9da8` |
| `abandons-downed` | seed-g | lost | 2178 | 219 | 0 | 2919 | `0b328bd2` | 1800/— | 209,466,878,1308 | yes | `5c7204e0` -> `b805ded0` |
| `abandons-downed` | seed-h | won | 2024 | 237 | 11 | 2285 | `7d8f6d21` | 1800/2023 | 202,442,840,1280 | yes | `d44aaa8c` -> `9f880004` |
| `abandons-downed` | seed-8 | lost | 2211 | 239 | 0 | 2728 | `d2a3ec62` | 1800/— | 209,470,875,1297 | yes | `ff111934` -> `d524fd28` |
| `abandons-downed` | seed-9 | lost | 2132 | 226 | 0 | 2797 | `99feb4d7` | 1800/— | 169,444,872,1295 | yes | `985771e5` -> `018c5541` |
| `abandons-downed` | seed-10 | won | 1995 | 233 | 8 | 2313 | `5ea3d975` | 1800/1994 | 175,453,831,1265 | yes | `bb853ed7` -> `5ec6e8df` |
| `abandons-downed` | seed-11 | won | 2104 | 242 | 10 | 2849 | `a1a171af` | 1800/2103 | 213,484,861,1302 | yes | `a1ef318b` -> `bdb753d7` |
| `abandons-downed` | seed-12 | won | 1931 | 231 | 16 | 1998 | `49fef789` | 1800/1930 | 187,436,843,1235 | yes | `8d408d57` -> `b83f4847` |
| `abandons-downed` | seed-13 | won | 1998 | 243 | 16 | 2194 | `3010657f` | 1800/1997 | 204,451,856,1231 | yes | `0a23b76c` -> `4a24a2e0` |
| `abandons-downed` | seed-14 | lost | 2166 | 231 | 0 | 2797 | `f7685aa6` | 1800/— | 195,464,852,1304 | yes | `b3ab04ba` -> `43ee6c72` |
| `abandons-downed` | seed-15 | won | 2145 | 232 | 11 | 2948 | `ce239cb5` | 1800/2144 | 212,484,874,1302 | yes | `97e36933` -> `746c9eaf` |
| `abandons-downed` | seed-16 | lost | 2110 | 219 | 0 | 2768 | `7a1daa8d` | 1800/— | 191,466,867,1278 | yes | `0cce9049` -> `249a1351` |
| `abandons-downed` | seed-17 | won | 1969 | 231 | 13 | 2162 | `ea3f3327` | 1800/1968 | 176,462,844,1290 | yes | `98f3a754` -> `018c9dfc` |
| `abandons-downed` | seed-18 | lost | 2064 | 214 | 0 | 2553 | `94950031` | 1800/— | 173,465,861,1305 | yes | `523f3b7a` -> `d72867ae` |
| `abandons-downed` | seed-19 | lost | 2045 | 225 | 0 | 2485 | `6b352d3f` | 1800/— | 202,462,880,1273 | yes | `71e61de3` -> `907ab893` |
| `abandons-downed` | seed-20 | won | 2047 | 244 | 9 | 2440 | `818469c6` | 1800/2046 | 183,453,836,1264 | yes | `55b4a003` -> `cb072eab` |
| `abandons-downed` | seed-21 | won | 2006 | 227 | 15 | 2725 | `cdf8116d` | 1800/2005 | 176,480,872,1310 | yes | `eee8776f` -> `4a408ac3` |
| `abandons-downed` | seed-22 | won | 2013 | 238 | 15 | 2663 | `dccab591` | 1800/2012 | 193,462,835,1260 | yes | `61352769` -> `49c75c61` |
| `abandons-downed` | seed-23 | won | 2102 | 242 | 10 | 2699 | `a5feac3c` | 1800/2101 | 198,465,852,1314 | yes | `d1f91706` -> `a5e328ea` |
| `abandons-downed` | seed-24 | lost | 2235 | 228 | 0 | 3126 | `8b5b551d` | 1800/— | 195,437,846,1302 | yes | `fee71b33` -> `211c51c7` |
| `abandons-downed` | seed-25 | won | 2106 | 237 | 8 | 2957 | `92ec600d` | 1800/2105 | 207,467,861,1299 | yes | `05905870` -> `2753bf60` |
| `abandons-downed` | seed-26 | won | 1984 | 240 | 16 | 2349 | `40c7b78c` | 1800/1983 | 225,435,857,1257 | yes | `e7f02eae` -> `8e072012` |
| `abandons-downed` | seed-27 | won | 2037 | 245 | 11 | 2847 | `1cfbf571` | 1800/2036 | 203,482,876,1266 | yes | `612f10e7` -> `a36f86df` |
| `abandons-downed` | seed-28 | won | 2066 | 234 | 4 | 2604 | `d2eb9f03` | 1800/2065 | 178,448,854,1275 | yes | `b852f865` -> `fb29a339` |
| `abandons-downed` | seed-29 | won | 2009 | 232 | 9 | 2468 | `e048b8da` | 1800/2008 | 187,481,876,1275 | yes | `48bae665` -> `d731c8e9` |
| `abandons-downed` | seed-30 | lost | 2036 | 212 | 0 | 2518 | `9c7fde7f` | 1800/— | 207,459,888,1285 | yes | `244793c8` -> `246b9b10` |
| `abandons-downed` | seed-31 | lost | 2133 | 220 | 0 | 2762 | `9c77df8b` | 1800/— | 177,493,873,1287 | yes | `34376cb3` -> `8ba90c1b` |
| `skilled-conservative` | seed-a | won | 2070 | 231 | 4 | 2781 | `0da3b723` | 1800/2069 | 192,472,863,1295 | yes | `6ea6db45` -> `cb588b6d` |
| `skilled-conservative` | seed-b | won | 2108 | 236 | 12 | 3025 | `6664456e` | 1800/2107 | 214,452,894,1296 | yes | `9649aa7b` -> `098e71af` |
| `skilled-conservative` | seed-c | won | 2001 | 233 | 13 | 2653 | `56d4ae97` | 1800/2000 | 191,469,874,1298 | yes | `d27e9363` -> `9792ae07` |
| `skilled-conservative` | seed-d | won | 2116 | 228 | 2 | 2901 | `cbee7d4e` | 1800/2115 | 204,468,860,1272 | yes | `ac273f47` -> `a8e079eb` |
| `skilled-conservative` | seed-e | won | 2107 | 224 | 4 | 2880 | `16d6c18f` | 1800/2106 | 195,459,881,1303 | yes | `b48d4794` -> `e76944e0` |
| `skilled-conservative` | seed-f | won | 2030 | 246 | 16 | 2575 | `7def8eb3` | 1800/2029 | 174,458,900,1271 | yes | `e909295e` -> `b60babda` |
| `skilled-conservative` | seed-g | won | 2098 | 224 | 4 | 2883 | `1925ac01` | 1800/2097 | 208,457,864,1319 | yes | `0fb51b6b` -> `9df61103` |
| `skilled-conservative` | seed-h | won | 2052 | 241 | 12 | 2340 | `9ae11774` | 1800/2051 | 190,450,843,1261 | yes | `4b7ebfe7` -> `7803fdc3` |
| `skilled-conservative` | seed-8 | won | 2005 | 237 | 15 | 2576 | `8446279d` | 1800/2004 | 190,457,877,1295 | yes | `eeca6b39` -> `8e4beaa1` |
| `skilled-conservative` | seed-9 | won | 2110 | 238 | 5 | 2903 | `5e2084eb` | 1800/2109 | 169,447,864,1279 | yes | `2a14490e` -> `8e3e460a` |
| `skilled-conservative` | seed-10 | won | 1996 | 235 | 13 | 2356 | `22e106fd` | 1800/1995 | 188,448,843,1257 | yes | `e112c355` -> `483c6b71` |
| `skilled-conservative` | seed-11 | won | 1961 | 223 | 16 | 2544 | `62efa5bd` | 1800/1960 | 193,485,875,1329 | yes | `a94363ca` -> `15a259ae` |
| `skilled-conservative` | seed-12 | won | 1913 | 229 | 16 | 1977 | `474ad9de` | 1800/1912 | 183,456,867,1243 | yes | `833f816e` -> `28a6023a` |
| `skilled-conservative` | seed-13 | won | 1971 | 238 | 15 | 2148 | `65e1673a` | 1800/1970 | 203,441,824,1253 | yes | `c17a8a1c` -> `efe4d68c` |
| `skilled-conservative` | seed-14 | won | 2076 | 234 | 4 | 2902 | `47b05a38` | 1800/2075 | 195,467,860,1280 | yes | `6eabac80` -> `e91780f0` |
| `skilled-conservative` | seed-15 | won | 1995 | 224 | 14 | 2648 | `e0e0d679` | 1800/1994 | 177,461,873,1332 | yes | `1d6d4a4d` -> `2687cbad` |
| `skilled-conservative` | seed-16 | won | 2004 | 228 | 8 | 2737 | `fb45311c` | 1800/2003 | 182,447,873,1290 | yes | `11ed2538` -> `d80be628` |
| `skilled-conservative` | seed-17 | won | 2013 | 237 | 13 | 2244 | `e1c709e1` | 1800/2012 | 186,473,867,1270 | yes | `16e2cccc` -> `508e2984` |
| `skilled-conservative` | seed-18 | lost | 2200 | 223 | 0 | 2887 | `baf693ea` | 1800/— | 198,477,861,1318 | yes | `e60d5d99` -> `92741975` |
| `skilled-conservative` | seed-19 | won | 1937 | 234 | 16 | 2344 | `19eac8af` | 1800/1936 | 187,447,855,1256 | yes | `9dac6f0e` -> `a17ee8ee` |
| `skilled-conservative` | seed-20 | won | 1947 | 234 | 14 | 2304 | `657865c3` | 1800/1946 | 183,453,842,1240 | yes | `efeeef05` -> `b18ccb39` |
| `skilled-conservative` | seed-21 | won | 2065 | 233 | 15 | 2856 | `9a62041d` | 1800/2064 | 185,468,887,1331 | yes | `3fc0fbf4` -> `4a114018` |
| `skilled-conservative` | seed-22 | won | 2032 | 239 | 16 | 2740 | `9adda236` | 1800/2031 | 197,455,875,1270 | yes | `ff0bad75` -> `198f7499` |
| `skilled-conservative` | seed-23 | won | 2014 | 237 | 15 | 2564 | `9c89f0f2` | 1800/2013 | 211,445,855,1323 | yes | `a89902c5` -> `a5b93be5` |
| `skilled-conservative` | seed-24 | won | 2076 | 225 | 9 | 2908 | `d0f26fc6` | 1800/2075 | 192,453,879,1302 | yes | `5a5c67e5` -> `0dc2d789` |
| `skilled-conservative` | seed-25 | won | 2000 | 230 | 13 | 2834 | `048e4bbc` | 1800/1999 | 231,444,858,1285 | yes | `c4c24bde` -> `c47ec34e` |
| `skilled-conservative` | seed-26 | won | 1995 | 243 | 16 | 2378 | `1067d434` | 1800/1994 | 192,453,850,1246 | yes | `08f73395` -> `271350c1` |
| `skilled-conservative` | seed-27 | won | 2136 | 253 | 10 | 3036 | `f674e8a5` | 1800/2135 | 213,475,870,1275 | yes | `4c03ad79` -> `e950eead` |
| `skilled-conservative` | seed-28 | won | 2026 | 232 | 10 | 2548 | `7a454792` | 1800/2025 | 173,459,858,1291 | yes | `90903a41` -> `d8ca8c01` |
| `skilled-conservative` | seed-29 | won | 1989 | 234 | 14 | 2420 | `2456ccf2` | 1800/1988 | 184,446,873,1275 | yes | `2ae22f3d` -> `9d4d6001` |
| `skilled-conservative` | seed-30 | lost | 2055 | 216 | 0 | 2709 | `04db4d69` | 1800/— | 199,439,873,1290 | yes | `1d13ded4` -> `e1bf621c` |
| `skilled-conservative` | seed-31 | won | 1999 | 235 | 13 | 2692 | `721889b5` | 1800/1998 | 186,483,874,1266 | yes | `a72ff61f` -> `7a3a36e3` |
| `skilled-aggressive` | seed-a | lost | 2005 | 215 | 0 | 2688 | `d04f52cb` | 1800/— | 184,462,888,1290 | yes | `43cf1c78` -> `9a745c3c` |
| `skilled-aggressive` | seed-b | won | 1996 | 234 | 15 | 2850 | `62a54aef` | 1800/1995 | 187,467,870,1295 | yes | `bdaecc32` -> `3c360326` |
| `skilled-aggressive` | seed-c | won | 1983 | 229 | 12 | 2599 | `039bcd84` | 1800/1982 | 183,470,879,1307 | yes | `7629e076` -> `bdb843da` |
| `skilled-aggressive` | seed-d | won | 2201 | 223 | 1 | 3031 | `142919a2` | 1800/2200 | 190,471,854,1311 | yes | `795e264b` -> `eaaab96b` |
| `skilled-aggressive` | seed-e | won | 2017 | 219 | 5 | 2676 | `fdc7fa44` | 1800/2016 | 178,446,852,1299 | yes | `0ada175d` -> `3e190515` |
| `skilled-aggressive` | seed-f | won | 1982 | 240 | 16 | 2514 | `37472dad` | 1800/1981 | 178,446,880,1269 | yes | `621389da` -> `f565fbbe` |
| `skilled-aggressive` | seed-g | won | 2113 | 233 | 7 | 2957 | `428134b7` | 1800/2112 | 183,481,877,1291 | yes | `058dabcc` -> `e6f53720` |
| `skilled-aggressive` | seed-h | won | 2012 | 235 | 13 | 2241 | `323829b1` | 1800/2011 | 184,438,840,1272 | yes | `5993196e` -> `8b6ce746` |
| `skilled-aggressive` | seed-8 | won | 2060 | 232 | 5 | 2711 | `75c113f9` | 1800/2059 | 209,462,882,1274 | yes | `06e305b2` -> `d4c0635e` |
| `skilled-aggressive` | seed-9 | won | 2064 | 230 | 2 | 2851 | `b7fe33a3` | 1800/2063 | 166,448,872,1287 | yes | `f15b97c5` -> `719277a1` |
| `skilled-aggressive` | seed-10 | won | 2022 | 235 | 8 | 2458 | `e86ee692` | 1800/2021 | 167,457,850,1251 | yes | `2378e885` -> `61ddb29d` |
| `skilled-aggressive` | seed-11 | won | 1977 | 228 | 13 | 2638 | `d53ce27e` | 1800/1976 | 186,469,871,1319 | yes | `24d7d263` -> `4ccd135f` |
| `skilled-aggressive` | seed-12 | won | 1967 | 236 | 16 | 2082 | `436926ba` | 1800/1966 | 199,426,845,1242 | yes | `b1fbfcd3` -> `b90f5fb3` |
| `skilled-aggressive` | seed-13 | won | 2011 | 248 | 16 | 2214 | `a04f0de4` | 1800/2010 | 204,454,841,1239 | yes | `efcabaeb` -> `3437f98b` |
| `skilled-aggressive` | seed-14 | won | 2031 | 230 | 8 | 2790 | `b7295c1d` | 1800/2030 | 177,465,868,1281 | yes | `f5d5136b` -> `fc44c773` |
| `skilled-aggressive` | seed-15 | won | 2124 | 238 | 7 | 2984 | `fcc623d9` | 1800/2123 | 203,453,870,1318 | yes | `dd159352` -> `9d736d36` |
| `skilled-aggressive` | seed-16 | won | 2093 | 228 | 2 | 2833 | `440ffdbb` | 1800/2092 | 180,462,858,1281 | yes | `4847140f` -> `efe74723` |
| `skilled-aggressive` | seed-17 | won | 1967 | 232 | 14 | 2176 | `f5715413` | 1800/1966 | 191,487,855,1264 | yes | `9d0dc94c` -> `3bf06a70` |
| `skilled-aggressive` | seed-18 | lost | 2106 | 221 | 0 | 2773 | `a5fea089` | 1800/— | 177,489,852,1311 | yes | `6a0e144c` -> `ab4e0348` |
| `skilled-aggressive` | seed-19 | won | 1987 | 237 | 10 | 2467 | `87cd374f` | 1800/1986 | 214,450,847,1268 | yes | `e41d9fcb` -> `2d17ef07` |
| `skilled-aggressive` | seed-20 | won | 1993 | 237 | 13 | 2355 | `839259df` | 1800/1992 | 176,462,831,1247 | yes | `4be4c2d9` -> `38b4c759` |
| `skilled-aggressive` | seed-21 | won | 2002 | 226 | 16 | 2760 | `eb385737` | 1800/2001 | 178,448,867,1293 | yes | `7c2a444e` -> `9912ed3a` |
| `skilled-aggressive` | seed-22 | won | 1992 | 236 | 15 | 2644 | `2390f9b9` | 1800/1991 | 191,450,860,1265 | yes | `80497f5c` -> `4919a4bc` |
| `skilled-aggressive` | seed-23 | won | 2113 | 249 | 13 | 2730 | `9e37817b` | 1800/2112 | 200,475,853,1295 | yes | `465b82b0` -> `17a9460c` |
| `skilled-aggressive` | seed-24 | won | 2185 | 233 | 6 | 3117 | `675f6d60` | 1800/2184 | 204,449,868,1307 | yes | `cd5845e0` -> `03f31e84` |
| `skilled-aggressive` | seed-25 | won | 2080 | 245 | 14 | 2967 | `dcba3e2f` | 1800/2079 | 219,462,880,1302 | yes | `5f34dae7` -> `990ca6e7` |
| `skilled-aggressive` | seed-26 | won | 1977 | 239 | 16 | 2397 | `8edd2bcc` | 1800/1976 | 242,441,851,1264 | yes | `9e90dfb6` -> `7cf84852` |
| `skilled-aggressive` | seed-27 | won | 1971 | 231 | 14 | 2699 | `ad991624` | 1800/1970 | 212,454,860,1249 | yes | `b55518f0` -> `0a165920` |
| `skilled-aggressive` | seed-28 | won | 1993 | 237 | 15 | 2482 | `37e06643` | 1800/1992 | 191,450,856,1285 | yes | `06e512b7` -> `82d2daa7` |
| `skilled-aggressive` | seed-29 | won | 2029 | 237 | 14 | 2451 | `3d39c3de` | 1800/2028 | 186,449,870,1262 | yes | `7e3acb06` -> `23179d12` |
| `skilled-aggressive` | seed-30 | lost | 2011 | 208 | 0 | 2585 | `8dc9360a` | 1800/— | 204,447,846,1313 | yes | `44875247` -> `676c51b3` |
| `skilled-aggressive` | seed-31 | won | 2042 | 233 | 7 | 2836 | `5cf7457c` | 1800/2041 | 179,494,867,1272 | yes | `298c09db` -> `79b0ee0b` |
