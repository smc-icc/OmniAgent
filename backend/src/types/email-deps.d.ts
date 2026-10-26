declare module 'imapflow' {
  export class ImapFlow {
    constructor(options: Record<string, unknown>);
    connect(): Promise<void>;
    logout(): Promise<void>;
    getMailboxLock(path: string): Promise<{ release(): void }>;
    fetch(range: string, query: Record<string, unknown>): AsyncIterable<{
      uid?: number;
      source?: Buffer;
      envelope?: unknown;
    }>;
  }
}

declare module 'mailparser' {
  export function simpleParser(source: Buffer): Promise<{
    from?: { value?: Array<{ address?: string; name?: string }> };
    text?: string;
    html?: string;
  }>;
}
