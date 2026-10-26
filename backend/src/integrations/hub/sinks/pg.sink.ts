import type { PrismaClient } from '@prisma/client';
import type { DeliveryItem, DeliveryResult, SinkAdapter } from './sink.js';
import { HubDeliveryError } from '../core/errors.js';

const VOICEMAIL_UPDATE_FIELDS = [
  'caller_number',
  'callee_number',
  'duration_sec',
  'audio_path',
  'transcription',
  'occurred_at',
  'vdn_id',
  'raw',
] as const;

function asDate(v: unknown): Date {
  if (v instanceof Date) return v;
  return new Date(String(v ?? new Date().toISOString()));
}

export function createPgVoicemailSink(prisma: PrismaClient, name = 'omni_pg'): SinkAdapter {
  return {
    name,
    capabilities: { batch: true, maxBatchSize: 500, transactional: true, ordered: true },
    async init() { /* prisma already connected */ },
    async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
      const results: DeliveryResult['results'] = [];
      for (const item of items) {
        try {
          const r = item.record;
          const subject = String(r.source_event_subject ?? item.event.subject.id);
          await prisma.icc_voicemails.upsert({
            where: { source_event_subject: subject },
            create: {
              source_event_subject: subject,
              vdn_id: Number(r.vdn_id ?? item.event.tenant.vdnId ?? 0),
              caller_number: r.caller_number != null ? String(r.caller_number) : null,
              callee_number: r.callee_number != null ? String(r.callee_number) : null,
              duration_sec: Number(r.duration_sec ?? 0),
              audio_path: r.audio_path != null ? String(r.audio_path) : null,
              transcription: r.transcription != null ? String(r.transcription) : null,
              occurred_at: asDate(r.occurred_at ?? item.event.occurredAt),
              raw: (r.raw ?? item.event) as object,
            },
            update: {
              caller_number: r.caller_number != null ? String(r.caller_number) : null,
              callee_number: r.callee_number != null ? String(r.callee_number) : null,
              duration_sec: Number(r.duration_sec ?? 0),
              audio_path: r.audio_path != null ? String(r.audio_path) : null,
              transcription: r.transcription != null ? String(r.transcription) : null,
              occurred_at: asDate(r.occurred_at ?? item.event.occurredAt),
              raw: (r.raw ?? item.event) as object,
            },
          });
          void VOICEMAIL_UPDATE_FIELDS;
          results.push({ eventId: item.event.eventId, ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            eventId: item.event.eventId,
            ok: false,
            error: msg,
            retryable: true,
          });
        }
      }
      const failed = results.find((r) => !r.ok);
      if (failed && items.length === 1) {
        throw new HubDeliveryError(failed.error || 'pg sink failed', failed.retryable === false ? 'fatal' : 'retryable');
      }
      return { results };
    },
    async health() {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    async close() { /* prisma owned by app */ },
  };
}
