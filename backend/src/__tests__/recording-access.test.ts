import { describe, expect, it } from 'vitest';
import { resolveRemoteRecordingPath } from '../shared/services/recording-path.js';

const cfg = {
  remote_root: '/usr/local/freeswitch-1.10.12/var/lib/freeswitch/recordings',
};

describe('resolveRemoteRecordingPath', () => {
  it('keeps absolute path under remote_root', () => {
    const p = '/usr/local/freeswitch-1.10.12/var/lib/freeswitch/recordings/smc_icc_record/ag_1_2_3.wav';
    expect(resolveRemoteRecordingPath(cfg, p)).toBe(p);
  });

  it('rejects path traversal', () => {
    expect(() => resolveRemoteRecordingPath(cfg, '../etc/passwd')).toThrow('invalid recording path');
  });

  it('joins relative file name under smc_icc_record', () => {
    expect(resolveRemoteRecordingPath(cfg, '/tmp/ag_1.wav')).toBe(
      '/usr/local/freeswitch-1.10.12/var/lib/freeswitch/recordings/smc_icc_record/ag_1.wav',
    );
  });
});
