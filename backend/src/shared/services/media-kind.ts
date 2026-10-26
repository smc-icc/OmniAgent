/** ICC t_icc_skill.MediaTypeID：1=TAS 电话，其余为在线（IMS/WBS/SMS…）。 */
export const TAS_MEDIA_TYPE_ID = 1;

export type MediaKind = 'tas' | 'ims';

export function mediaKind(mediaTypeId: number | null | undefined): MediaKind | null {
  const n = Number(mediaTypeId);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === TAS_MEDIA_TYPE_ID ? 'tas' : 'ims';
}

export function mediaKindLabel(kind: MediaKind): string {
  return kind === 'tas' ? '电话' : '在线';
}

export function uniqueMediaKinds(typeIds: Array<number | null | undefined>): MediaKind[] {
  const set = new Set<MediaKind>();
  for (const id of typeIds) {
    const k = mediaKind(id);
    if (k) set.add(k);
  }
  return [...set];
}
