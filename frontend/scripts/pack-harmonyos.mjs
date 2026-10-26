/**
 * 将 Vite 构建产物复制到鸿蒙 ArkWeb 工程的 rawfile 目录。
 * 用法：npm run build:native && node scripts/pack-harmonyos.mjs
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const dist = join(root, 'dist')
const target = join(root, 'native', 'harmonyos', 'entry', 'src', 'main', 'resources', 'rawfile', 'web')

if (!existsSync(dist)) {
  console.error('[harmonyos] 请先执行 npm run build:native')
  process.exit(1)
}

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true })
}
mkdirSync(target, { recursive: true })
cpSync(dist, target, { recursive: true })

console.log(`[harmonyos] 已同步 dist -> ${target}`)
console.log('[harmonyos] 请使用 DevEco Studio 打开 native/harmonyos 目录并构建 HAP')
