/**
 * 调用已部署的 CosyVoice2 sidecar（TTSServerPy CosyUrl 同一地址）。
 * ITR 全媒体 TTS 走 Omni → CosyVoice HTTP，不经 CCS DoTTS。
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';

const TTS_DIR = path.join(env.LOCAL_UPLOAD_DIR || path.resolve('data/uploads'), 'tts');

export type CosyTtsOpts = {
  text: string;
  spkId?: string;
  emotion?: string;
};

export async function synthesizeCosyVoice(opts: CosyTtsOpts): Promise<{ fileName: string; url: string } | null> {
  const text = String(opts.text || '').trim();
  if (!text) return null;
  const url = (env.COSYVOICE_TTS_URL || '').trim();
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.COSYVOICE_TTS_TIMEOUT_MS || 60000);
  try {
    const rsp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        spk_id: opts.spkId || env.COSYVOICE_TTS_SPK || 'voice_a',
        emotion: opts.emotion || 'calm',
      }),
      signal: ctrl.signal,
    });
    if (!rsp.ok) {
      const err = await rsp.text().catch(() => '');
      console.warn('[tts] cosyvoice http', rsp.status, err.slice(0, 200));
      return null;
    }
    const buf = Buffer.from(await rsp.arrayBuffer());
    if (buf.length < 44) return null;
    await mkdir(TTS_DIR, { recursive: true });
    const stamp = createHash('sha1').update(text).digest('hex').slice(0, 10);
    const fileName = `tts-${Date.now()}-${stamp}-${randomBytes(3).toString('hex')}.wav`;
    await writeFile(path.join(TTS_DIR, fileName), buf);
    return { fileName, url: `/api/omnichannel/tts/${fileName}` };
  } catch (e) {
    console.warn('[tts] cosyvoice failed', e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function safeTtsFileName(name: string): string | null {
  const base = path.basename(String(name || ''));
  if (!/^tts-[\w.-]+\.wav$/i.test(base)) return null;
  return base;
}

export async function readTtsWav(name: string): Promise<Buffer | null> {
  const file = safeTtsFileName(name);
  if (!file) return null;
  try {
    return await readFile(path.join(TTS_DIR, file));
  } catch {
    return null;
  }
}
