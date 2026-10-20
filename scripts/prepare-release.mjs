import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const tauriConfig = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const cargoToml = readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8')
const cargoVersion = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1]
const version = packageJson.version
assert.equal(tauriConfig.version, version, 'Tauri and npm versions must match')
assert.equal(cargoVersion, version, 'Cargo and npm versions must match')
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Release tag must match the app version')
}

const files = [
  ['src-tauri/target/release/todo-widget.exe', 'todo-widget.exe'],
  [`src-tauri/target/release/bundle/nsis/Todo Widget_${version}_x64-setup.exe`, 'Todo-Widget-x64-setup.exe'],
]
// Read both build outputs before copying so a missing installer fails immediately.
const assets = files.map(([source, name]) => ({ source: resolve(root, source), name, data: readFileSync(resolve(root, source)) }))
const output = resolve(root, 'release')
mkdirSync(output, { recursive: true })
for (const asset of assets) copyFileSync(asset.source, resolve(output, asset.name))
const checksums = assets.map(({ name, data }) => `${createHash('sha256').update(data).digest('hex')}  ${name}`)
writeFileSync(resolve(output, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`)
console.log(`Prepared Todo Widget v${version}: ${output}`)
for (const asset of assets) console.log(`${asset.name}: ${asset.data.length} bytes`)
