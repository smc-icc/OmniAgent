import { it, expect } from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(
  new URL('../../../../frontend/src/utils/product-modules.ts', import.meta.url),
  'utf8',
);
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { moduleForPage, moduleForTile } = await import(
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
);
it('page classification keeps the unified message center and core workspaces available', () => {
  expect(moduleForPage('/messages')).toBeNull();
  expect(moduleForPage('/omnichannel')).toBeNull();
  expect(moduleForPage('/m/dialer')).toBe('icc');
  expect(moduleForPage('/monitor')).toBe('icc');
  expect(moduleForPage('/outbound')).toBe('outbound');
});
it('call-center tiles are gated without classifying general online tools as telephony', () => {
  expect(moduleForTile('专项管理')).toBe('icc');
  expect(moduleForTile('报表管理')).toBe('icc');
  expect(moduleForTile('工作备忘录')).toBeNull();
  expect(moduleForTile('公告信息管理')).toBeNull();
});

it('dashboard telephony quick link is hidden without ICC while online tools remain available', () => {
  expect(moduleForTile('话务管理')).toBe('icc');
  expect(moduleForTile('工单管理')).toBeNull();
  expect(moduleForTile('知识库')).toBeNull();
  expect(moduleForPage('/inspection')).toBe('aiqc');
});

it('disabled ICC overrides a saved phone workspace preference without deleting it', async () => {
  const src = fs.readFileSync(new URL('../../../../frontend/src/utils/workspace-channel-preference.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { readWorkspaceChannelPreference } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const storage = { getItem: () => 'phone', setItem: () => { throw Error('reading must not overwrite the preference'); } };
  expect(readWorkspaceChannelPreference({ accountId: 1, userId: 1 }, storage, false)).toBe('media');
  expect(readWorkspaceChannelPreference({ accountId: 1, userId: 1 }, storage, true)).toBe('phone');
});

it('disabling ICC drops new phone offers while preserving release events for existing calls', async () => {
  const { voiceEventAllowed } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
  expect(voiceEventAllowed('OnAgentOnCallOfferedEvt', false)).toBe(false);
  expect(voiceEventAllowed('OnAgentOnCallOfferedEvt', true)).toBe(true);
  expect(voiceEventAllowed('OnAgentOnCallEndedEvt', false)).toBe(true);
  expect(voiceEventAllowed('OnAgentReleaseCallAck', false)).toBe(true);
});
