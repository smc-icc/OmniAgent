import { describe, expect, it } from 'vitest';
import { pickNonEmptyWorkNo, resolveCcsWorkNo } from '../integrations/ccs/ccs-workno.js';

describe('resolveCcsWorkNo', () => {
  it('uses uid when CCS_WORK_NO_FIELD=uid', () => {
    expect(resolveCcsWorkNo({ id: 1, uid: '1001' }, 'uid')).toBe('1001');
  });

  it('falls back to user id when uid is empty', () => {
    expect(resolveCcsWorkNo({ id: 42, uid: '' }, 'uid')).toBe('42');
    expect(resolveCcsWorkNo({ id: 42, uid: null }, 'uid')).toBe('42');
  });

  it('decodes namespaced managed identity without sending the namespace to CCS', () => {
    expect(resolveCcsWorkNo({ id: 99, uid: 'conf-vdn:2:20:2001' }, 'uid')).toBe('2001');
    expect(resolveCcsWorkNo({ id: 99, uid: 'conf-vdn:2:20:a%3Ab' }, 'id')).toBe('a:b');
    expect(resolveCcsWorkNo({ id: 99, uid: 'conf-vdn:2:20:%GG' }, 'uid')).toBe('');
  });

  it('pickNonEmptyWorkNo skips empty strings', () => {
    expect(pickNonEmptyWorkNo('', '1001', '2002')).toBe('1001');
    expect(pickNonEmptyWorkNo(undefined, null, '3003')).toBe('3003');
    expect(pickNonEmptyWorkNo('', '  ', '')).toBe('');
  });
});
