import { mkdirSync, copyFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function copyDirJs(srcDir, destDir) {
  if (!existsSync(srcDir)) return
  mkdirSync(destDir, { recursive: true })
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.js') && !name.endsWith('.cjs')) continue
    copyFileSync(join(srcDir, name), join(destDir, name))
  }
}

copyDirJs(join(root, 'src/integrations/ccs'), join(root, 'dist/integrations/ccs'))
copyDirJs(join(root, 'src/integrations/ccs/tars'), join(root, 'dist/integrations/ccs/tars'))
writeFileSync(join(root, 'dist/integrations/ccs/tars/package.json'), '{"type":"commonjs"}')
copyDirJs(join(root, 'src/integrations/itr/tars'), join(root, 'dist/integrations/itr/tars'))
if (existsSync(join(root, 'src/integrations/itr/tars'))) {
  writeFileSync(join(root, 'dist/integrations/itr/tars/package.json'), '{"type":"commonjs"}')
}
copyDirJs(join(root, 'src/integrations/aiqc/tars'), join(root, 'dist/integrations/aiqc/tars'))
if (existsSync(join(root, 'src/integrations/aiqc/tars'))) {
  writeFileSync(join(root, 'dist/integrations/aiqc/tars/package.json'), '{"type":"commonjs"}')
}
copyDirJs(join(root, 'src/integrations/asr/tars'), join(root, 'dist/integrations/asr/tars'))
if (existsSync(join(root, 'src/integrations/asr/tars'))) {
  writeFileSync(join(root, 'dist/integrations/asr/tars/package.json'), '{"type":"commonjs"}')
}

/** 递归拷贝整个目录（demo 是纯静态资源：html/css/js/svg 等） */
function copyDirAll(srcDir, destDir) {
  if (!existsSync(srcDir)) return
  mkdirSync(destDir, { recursive: true })
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.endsWith('.ts') || entry.name.endsWith('.map')) continue
    const src = join(srcDir, entry.name)
    const dest = join(destDir, entry.name)
    if (entry.isDirectory()) copyDirAll(src, dest)
    else copyFileSync(src, dest)
  }
}

// demo 演示页：随 dist 一起部署。这样容器重建、或热更 `docker cp dist` 都不会丢掉演示页。
// 仓库布局是 OmniAgent/demo（backend 的上一级），而 Docker 构建上下文（WORKDIR /app）把 demo 放在 ./demo，
// 所以两个候选位置都试一下。对应 app.ts 中优先从 dist/demo 读取静态资源。
const demoSource = [join(root, '../demo'), join(root, 'demo')].find((p) => existsSync(p))
if (demoSource) {
  copyDirAll(demoSource, join(root, 'dist/demo'))
  console.log(`[copy-runtime-assets] demo -> dist/demo（源：${demoSource}）`)
} else {
  console.warn('[copy-runtime-assets] 未找到 demo 目录，演示页将不可用')
}
