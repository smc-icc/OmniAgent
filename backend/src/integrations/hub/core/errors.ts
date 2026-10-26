export type DeliveryErrorClass = 'retryable' | 'fatal';

export class HubDeliveryError extends Error {
  readonly classification: DeliveryErrorClass;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, classification: DeliveryErrorClass, statusCode?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'HubDeliveryError';
    this.classification = classification;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

export function classifyError(err: unknown): DeliveryErrorClass {
  if (err instanceof HubDeliveryError) return err.classification;
  if (err && typeof err === 'object' && 'classification' in err) {
    const c = (err as { classification?: string }).classification;
    if (c === 'fatal' || c === 'retryable') return c;
  }
  const status = (err as { statusCode?: number }).statusCode
    ?? (err as { status?: number }).status;
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) return 'retryable';
    if (status >= 400) return 'fatal';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|lock wait|too many connections/i.test(msg)) {
    return 'retryable';
  }
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'TransformError') {
    return 'fatal';
  }
  return 'retryable';
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.stack || err.message : String(err);
}
