/**
 * 全媒体 ASR：默认 TARS SMC-ICC.ASRServer.asrObj（FunASR 离线）。
 * Conf 运营页 / FUNASR_ASR_URL 若填写 HTTP 地址，则改走 POST { wav_base64 }（其它 ASR 服务）。
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

async function resolvedHttp(): Promise<{ url: string; timeout: number }> {
  const { resolveAsrUrl, resolveAsrTimeoutMs } = await import('./omni-ops.js');
  return { url: await resolveAsrUrl(), timeout: await resolveAsrTimeoutMs() };
}

export function extractAsrTranscript(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return typeof data === 'string' ? data.trim() : '';
  }
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.segments)) {
    const joined = o.segments
      .map((x) => (typeof x === 'string' ? x : String((x as { text?: string })?.text || '')))
      .join('')
      .trim();
    if (joined) return joined;
  }
  const results = o.results ?? o.text ?? o.result;
  if (typeof results === 'string') return results.trim();
  if (Array.isArray(results)) {
    return results
      .map((x) => (typeof x === 'string' ? x : String((x as { text?: string })?.text || '')))
      .join('')
      .trim();
  }
  return '';
}

function tarsPathAllowed(uri: string): boolean {
  const p = uri.startsWith('file://') ? uri.slice(7) : uri;
  return p.startsWith('/data/') || p.startsWith('/tmp/') || p.startsWith('/usr/local/app/tars/');
}

async function writeAsrClip(buf: Buffer): Promise<string> {
  const dir = (env.ASR_CLIP_DIR || '/data/tars/omni-asr').replace(/\\/g, '/');
  await mkdir(dir, { recursive: true });
  const name = `omni-${Date.now()}-${randomBytes(4).toString('hex')}.wav`;
  const filePath = path.posix.join(dir, name);
  await writeFile(filePath, buf);
  return filePath;
}

async function transcribeViaTars(recordingUri: string, timeout: number): Promise<string | null> {
  const { recognizeOfflineFile } = await import('../../integrations/asr/asr-client.js');
  const engine = (env.ASR_ENGINE || 'funasr').trim() || 'funasr';
  const out = await recognizeOfflineFile(recordingUri, timeout, engine);
  if (!out.ok) {
    console.warn('[asr] tars', out.error);
    return null;
  }
  try {
    return extractAsrTranscript(JSON.parse(out.payloadJson || '{}')) || null;
  } catch {
    return extractAsrTranscript(out.payloadJson) || null;
  }
}

async function transcribeHttpWavBase64(url: string, wavBase64: string, timeout: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout || env.FUNASR_ASR_TIMEOUT_MS || 20000);
  try {
    const rsp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wav_base64: wavBase64 }),
      signal: ctrl.signal,
    });
    if (!rsp.ok) {
      const err = await rsp.text().catch(() => '');
      console.warn('[asr] http', rsp.status, err.slice(0, 200));
      return null;
    }
    const data = (await rsp.json()) as unknown;
    return extractAsrTranscript(data) || null;
  } catch (e) {
    console.warn('[asr] http failed', e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeWavBase64(wavBase64: string): Promise<string | null> {
  const { url, timeout } = await resolvedHttp();
  const b64 = String(wavBase64 || '').trim();
  if (!b64) return null;
  if (url) return transcribeHttpWavBase64(url, b64, timeout);
  if (!(env.ASR_OBJ || '').trim()) return null;
  let clip = '';
  try {
    clip = await writeAsrClip(Buffer.from(b64, 'base64'));
    return await transcribeViaTars(clip, timeout);
  } catch (e) {
    console.warn('[asr] tars clip', e instanceof Error ? e.message : e);
    return null;
  } finally {
    if (clip) await unlink(clip).catch(() => undefined);
  }
}

export async function transcribeWavBuffer(buf: Buffer): Promise<string | null> {
  if (!buf?.length) return null;
  return transcribeWavBase64(buf.toString('base64'));
}

export async function transcribeAudioUrl(audioUrl: string): Promise<string | null> {
  const src = String(audioUrl || '').trim();
  if (!src) return null;
  const { url, timeout } = await resolvedHttp();
  if (url) {
    try {
      const rsp = await fetch(src, { signal: AbortSignal.timeout(15000) });
      if (!rsp.ok) return null;
      const buf = Buffer.from(await rsp.arrayBuffer());
      if (buf.length < 64) return null;
      return transcribeWavBuffer(buf);
    } catch {
      return null;
    }
  }
  if (!(env.ASR_OBJ || '').trim()) return null;
  if (tarsPathAllowed(src)) return transcribeViaTars(src, timeout);
  let clip = '';
  try {
    const rsp = await fetch(src, { signal: AbortSignal.timeout(15000) });
    if (!rsp.ok) return null;
    const buf = Buffer.from(await rsp.arrayBuffer());
    if (buf.length < 64) return null;
    clip = await writeAsrClip(buf);
    return await transcribeViaTars(clip, timeout);
  } catch (e) {
    console.warn('[asr] fetch/tars', e instanceof Error ? e.message : e);
    return null;
  } finally {
    if (clip) await unlink(clip).catch(() => undefined);
  }
}

export async function probeAsrHealth(): Promise<{
  ok: boolean;
  url: string;
  mode: 'http' | 'tars' | 'none';
  error?: string;
}> {
  const { url } = await resolvedHttp();
  if (url) {
    try {
      const rsp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ping: true }),
        signal: AbortSignal.timeout(4000),
      });
      return { ok: rsp.ok || rsp.status < 500, url, mode: 'http' };
    } catch (e) {
      return { ok: false, url, mode: 'http', error: e instanceof Error ? e.message : String(e) };
    }
  }
  const obj = (env.ASR_OBJ || '').trim();
  if (!obj) return { ok: false, url: '', mode: 'none', error: '未配置 ASR URL，且未配置 ASR_OBJ' };
  try {
    const { pingAsr } = await import('../../integrations/asr/asr-client.js');
    const ping = await pingAsr();
    return ping.ok
      ? { ok: true, url: obj, mode: 'tars' }
      : { ok: false, url: obj, mode: 'tars', error: ping.error };
  } catch (e) {
    return { ok: false, url: obj, mode: 'tars', error: e instanceof Error ? e.message : String(e) };
  }
}
