// node 版模拟坐席（基于 @tars/rpc，Linux 容器缺 __servant.so 时的替代）
// 用法: node agent_sim_node.cjs <cmd> [args]
//   login [i] | signin [i] | answer <logicNo> <i> | all <N>
// 坐席映射与 agent_sim.py 的 WORKNO_TO_ID 一致
const path = require('path');
const { createRequire } = require('module');
const TarsRpc = require('@tars/rpc');

const BASE = path.join(__dirname, 'src', 'integrations', 'ccs');
const req = createRequire(path.join(BASE, 'x.cjs'));
// type:module 下生成文件是 CJS 语法但 .js 后缀会被当 ESM——先复制为 .cjs 再 require
const fs = require('fs');
const ccsProxyCjs = path.join(BASE, 'tars', '.ccsProxy.cjs');
const agentStructCjs = path.join(BASE, 'tars', '.agentStruct.cjs');
fs.copyFileSync(path.join(BASE, 'tars', 'ccsProxy.js'), ccsProxyCjs);
fs.copyFileSync(path.join(BASE, 'tars', 'agent_structTars.js'), agentStructCjs);
const ccsTars = req(ccsProxyCjs).smc_icc;
const agentStructTars = req(agentStructCjs).smc_icc;

const AGENT_OBJ = process.env.CCS_AGENT_OBJ || 'SMC-ICC.CCSServer.AgentObj@tcp -h 127.0.0.1 -p 19391 -t 10000';
// 注：默认走宿主机映射；容器内跑时用 tcp -h <ccs-ip>。这里从环境变量解析。

const WORKNO_TO_ID = {
  1: 10599, 2: 10601, 3: 10602, 4: 10603, 5: 10604, 6: 10605,
  7: 10606, 8: 10607, 9: 10608, 10: 10609, 11: 10610, 12: 10611,
  13: 10621, 14: 10622, 15: 10623, 16: 10624, 17: 10625,
  18: 10626, 19: 10627, 20: 10628,
};

const client = TarsRpc.client;
let proxy = null;

function getProxy() {
  if (!proxy) {
    proxy = client.stringToProxy(ccsTars.agentProxy, AGENT_OBJ);
    proxy.setTimeout(10000);
  }
  return proxy;
}

function fill(ctor, obj) {
  const s = new ctor();
  s.readFromObject(obj);
  return s;
}

async function invoke(method, structName, obj) {
  const p = getProxy();
  const cls = agentStructTars[structName];
  if (!cls) throw new Error('unknown struct ' + structName);
  const arg = fill(cls, obj);
  const result = await p[method](arg);
  return result.response.return;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function doLogin(i) {
  const ret = await invoke('DoAgentLogin', 'stAgentLogin_t', {
    workNO: String(1000 + i),
    password: '123456',
    extension: String(9000 + i),
    ComputerName: 'sim-agent-' + i,
    extension2: String(9001 + i),
    AgentType: 1,
    AgentPrxEndpoint: 'SMC-ICC.SimAgent.AgentObj@tcp -h 127.0.0.1 -p 9200 -t 60000',
  });
  console.log('agent' + i + ' DoAgentLogin ret=' + ret);
}

async function doSignInSkill(i) {
  const ret = await invoke('DoAgentSignInSkill', 'stAgentSignInSkill_t', {
    AgentID: WORKNO_TO_ID[i], agentSkillIDs: [10], count: 1,
  });
  console.log('agent' + i + ' DoAgentSignInSkill ret=' + ret);
}

async function doSignInGroup(i) {
  const ret = await invoke('DoAgentSignInGroup', 'stAgentSignInGroup_t', {
    AgentID: WORKNO_TO_ID[i], agentGroupIDs: [10], count: 1,
  });
  console.log('agent' + i + ' DoAgentSignInGroup ret=' + ret);
}

async function doAnswer(logicNo, i) {
  const ret = await invoke('DoAgentAnswerCall', 'stAgentAnswerCall_t', {
    AgentID: WORKNO_TO_ID[i], CallID: Number(logicNo), CallIDType: 0,
  });
  console.log('agent' + i + ' DoAgentAnswerCall logicNo=' + logicNo + ' ret=' + ret);
}

async function main() {
  const cmd = process.argv[2] || 'login';
  const n = (i) => Math.max(1, parseInt(process.argv[i] || '1', 10) || 1);
  if (cmd === 'login') await doLogin(n(3));
  else if (cmd === 'signin') { const i = n(3); await doSignInSkill(i); await doSignInGroup(i); }
  else if (cmd === 'answer') await doAnswer(process.argv[3], n(4));
  else if (cmd === 'all') {
    const N = n(3);
    for (let i = 1; i <= N; i++) { await doLogin(i); await sleep(1500); }
    await sleep(3000);
    for (let i = 1; i <= N; i++) { await doSignInSkill(i); await sleep(800); await doSignInGroup(i); await sleep(800); }
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
