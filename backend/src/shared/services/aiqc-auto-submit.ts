import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { aiqcSubmit } from '../../integrations/aiqc/aiqc-client.js';

/**
 * Auto-submit an offline AIQC task once a call recording becomes available.
 *
 * Controlled by env:
 *   AIQC_AUTO_SUBMIT=1            — master switch (default off)
 *   AIQC_AUTO_SUBMIT_POLICY_ID    — optional default policy
 *   AIQC_RECORDING_URI_PREFIX     — e.g. "file://" or "s3://bucket/" prepended
 *                                   to the stored recording path
 */
export async function maybeAutoSubmitAiqc(value: {
  conversationId: number;
  callId: number;
  recordingPath: string;
  agentId?: number;
  agentName?: string;
  asrEngine?: string;
  caller?: string;
  called?: string;
  talkTimeSec?: number;
}): Promise<void> {
  if (!env.AIQC_AUTO_SUBMIT) return;
  if (!env.AIQC_OBJ) return;
  const recordingPath = String(value.recordingPath ?? '').trim();
  if (!recordingPath) return;

  const prefix = env.AIQC_RECORDING_URI_PREFIX ?? 'file://';
  const recordingUri = recordingPath.startsWith('s3://')
    || recordingPath.startsWith('http://')
    || recordingPath.startsWith('https://')
    || recordingPath.startsWith('sftp://')
    || recordingPath.startsWith('file://')
    ? recordingPath
    : `${prefix}${recordingPath.startsWith('/') ? '' : '/'}${recordingPath}`;

  const taskId = randomUUID();
  const asrEngine = String(value.asrEngine ?? '').trim().toLowerCase() === 'whisper'
    ? 'whisper'
    : 'funasr';
  try {
    const rsp = await aiqcSubmit({
      taskId,
      sessionRef: String(value.callId),
      recordingUri,
      policyId: env.AIQC_AUTO_SUBMIT_POLICY_ID ?? '',
      meta: {
        source: 'omni-auto',
        channel: 'call',
        conversationId: value.conversationId,
        callId: value.callId,
        asrEngine,
        agentId: value.agentId != null ? String(value.agentId) : '',
        agentName: value.agentName ?? '',
        caller: value.caller ?? '',
        called: value.called ?? '',
        durationSec: value.talkTimeSec ?? 0,
      },
    });
    if (rsp.result === 0) {
      console.info(
        `[aiqc-auto] submitted task=${taskId} call=${value.callId} uri=${recordingUri}`,
      );
    } else {
      console.warn(
        `[aiqc-auto] submit rejected call=${value.callId} code=${rsp.result} msg=${rsp.message}`,
      );
    }
  } catch (e) {
    console.error(`[aiqc-auto] submit failed call=${value.callId}`, e);
  }
}
