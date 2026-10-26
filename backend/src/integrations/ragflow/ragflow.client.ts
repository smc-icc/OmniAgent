export interface RagflowClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class RagflowHttpError extends Error {
  readonly status: number;
  readonly code: number | null;

  constructor(status: number, code: number | null, message = 'ragflow_request_failed') {
    super(message);
    this.name = 'RagflowHttpError';
    this.status = status;
    this.code = code;
  }
}

export interface UncertainWrite {
  readonly state: 'uncertain';
  readonly reason: 'timeout' | 'network';
}

export class RagflowClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: RagflowClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    if (!options.baseUrl || !options.apiKey) throw new Error('ragflow_client_config_invalid');
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path) as Promise<T>;
  }

  post<T = unknown>(path: string, body: unknown): Promise<T | UncertainWrite> {
    return this.request<T>('POST', path, body);
  }

  delete<T = unknown>(path: string, body: unknown): Promise<T | UncertainWrite> {
    return this.request<T>('DELETE', path, body);
  }

  upload<T = unknown>(path: string, filename: string, bytes: Buffer, contentType: string): Promise<T | UncertainWrite> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
    return this.request<T>('POST', path, form);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | UncertainWrite> {
    const isRead = method === 'GET';
    for (let attempt = 0; attempt < (isRead ? 3 : 1); attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
          method,
          signal: controller.signal,
          headers: { Authorization: `Bearer ${this.options.apiKey}`, ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        });
        const payload = await response.json() as { code?: unknown; data?: T; message?: string };
        const code = typeof payload.code === 'number' ? payload.code : null;
        if ((response.status === 429 || response.status === 503) && isRead && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * (attempt + 1)));
          continue;
        }
        if (!response.ok || code !== 0) throw new RagflowHttpError(response.status, code, payload.message ?? 'ragflow_business_failure');
        return payload.data as T;
      } catch (error) {
        if (error instanceof RagflowHttpError) throw error;
        if (!isRead) return { state: 'uncertain', reason: controller.signal.aborted ? 'timeout' : 'network' };
        if (attempt >= 2) throw new RagflowHttpError(0, null, 'ragflow_read_failed');
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new RagflowHttpError(0, null, 'ragflow_read_failed');
  }
}
