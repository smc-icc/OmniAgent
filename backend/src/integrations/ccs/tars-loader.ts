import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const tarsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tars');

export const ccsTars = require(path.join(tarsDir, 'ccsProxy.js')) as {
  smc_icc: {
    agentProxy: new () => CcsAgentProxy;
    [key: string]: unknown;
  };
};

export const agentStructTars = require(path.join(tarsDir, 'agent_structTars.js')) as {
  smc_icc: Record<string, new () => TarsStruct>;
};

export const agentTars = require(path.join(tarsDir, 'agent.js')) as {
  smc_icc: {
    agentImp: new () => AgentServantBase;
  };
};

export const baseTars = require(path.join(tarsDir, 'baseTars.js')) as {
  smc_icc: {
    stCommRsp_t: new () => TarsStruct;
  };
};

export interface TarsStruct {
  readFromObject(obj: Record<string, unknown>): void;
  toObject(): Record<string, unknown>;
}

export interface CcsAgentProxy {
  setTimeout(ms: number): void;
  [method: string]: ((req: TarsStruct) => Promise<TarsRpcResult>) | unknown;
}

export interface TarsRpcResult {
  response: {
    return: number;
    arguments: Record<string, TarsStruct>;
  };
}

export interface AgentServantBase {
  onDispatch(current: unknown, funcName: string, binBuffer: unknown): number;
  [method: string]: unknown;
}
