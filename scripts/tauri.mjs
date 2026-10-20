import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, delimiter } from 'node:path'

if (process.platform !== 'win32') {
  console.error('Todo Widget only supports Windows 11.')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const localCargo = resolve(root, '.tooling/cargo')
const env = { ...process.env }
if (existsSync(resolve(localCargo, 'bin/cargo.exe'))) {
  env.CARGO_HOME = localCargo
  env.RUSTUP_HOME = resolve(root, '.tooling/rustup')
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path'
  env[pathKey] = `${resolve(localCargo, 'bin')}${delimiter}${env[pathKey] ?? ''}`
}
const child = spawn(process.execPath, [resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...process.argv.slice(2)], {
  cwd: root, env, stdio: 'inherit', shell: false,
})
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
