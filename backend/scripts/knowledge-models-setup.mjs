// Register only the dedicated local test tenant's explicitly named model instances.
import { constants, publicEncrypt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const secrets = resolve(root, 'release/knowledge-secrets');
const deployment = resolve(root, 'release/knowledge-deploy');
const origin = 'http://127.0.0.1:19380';
const models = [
  { kind: 'embedding', provider: 'HuggingFace', instance: 'omni-cpu-embedding', name: 'BAAI/bge-small-zh-v1.5', baseUrl: 'http://knowledge-embedding:80', maxTokens: 512 },
  { kind: 'rerank', provider: 'HuggingFace', instance: 'omni-cpu-reranker', name: 'BAAI/bge-reranker-base', baseUrl: 'http://knowledge-reranker:80', maxTokens: 512 },
  { kind: 'chat', provider: 'OpenAI-API-Compatible', instance: 'omni-freetoken', name: 'gpt-oss-20b', baseUrl: 'http://host.docker.internal:1919/v1', maxTokens: 8192 },
];
let authorization;
async function request(path, method = 'GET', body) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(90000),
    headers: { ...(authorization ? { Authorization: authorization } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    // No arbitrary upstream text, credentials or user payloads in logs.
    throw new Error(`model_setup_request_failed:${method}:${path}:${response.status}:${data.code}`);
  }
  return { data: data.data, authorization: response.headers.get('authorization') };
}

try {
  const password = (await readFile(resolve(secrets, 'admin-password'), 'utf8')).trim();
  const publicKey = await readFile(resolve(root, '../RAGFlow/conf/public.pem'));
  const encrypted = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(Buffer.from(password).toString('base64'))).toString('base64');
  const login = await request('/auth/login', 'POST', { email: 'omni-contract@localhost.test', password: encrypted });
  if (login.data?.email !== 'omni-contract@localhost.test' || !login.authorization) throw new Error('dedicated_login_failed');
  authorization = login.authorization;
  const before = (await request('/models/default')).data;
  try { await writeFile(resolve(deployment, 'models-defaults-before.json'), JSON.stringify(before, null, 2), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const configured = [];
  for (const model of models) {
    const providers = (await request('/providers')).data;
    if (!providers.some(p => p.name === model.provider)) await request('/providers', 'PUT', { provider_name: model.provider });
    const instancePath = `/providers/${encodeURIComponent(model.provider)}/instances`;
    const instances = (await request(instancePath)).data;
    if (!instances.some(i => i.instance_name === model.instance)) {
      // API verifies a real model request before committing the new instance.
      await request(instancePath, 'POST', {
        instance_name: model.instance, base_url: model.baseUrl, api_key: 'local-service', region: '',
        model_info: [{ model_name: model.name, model_type: [model.kind], max_tokens: model.maxTokens }],
      });
    }
    const existing = (await request(`${instancePath}/${model.instance}`)).data;
    if (existing.base_url !== model.baseUrl) throw new Error('existing_model_instance_conflict');
    const current = (await request('/models')).data;
    const registered = current.find(m => m.provider_name === model.provider && m.instance_name === model.instance && m.name === model.name && m.model_type.includes(model.kind));
    if (!registered) throw new Error('registered_model_missing');
    await request('/models/default', 'PATCH', { model_id: registered.model_id, model_type: model.kind });
    configured.push({ ...model, modelId: registered.model_id, compositeId: `${model.name}@${model.instance}@${model.provider}` });
    console.log(JSON.stringify({ status: 'model_registered', type: model.kind, model: model.name }));
  }
  await writeFile(resolve(deployment, 'registered-models.json'), JSON.stringify({ observedAt: new Date().toISOString(), models: configured }, null, 2));
  const attestation = JSON.parse(await readFile(resolve(deployment, 'image-attestation.json'), 'utf8'));
  await writeFile(resolve(deployment, 'ragflow-target.local.json'), JSON.stringify({
    environment: 'isolated-test', baseUrl: origin, allowedOrigin: origin, dedicatedTenant: true,
    datasetPrefix: 'omni-contract-', credentialFile: '../knowledge-secrets/contract-api-key',
    embeddingModel: configured[0].compositeId, rerankerModel: configured[1].compositeId, sourceCommit: attestation.sourceCommit,
    imageDigest: 'sha256:088e27f492b976da28877b9c8d90ee6fc11932e37b4019b57ef6bc24acb20b9c', apiScheme: 'python',
  }, null, 2));
  console.log(JSON.stringify({ status: 'models_configured', count: configured.length }));
} catch (error) {
  console.error(JSON.stringify({ status: 'models_setup_failed', code: error.message.startsWith('model_setup_request_failed:') ? error.message : 'setup_or_connection_failed' }));
  process.exitCode = 1;
}
