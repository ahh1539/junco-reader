import { gzipSync } from 'node:zlib'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const DIST_DIR = new URL('../dist/', import.meta.url)
const MAX_ENTRY_GZIP_BYTES = 180 * 1024

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
        return entry.isDirectory() ? filesBelow(target) : [target]
      }),
    )
  ).flat()
}

const html = await readFile(new URL('index.html', DIST_DIR), 'utf8')
const entryAssets = [
  ...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g),
].map((match) => match[1])

if (!entryAssets.length) throw new Error('Could not find the production entry assets.')

let entryGzipBytes = 0
for (const asset of new Set(entryAssets)) {
  const contents = await readFile(new URL(asset.slice(1), DIST_DIR))
  entryGzipBytes += gzipSync(contents).byteLength
}

const shippedFiles = await filesBelow(DIST_DIR)
const forbidden = shippedFiles.filter((file) => /\.(?:wasm|onnx)$/i.test(file.pathname))

if (forbidden.length) {
  throw new Error(
    `Model/runtime binaries must not ship from Vercel:\n${forbidden
      .map((file) => `- ${path.basename(file.pathname)}`)
      .join('\n')}`,
  )
}

if (entryGzipBytes > MAX_ENTRY_GZIP_BYTES) {
  throw new Error(
    `Initial JS + CSS is ${(entryGzipBytes / 1024).toFixed(1)} KiB gzip; budget is ${MAX_ENTRY_GZIP_BYTES / 1024} KiB.`,
  )
}

console.log(
  `Bundle budget passed: ${(entryGzipBytes / 1024).toFixed(1)} KiB gzip initial JS + CSS; no model/WASM binaries.`,
)
