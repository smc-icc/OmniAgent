import { describe, expect, it } from 'vitest';
import {
  matchRecordFile,
  parseAgRecordingName,
  phonesOverlap,
} from '../shared/services/recording-match.js';

describe('parseAgRecordingName', () => {
  it('parses CCS recording file names', () => {
    expect(parseAgRecordingName('smc_icc_record/ag_10599_4_1787478869.wav')).toEqual({
      agentId: 10599,
      recCh: 4,
      unixSec: 1787478869,
    });
  });

  it('rejects other names', () => {
    expect(parseAgRecordingName('hold.wav')).toBeNull();
  });
});

describe('phonesOverlap', () => {
  it('matches either caller or called', () => {
    expect(phonesOverlap('1001', '95001', '1001', '9001')).toBe(true);
    expect(phonesOverlap('1001', '95001', '2002', '9001')).toBe(false);
  });
});

describe('matchRecordFile', () => {
  const cdr = {
    caller: '1001',
    called: '95001',
    beginSec: 1787478865,
    endSec: 1787478920,
    talkSec: 55,
    logicNo: 4,
  };

  it('prefers a database RecordFile aligned by time', () => {
    const path = matchRecordFile(cdr, [
      {
        caller: '1001',
        called: '95001',
        beginSec: 1787478865,
        recordFile: 'smc_icc_record/from_db.wav',
      },
    ], [
      { relPath: 'smc_icc_record/ag_10599_4_1787478869.wav', unixSec: 1787478869, recCh: 4 },
    ]);
    expect(path).toBe('smc_icc_record/from_db.wav');
  });

  it('falls back to FS filename unix window', () => {
    const path = matchRecordFile(cdr, [], [
      { relPath: 'smc_icc_record/ag_10599_4_1787478869.wav', unixSec: 1787478869, recCh: 4 },
      { relPath: 'smc_icc_record/ag_10599_6_1787411714.wav', unixSec: 1787411714, recCh: 6 },
    ]);
    expect(path).toBe('smc_icc_record/ag_10599_4_1787478869.wav');
  });

  it('returns null when nothing is in the time window', () => {
    expect(matchRecordFile(cdr, [], [
      { relPath: 'smc_icc_record/ag_10599_6_1787411714.wav', unixSec: 1787411714, recCh: 6 },
    ])).toBeNull();
  });
});
