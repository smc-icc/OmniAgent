#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const excluded = new Set([
  '.git',
  '.gradle',
  '.kotlin',
  '.cache',
  '.npmrc',
  '.idea',
  '.svn',
  'node_modules',
  'backups',
  'data',
  'log',
  'logs',
  'dist',
  'release',
  'releases',
  '.tmp',
  '.codex-tmp',
  '.pytest_cache',
  '.specstory',
  '.cursor',
  '.vscode',
  '.github-cache',
]);
const roots = new Set([
  'app',
  'bin',
  'client',
  'config',
  'index',
  'ldap',
  'logger',
  'market',
  'scripts',
  'sql',
  'locale',
  'midware',
  'plugin',
  'rpc',
  'sso',
  'store',
  'tools',
  'docker',
  'k8s',
  'dcache',
  'backend',
  'frontend',
]);
function allowed(rel) {
  const parts = rel.split('/'),
    name = parts.at(-1);
  if (name.endsWith('.unsigned.json')) return false;
  if (
    parts.some((x) => excluded.has(x)) ||
    parts.some(
      (x, i) =>
        x === 'build' && parts.slice(0, i + 1).join('/') !== 'client/build',
    )
  )
    return false;
  if (
    (name.startsWith('.env') && !name.endsWith('.example')) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|lic|smcp|smcc|tgz|zip|map|log|so|a|o|obj|class|jar|aar|apk|hsp|hap)$/i.test(
      name,
    ) ||
    /smcloud_license|id_rsa/.test(name) ||
    (name.startsWith('debug-') && !rel.startsWith('backend/src/'))
  )
    return false;
  if (
    /call-flow-designer\.vue|itr-flow-designer\.vue|CallFlowController\.js|ItrFlowController\.js|callFlowExport\.js/.test(
      name,
    ) ||
    rel.includes('/pages/smcicc/call-flow/') ||
    rel.includes('/pages/smcicc/itr-flow/') ||
    rel.includes('/assets/img/CallFlow/')
  )
    throw Error('企业源代码仍存在: ' + rel);
  return true;
}
async function exportSource(source, target) {
  source = path.resolve(source);
  target = path.resolve(target);
  if (target === source || target.startsWith(source + path.sep))
    throw Error('输出目录必须在源工程之外');
  // Only reviewed/versioned files are public. Never sweep a developer's
  // untracked deployment scripts, local credentials or SDK caches into a release.
  const tracked = new Set(
    execFileSync('git', ['ls-files', '-z'], {
      cwd: source,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\0')
      .filter(Boolean),
  );
  const directories = new Set();
  for (const file of tracked) {
    const parts = file.split('/');
    for (let n = 1; n < parts.length; n++)
      directories.add(parts.slice(0, n).join('/'));
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(target);
  const manifest = [];
  async function copy(dir, prefix = '') {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix + e.name;
      if (
        (e.isDirectory() && !directories.has(rel)) ||
        (e.isFile() && !tracked.has(rel))
      )
        continue;
      if (!allowed(rel)) continue;
      if (!prefix && !roots.has(e.name) && e.isDirectory()) continue;
      if (
        !prefix &&
        e.isFile() &&
        !/^(?:package(?:-lock)?(?:\.release)?\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|README[^/]*|LICENSE|app\.js|exec[^/]*\.js|docker-compose\.yml|\.gitignore|\.dockerignore)$/.test(
          e.name,
        )
      )
        continue;
      if (
        rel.startsWith('docs/') &&
        !rel.startsWith('docs/superpowers/') &&
        !rel.startsWith('docs/community')
      )
        continue;
      const full = path.join(dir, e.name),
        dest = path.join(target, rel);
      if (e.isDirectory()) {
        await copy(full, rel + '/');
      } else if (e.isFile()) {
        const data = await fs.readFile(full);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, data);
        manifest.push({
          path: rel,
          sha256: crypto.createHash('sha256').update(data).digest('hex'),
        });
      }
    }
  }
  await copy(source);
  const docs = path.join(source, 'docs');
  try {
    await copy(docs, 'docs/');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  await fs.writeFile(
    path.join(target, 'community-source-manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        files: manifest,
      },
      null,
      2,
    ),
  );
  return { target, files: manifest.length };
}
if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error(
      'Usage: node tools/export-community.cjs <new-output-directory>',
    );
    process.exitCode = 1;
  } else
    exportSource(path.resolve(__dirname, '..'), out)
      .then((x) => console.log(JSON.stringify(x)))
      .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
}
module.exports = { allowed, exportSource };
