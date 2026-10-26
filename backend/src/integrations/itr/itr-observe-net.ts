import crypto from 'node:crypto';
import net from 'node:net';

type Handlers = {
  onOpen?: () => void;
  onMessage?: (text: string) => void;
  onClose?: () => void;
};

/** Minimal RFC6455 client (no extra deps; Node 20 has no global WebSocket). */
export function connectObserveWs(urlStr: string, handlers: Handlers): { close: () => void } {
  const u = new URL(urlStr);
  const port = Number(u.port || (u.protocol === 'wss:' ? 443 : 80));
  const host = u.hostname;
  const path = `${u.pathname || '/ws/observe'}${u.search || ''}`;
  const key = crypto.randomBytes(16).toString('base64');
  let buf = Buffer.alloc(0);
  let opened = false;
  let closed = false;

  const sock = net.connect({ host, port });

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      sock.end();
    } catch {
      /* ignore */
    }
    handlers.onClose?.();
  };

  sock.setNoDelay(true);
  sock.on('connect', () => {
    sock.write(
      `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `\r\n`,
    );
  });

  sock.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    if (!opened) {
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buf.subarray(0, idx).toString('utf8');
      buf = Buffer.from(buf.subarray(idx + 4));
      if (!head.includes('101')) {
        close();
        return;
      }
      opened = true;
      handlers.onOpen?.();
    }
    while (opened && !closed) {
      const frame = takeFrame(buf);
      if (!frame) break;
      buf = Buffer.from(frame.rest);
      if (frame.opcode === 0x8) {
        close();
        return;
      }
      if (frame.opcode === 0x9) {
        sock.write(encodeFrame(0xa, frame.payload, true));
        continue;
      }
      if (frame.opcode === 0x1) {
        handlers.onMessage?.(frame.payload.toString('utf8'));
      }
    }
  });

  sock.on('error', () => close());
  sock.on('close', () => close());

  return { close };
}

function takeFrame(buf: Buffer): { opcode: number; payload: Buffer; rest: Buffer } | null {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = Boolean(buf[1] & 0x80);
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(0xfffffff)) return { opcode: 0x8, payload: Buffer.alloc(0), rest: Buffer.alloc(0) };
    len = Number(big);
    off = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  const mask = masked ? buf.subarray(off, off + 4) : null;
  off += maskLen;
  let payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, rest: buf.subarray(off + len) };
}

function encodeFrame(opcode: number, payload: Buffer, mask: boolean): Buffer {
  const n = payload.length;
  const head: number[] = [0x80 | (opcode & 0x0f)];
  if (n < 126) head.push((mask ? 0x80 : 0) | n);
  else if (n < 65536) {
    head.push((mask ? 0x80 : 0) | 126);
    head.push((n >> 8) & 0xff, n & 0xff);
  } else {
    head.push((mask ? 0x80 : 0) | 127);
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(n));
    for (const x of b) head.push(x);
  }
  const key = mask ? crypto.randomBytes(4) : Buffer.alloc(0);
  const body = Buffer.from(payload);
  if (mask) {
    for (let i = 0; i < body.length; i += 1) body[i] ^= key[i % 4];
  }
  return Buffer.concat([Buffer.from(head), key, body]);
}
