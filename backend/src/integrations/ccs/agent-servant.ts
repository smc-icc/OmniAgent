import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TarsRpc from '@tars/rpc';
import { handleOnAgentCallback } from './ccs-bridge.js';

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const { OmniAgentImp, setOnAgentCallback } = require(path.join(dir, 'omni-agent-imp.cjs')) as {
  OmniAgentImp: new () => unknown;
  setOnAgentCallback: (cb: (method: string, payload: Record<string, unknown>, servantName?: string) => void) => void;
};

type TarsServerHandle = {
  start: (cfg: { name: string; servant: string; endpoint: string; protocol: string }) => Promise<unknown>;
  stop: () => Promise<void>;
};

const { server } = TarsRpc as unknown as { server: { createServer: (Imp: new () => unknown) => TarsServerHandle } };

let tarsServer: TarsServerHandle | null = null;

export async function startAgentServant(options: {
  name: string;
  servant: string;
  host: string;
  port: number;
}): Promise<void> {
  setOnAgentCallback((method, payload, servantName) => {
    handleOnAgentCallback(method, payload, servantName);
  });

  tarsServer = server.createServer(OmniAgentImp as new () => unknown);
  await tarsServer.start({
    name: options.name,
    servant: options.servant,
    endpoint: `tcp -h ${options.host} -p ${options.port}`,
    protocol: 'tars',
  });
}

export async function stopAgentServant(): Promise<void> {
  if (tarsServer) {
    await Promise.resolve(tarsServer.stop());
    tarsServer = null;
  }
}
