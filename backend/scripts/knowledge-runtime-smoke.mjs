// Deployment smoke for this local isolated instance; never discovers remote targets.
import { execFileSync } from 'node:child_process';
import { constants, createHash, publicEncrypt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const deployment = resolve(root, 'release/knowledge-deploy');
const secretDir = resolve(root, 'release/knowledge-secrets');
const origin = 'http://127.0.0.1:19380';
const sourceCommit = '183bed69ded49c60bb1804419c9e13a9ca3abd70';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const report = { sourceCommit, observedAt: new Date().toISOString(), checks: [], runtimeVerified: false };
const check = condition => { if (!condition) throw new Error('smoke_check_failed'); };

async function request(path, method = 'GET', authorization, body) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { ...(authorization ? { Authorization: authorization } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  check(response.ok && data.code === 0);
  return { data: data.data, authorization: response.headers.get('authorization') };
}

try {
  const attestation = JSON.parse(await readFile(resolve(deployment, 'image-attestation.json'), 'utf8'));
  check(attestation.sourceCommit === sourceCommit && attestation.sourceDirty === false);
  const containers = ['smc-icc-ragflow', 'smc-icc-ragflow-es', 'smc-icc-ragflow-minio'];
  report.containers = containers.map(name => {
    const info = JSON.parse(docker('inspect', name))[0];
    check(info.State.Running && info.State.Health?.Status === 'healthy' && !info.State.OOMKilled);
    if (name === 'smc-icc-ragflow') {
      check(info.Image === attestation.imageId);
      check(info.Config.Labels?.['org.opencontainers.image.revision'] === sourceCommit);
      check(info.Config.Env.includes('API_PROXY_SCHEME=python'));
      check(info.Config.Env.includes('REGISTER_ENABLED=0'));
      const binding = info.HostConfig.PortBindings['80/tcp'];
      check(binding?.length === 1 && binding[0].HostIp === '127.0.0.1' && binding[0].HostPort === '19380');
    } else check(Object.keys(info.HostConfig.PortBindings ?? {}).length === 0);
    return { name, imageId: info.Image, health: info.State.Health.Status,
      memoryLimitBytes: info.HostConfig.Memory, nanoCpus: info.HostConfig.NanoCpus };
  });
  report.checks.push('attested-local-source-container', 'three-containers-healthy', 'loopback-api-private-dependencies');
  report.pythonVersion = docker('exec', 'smc-icc-ragflow', 'python3', '--version');
  check(/^Python 3\.13\./.test(report.pythonVersion));
  const language = await request('/language');
  check(language.data?.language === 'python');
  report.version = (await request('/system/version')).data;
  report.checks.push('python-runtime');
  const configCheck = `import json, yaml
from valkey import Valkey
with open('/ragflow/conf/service_conf.yaml') as f: c=yaml.safe_load(f)
assert c['mysql']['host']=='smc-icc-mysql' and c['mysql']['name']=='omni_ragflow' and c['mysql']['user']=='omni_ragflow'
assert c['redis']['host']=='smc-icc-omni-redis:6379' and c['redis']['db']==1
r=Valkey(host='smc-icc-omni-redis',port=6379,db=1,socket_timeout=5)
assert r.ping()
print(json.dumps({'mysqlDatabase':c['mysql']['name'],'redisDb':c['redis']['db'],'redisPing':True}))`;
  report.sharedDependencies = JSON.parse(docker('exec', 'smc-icc-ragflow', 'python3', '-c', configCheck));
  report.checks.push('shared-mysql-config-and-redis-db1');
  report.deploymentFiles = {};
  for (const name of ['06-compose-ragflow.yml', 'docker/ragflow/entrypoint.sh',
    'docker/ragflow/es-entrypoint.sh', 'docker/ragflow/service_conf.yaml.template']) {
    const bytes = await readFile(resolve(root, '../Tools/calltest/deploy', name));
    report.deploymentFiles[name] = createHash('sha256').update(bytes).digest('hex');
  }
  const anonymous = await fetch(`${origin}/api/v1/datasets`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  check(anonymous.status === 401);
  report.checks.push('anonymous-dataset-access-denied');

  const password = (await readFile(resolve(secretDir, 'admin-password'), 'utf8')).trim();
  check(/^[a-f0-9]{64}$/.test(password));
  const publicKey = await readFile(resolve(root, '../RAGFlow/conf/public.pem'));
  const encrypted = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(Buffer.from(password).toString('base64'))).toString('base64');
  const login = await request('/auth/login', 'POST', undefined,
    { email: 'omni-contract@localhost.test', password: encrypted });
  check(login.authorization && login.data?.email === 'omni-contract@localhost.test');
  report.checks.push('dedicated-admin-login');
  // Reconcile token creation through the dedicated test tenant before POST.
  // Never repeat a timed-out creation blindly; a later run lists tokens first.
  const listed = (await request('/system/tokens', 'GET', login.authorization)).data;
  check(Array.isArray(listed) && listed.length <= 1);
  const token = listed.length === 1 ? listed[0] : (await request('/system/tokens', 'POST', login.authorization)).data;
  check(typeof token?.token === 'string' && token.token.startsWith('ragflow-'));
  await writeFile(resolve(secretDir, 'contract-api-key'), token.token, { mode: 0o600 });
  const datasets = (await request('/datasets?page=1&page_size=10', 'GET', `Bearer ${token.token}`)).data;
  check(Array.isArray(datasets));
  report.checks.push('dedicated-api-token-dataset-read');
  const registeredModels = (await request('/models', 'GET', login.authorization)).data;
  check(Array.isArray(registeredModels));
  const expectedModels = [
    ['embedding', 'HuggingFace', 'omni-cpu-embedding', 'BAAI/bge-small-zh-v1.5'],
    ['rerank', 'HuggingFace', 'omni-cpu-reranker', 'BAAI/bge-reranker-base'],
    ['chat', 'OpenAI-API-Compatible', 'omni-freetoken', 'gpt-oss-20b'],
  ];
  report.modelsConfigured = expectedModels.every(([type, provider, instance, name]) => registeredModels.some(model =>
    model.name === name && model.provider_name === provider && model.instance_name === instance && model.model_type.includes(type)));
  if (report.modelsConfigured) report.checks.push('three-models-registered');
  report.runtimeVerified = true;
  report.pending = [...(report.modelsConfigured ? [] : ['model-configuration']), 'live-parsing-retrieval-contract', 'business-evaluation'];
  await writeFile(resolve(deployment, 'runtime-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: 'runtime_smoke_passed', checks: report.checks, pending: report.pending }));
} catch {
  await writeFile(resolve(deployment, 'runtime-smoke.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify({ status: 'runtime_smoke_failed', passedChecks: report.checks }));
  process.exitCode = 1;
}
