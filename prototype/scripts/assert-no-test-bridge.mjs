import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The `__SQUADING_TEST__` renderer bridge is installed only inside an
// `import.meta.env.DEV` branch, which a production build must eliminate entirely.
// This runs as part of `npm run build` so dropping that guard fails the build
// instead of quietly shipping a debug hook to players.
const BRIDGE = '__SQUADING_TEST__'
const root = join(process.cwd(), 'dist')

function filesUnder(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

let files
try {
  files = filesUnder(root)
} catch (error) {
  console.error(`[assert-no-test-bridge] cannot read ${root}: ${error.message}`)
  process.exit(1)
}

if (files.length === 0) {
  console.error(`[assert-no-test-bridge] ${root} is empty; run the build first`)
  process.exit(1)
}

const offenders = files.filter((path) => readFileSync(path, 'utf8').includes(BRIDGE))

if (offenders.length > 0) {
  console.error(`[assert-no-test-bridge] ${BRIDGE} leaked into the production build:`)
  for (const path of offenders) console.error(`  ${path}`)
  process.exit(1)
}

console.log(`[assert-no-test-bridge] ${files.length} built files contain no ${BRIDGE}`)
