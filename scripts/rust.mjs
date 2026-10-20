import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, delimiter } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = { ...process.env }
const cargoHome = resolve(root, '.tooling/cargo')
let cargo = 'cargo'
if (existsSync(resolve(cargoHome, 'bin/cargo.exe'))) {
  cargo = resolve(cargoHome, 'bin/cargo.exe')
  env.CARGO_HOME = cargoHome
  env.RUSTUP_HOME = resolve(root, '.tooling/rustup')
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path'
  env[pathKey] = `${resolve(cargoHome, 'bin')}${delimiter}${env[pathKey] ?? ''}`
}
const child = spawn(cargo, process.argv.slice(2), { cwd: resolve(root, 'src-tauri'), env, stdio: 'inherit', shell: false })
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
