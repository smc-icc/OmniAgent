import { copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const example = join(root, '.env.native.example')
const target = join(root, '.env.native')

if (!existsSync(target) && existsSync(example)) {
  copyFileSync(example, target)
  console.log('[native] 已创建 .env.native（来自 .env.native.example）')
}
