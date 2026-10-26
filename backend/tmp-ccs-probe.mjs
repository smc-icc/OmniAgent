import TarsRpc from '@tars/rpc';
const { client } = TarsRpc;
try {
  const { ccsTars, agentStructTars } = await import('./dist/integrations/ccs/tars-loader.js');
  const p = client.stringToProxy(ccsTars.smc_icc.agentProxy, 'SMC-ICC.CCSServer.AgentObj@tcp -h 172.22.0.4 -p 19391 -t 60000');
  p.setTimeout(8000);
  const req = new (agentStructTars.smc_icc.stGetAgentInterfaceVersion_t)();
  req.readFromObject({});
  const r = await p.DoGetAgentInterfaceVersion(req);
  console.log('INVOKE_RET', r.response.return);
} catch (e) {
  console.log('INVOKE_ERR', e.message);
}
