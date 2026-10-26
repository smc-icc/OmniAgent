export interface ExecutionHooks {
  authorize(): Promise<void>;
  drain(): Promise<void>;
  signOut(): Promise<void>;
  revoke(): Promise<void>;
  commit(): Promise<unknown>;
  notify(): Promise<void>;
  save(phase: string): Promise<void>;
}
/** Side effects run outside transactions. A failed stage keeps the reservation and its retry point. */
export async function runBindingStages(
  op: { phase: string; old_extension: string; target_extension: string },
  hooks: ExecutionHooks,
): Promise<void> {
  if (op.phase === 'done' || op.phase === 'cancelled') return;
  const save = async (next: string) => {
    await hooks.save(next);
    op.phase = next;
  };
  if (op.phase === 'reserved') {
    await hooks.authorize();
    await hooks.drain();
    await save('draining');
  }
  if (op.phase === 'draining') {
    await hooks.authorize();
    await hooks.signOut();
    await save('signed_out');
  }
  if (op.phase === 'signed_out') {
    await hooks.authorize();
    await hooks.revoke();
    await save('credentials_revoked');
  }
  if (op.phase === 'credentials_revoked') {
    await hooks.authorize();
    await hooks.commit();
    op.phase = 'committed';
  }
  if (op.phase === 'committed') {
    await hooks.save('done');
    op.phase = 'done';
    await hooks.notify();
  }
}
