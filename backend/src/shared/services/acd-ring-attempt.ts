/** ACD may emit RingAck before its synchronous DoRing response arrives. */
type Attempt = { result: Promise<number> };
const pending = new Map<number, Attempt>();
export function beginRingAttempt(requestId: number): (result: number) => void {
  let resolve!: (result: number) => void;
  const attempt: Attempt = { result: new Promise<number>(done => { resolve = done; }) };
  pending.set(requestId, attempt);
  return result => {
    resolve(result);
    if (pending.get(requestId) === attempt) pending.delete(requestId);
  };
}
/** Rejected RPCs belong to the synchronous caller; do not route the same failure again. */
export async function ringWasRejected(requestId: number): Promise<boolean> {
  const attempt = pending.get(requestId);
  return attempt ? (await attempt.result) !== 0 : false;
}
