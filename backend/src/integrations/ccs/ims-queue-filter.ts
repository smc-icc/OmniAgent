/** ACD 排队项是否属于 IMS：技能 MediaType 非 TAS，或已在 Omni queueByConv。 */
export function isImsQueueRow(
  skillId: number,
  logicNo: number,
  imsSkillIds: Set<number>,
  queuedRequestIds: Set<number>,
): boolean {
  if (queuedRequestIds.has(logicNo)) return true;
  if (skillId > 0 && imsSkillIds.has(skillId)) return true;
  return false;
}
