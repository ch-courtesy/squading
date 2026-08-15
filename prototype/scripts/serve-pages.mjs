import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const port = Number(process.env.PORT ?? 4173)
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/').at(-1) ?? 'squading'
const configuredPrefix = process.env.VITE_BASE_PATH
const prefix = configuredPrefix
  ? `/${configuredPrefix.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/')
  : repositoryName.endsWith('.github.io')
    ? '/'
    : `/${repositoryName}/`
const root = join(process.cwd(), 'dist')
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
])

createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname
  if (!pathname.startsWith(prefix)) {
    response.writeHead(404).end('Not found')
    return
  }

  let relativePath
  try {
    relativePath = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html'
  } catch {
    response.writeHead(400).end('Bad request')
    return
  }
  const filePath = normalize(join(root, relativePath))
  if (!filePath.startsWith(`${root}/`) && filePath !== join(root, 'index.html')) {
    response.writeHead(403).end('Forbidden')
    return
  }

  try {
    if (!statSync(filePath).isFile()) throw new Error('Not a file')
    response.writeHead(200, {
      'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
    })
    createReadStream(filePath).pipe(response)
  } catch {
    response.writeHead(404).end('Not found')
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Pages preview: http://127.0.0.1:${port}${prefix}\n`)
})
