import { describe, expect, it } from 'vitest';
import { displayGroupName, buildTreeFromGroups } from '../shared/services/agent-skill-groups.js';

describe('displayGroupName', () => {
  it('formats as 组名(ID)', () => {
    expect(displayGroupName('热线组', 2)).toBe('热线组(2)');
    expect(displayGroupName('平台开发组', 10)).toBe('平台开发组(10)');
  });

  it('does not double-append if name already has id', () => {
    expect(displayGroupName('热线组(2)', 2)).toBe('热线组(2)');
    expect(displayGroupName('热线组（2）', 2)).toBe('热线组(2)');
  });

  it('falls back when name empty', () => {
    expect(displayGroupName('', 3)).toBe('技能组3(3)');
  });

  it('skips fake ids used by 全部/其他', () => {
    expect(displayGroupName('全部', -1)).toBe('全部');
    expect(displayGroupName('其他排队', -2)).toBe('其他排队');
  });

  it('buildTreeFromGroups uses 组名(ID) labels', () => {
    const tree = buildTreeFromGroups([{ id: 2, name: '投诉组' }]);
    expect(tree[0].label).toBe('投诉组(2)');
  });
});
