// Fold the roster sweep's per-size dumps into one committed table.
//
//   node tests/sweeps/roster/summarize.mjs <dump-dir> artifacts/roster-sweep-summary.json
//
// WHY THE RAW DUMPS ARE NOT WHAT GETS COMMITTED. One `SWEEP_ROSTER_SIZE` produces ~630KB of
// per-run rows and the sweep covers eight sizes plus two sensitivity schemes — 3.5MB of JSON whose
// every number is reproducible from the harness beside it in about four minutes. The batches
// before this one committed ONE band artifact each and that was the right size; ten of them is
// not. So the dumps stay out of the tree (`.gitignore`) and this file writes the derived table the
// report argues from, which is small enough to read and diff.
//
// It DERIVES ONLY. No thresholds are applied here and no verdict is computed — the band edges
// (§3's I2 55-85%, I3/I8's 0/8, I10's <=2/8, §2.4's three checks) are stated in the report against
// these numbers, so a later reader can disagree with the reading without re-running anything.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [, , dumpDir, outPath] = process.argv
if (!dumpDir || !outPath) {
  throw new Error('usage: summarize.mjs <dump-dir> <out.json>')
}

const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null)
const round = (x, d = 4) => (x === null ? null : Number(x.toFixed(d)))

const files = readdirSync(dumpDir)
const keys = new Set()
for (const name of files) {
  const m = name.match(/^(campaign|stage)-(\d+)-(wide|dense)\.json$/)
  if (m) keys.add(`${m[2]}:${m[3]}`)
}

const rows = []
for (const key of [...keys].sort((a, b) => {
  const [an, as] = a.split(':')
  const [bn, bs] = b.split(':')
  return Number(an) - Number(bn) || as.localeCompare(bs)
})) {
  const [size, scheme] = key.split(':')
  const read = (kind) => {
    try {
      return JSON.parse(readFileSync(join(dumpDir, `${kind}-${size}-${scheme}.json`), 'utf8'))
    } catch {
      return null
    }
  }
  const campaign = read('campaign')
  const stage = read('stage')
  const row = { rosterSize: Number(size), formationScheme: scheme }

  if (campaign) {
    row.scaffold = campaign.scaffold
    row.campaign = { elapsedMs: campaign.elapsedMs, byPolicy: {}, skilledRelayRetention: [] }
    for (const policy of campaign.policies) {
      const runs = campaign.runs.filter((r) => r.policy === policy)
      row.campaign.byPolicy[policy] = {
        completions: runs.filter((r) => r.end === 'complete').length,
        clearedPerSeed: runs.map((r) => r.cleared),
        meanFinalSurvivors: round(mean(runs.map((r) => r.finalSurvivors)), 2),
      }
    }
    const skilled = campaign.runs.filter((r) => r.policy === 'skilled')
    for (let s = 1; s <= 7; s += 1) {
      const legs = skilled.flatMap((r) => r.legs.filter((l) => l.stageId === s))
      row.campaign.skilledRelayRetention.push({
        stageId: s,
        legs: legs.length,
        entered: round(mean(legs.map((l) => l.entered)), 2),
        standing: round(mean(legs.map((l) => l.standing)), 2),
        retention: round(mean(legs.map((l) => l.standing)) / mean(legs.map((l) => l.entered)), 4),
      })
    }
  }

  if (stage) {
    row.stage = { elapsedMs: stage.elapsedMs, skilled: [], winsByPolicy: {} }
    for (const policy of stage.policies) {
      row.stage.winsByPolicy[policy] = Array.from({ length: 7 }, (_, i) =>
        stage.runs.filter((r) => r.policy === policy && r.stageId === i + 1 && r.outcome === 'won')
          .length,
      )
    }
    for (let s = 1; s <= 7; s += 1) {
      const runs = stage.runs.filter((r) => r.policy === 'skilled' && r.stageId === s)
      row.stage.skilled.push({
        stageId: s,
        wins: runs.filter((r) => r.outcome === 'won').length,
        rosterHp: round(mean(runs.map((r) => r.hpAtStart)), 2),
        damageTaken: round(mean(runs.map((r) => r.damageTaken)), 2),
        i2: round(mean(runs.map((r) => r.damageTaken / r.hpAtStart))),
        i2Windows: [0, 1, 2].map((w) =>
          round(mean(runs.map((r) => r.damageTakenByWindow[w] / r.hpAtStart))),
        ),
        retention: round(mean(runs.map((r) => r.standing / r.entered))),
        damagePerBody: round(mean(runs.map((r) => r.damageTaken / r.entered))),
        lost: round(mean(runs.map((r) => r.dead + r.downed)), 2),
        kills: round(mean(runs.map((r) => r.kills)), 1),
        endTick: round(mean(runs.map((r) => r.endTick)), 0),
      })
    }
  }
  rows.push(row)
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify({ generatedFrom: 'tests/sweeps/roster', rows }, null, 2)}\n`)
console.log(`[roster] ${rows.length} size/scheme rows -> ${outPath}`)
