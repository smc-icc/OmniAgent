import { afterEach, describe, expect, it } from 'vitest';
import {
  clearGroupTree,
  getSignedInSkillIds,
  setGroupTree,
  setSignedInChangeHook,
  setSignedInSkillIds,
} from '../shared/services/agent-skill-groups.js';

describe('agent-skill-groups', () => {
  afterEach(() => {
    setSignedInChangeHook(undefined);
    clearGroupTree(1);
    setSignedInSkillIds(1, []);
  });

  it('无组树时保留签入 id（重启恢复）', () => {
    const next = setSignedInSkillIds(1, ['12', '99']);
    expect(next).toEqual(['12', '99']);
    expect(getSignedInSkillIds(1)).toEqual(['12', '99']);
  });

  it('已有组树时丢掉未知 id', () => {
    setGroupTree(1, [{ id: 12, name: 'IMS' }]);
    expect(setSignedInSkillIds(1, ['12', '99'])).toEqual(['12']);
  });
});
