import type { ProductModule } from './policy.js';
export interface ModuleState {
  available: boolean;
  installed?: boolean;
  enabled?: boolean;
  licensed?: boolean;
  name?: string;
  version?: string | null;
}
export interface ProductSnapshot {
  schemaVersion: number;
  revision: number;
  deploymentId?: string;
  edition: string;
  modules: Record<ProductModule, ModuleState>;
  limits: Record<string, number>;
  license?: { expiresAt: string } | null;
  connections?: { ccsAgentObj?: string };
  authorityStatus?: 'ready' | 'community' | 'unavailable';
}
export function communitySnapshot(
  status: ProductSnapshot['authorityStatus'] = 'community',
): ProductSnapshot {
  return {
    schemaVersion: 1,
    revision: 0,
    edition: 'community',
    authorityStatus: status,
    modules: {
      omni: { available: true },
      icc: { available: false },
      ivr: { available: false },
      itr: { available: false },
      outbound: { available: false },
      aiqc: { available: false },
      'flow-designer': { available: false },
    },
    limits: { voiceSeats: 0, sipTrunks: 0, concurrentCalls: 0, videoConcurrentCalls: 0 },
  };
}
interface Options {
  url?: string;
  token?: string;
  deploymentId?: string;
  now?: () => number;
  fetch?: typeof fetch;
  ttlMs?: number;
}
export class ModuleAuthority {
  private cache?: { value: ProductSnapshot; until: number };
  private pending?: Promise<ProductSnapshot>;
  constructor(private options: Options) {}
  async snapshot(): Promise<ProductSnapshot> {
    const now = (this.options.now || Date.now)();
    if (
      this.cache &&
      this.cache.until > now &&
      (!this.cache.value.license ||
        Date.parse(this.cache.value.license.expiresAt) > Date.now())
    )
      return this.cache.value;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  private async load(): Promise<ProductSnapshot> {
    const { url, token } = this.options;
    if (!url || !token) return communitySnapshot();
    if (token.length < 32) return communitySnapshot('unavailable');
    let value: ProductSnapshot;
    try {
      const response = await (this.options.fetch || fetch)(url, {
        headers: { 'x-smc-module-token': token },
        signal: AbortSignal.timeout(3000),
        redirect: 'error',
      });
      if (!response.ok) throw Error('authority unavailable');
      const data = ((await response.json()) as { data?: ProductSnapshot }).data;
      if (
        !data ||
        data.schemaVersion !== 1 ||
        !Number.isSafeInteger(data.revision) ||
        !['community', 'registered', 'professional', 'enterprise'].includes(data.edition) ||
        (this.options.deploymentId &&
          data.deploymentId !== this.options.deploymentId)
      )
        throw Error('authority mismatch');
      for (const id of [
        'omni',
        'icc',
        'ivr',
        'itr',
        'outbound',
        'aiqc',
        'flow-designer',
      ] as ProductModule[])
        if (typeof data.modules?.[id]?.available !== 'boolean')
          throw Error('invalid module');
      if (
        data.edition !== 'community' &&
        (!data.license ||
          Date.parse(data.license.expiresAt) <= Date.now() ||
          !Number.isFinite(Date.parse(data.license.expiresAt)))
      )
        throw Error('expired authority');
      value = { ...data, authorityStatus: 'ready' };
    } catch {
      value = communitySnapshot('unavailable');
    }
    this.cache = {
      value,
      until: (this.options.now || Date.now)() + (this.options.ttlMs ?? 5000),
    };
    return value;
  }
}
let instance: ModuleAuthority | undefined;
export function productModules() {
  return (instance ??= new ModuleAuthority({
    url: process.env.SMC_MODULE_AUTHORITY_URL,
    token: process.env.SMC_MODULE_SERVICE_TOKEN,
    deploymentId: process.env.SMC_DEPLOYMENT_ID,
  }));
}
