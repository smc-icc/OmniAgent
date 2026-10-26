import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../docs/knowledge/synthetic');
await mkdir(root, { recursive: true });
const categories = ['faq', 'text', 'table', 'scanned', 'conflicting-policy', 'expired-policy'];
const docs = [];
for (let i = 1; i <= 30; i++) {
  const id = `SYN-DOC-${String(i).padStart(3, '0')}`;
  const category = categories[(i - 1) % categories.length];
  const content = `# 合成业务资料 ${i}\n\n资料编号：${id}\n类别：${category}\n适用租户：tenant-${(i % 3) + 1}\n适用 VDN：vdn-${(i % 4) + 1}\n\n## 处理规则\n客户提交工单后，系统应在 2 个工作日内完成首次响应。紧急故障转人工坐席，普通咨询进入知识库检索流程。\n\n## 费用与时效\n标准服务费为 ${i * 10} 元，资料有效期至 2027-12-31。超过有效期的政策必须拒答并提示人工确认。\n\n本文件为 synthetic 测试资料，不代表真实业务政策。`;
  const file = `${id}.md`;
  await writeFile(resolve(root, file), content, 'utf8');
  docs.push({ id, file, title: `合成业务资料 ${i}`, category, tenantId: `tenant-${(i % 3) + 1}`, vdnId: `vdn-${(i % 4) + 1}`, contentSha256: createHash('sha256').update(content).digest('hex'), approvalStatus: 'synthetic-only', publishedForCustomer: false });
}
await writeFile(resolve(root, 'documents.json'), JSON.stringify({ dataset: 'omni-knowledge-synthetic-v1', provenance: 'synthetic', generatedAt: new Date().toISOString(), documents: docs }, null, 2));
const cases = [];
for (let i = 1; i <= 100; i++) {
  const category = i <= 60 ? 'answerable' : i <= 80 ? 'table_or_location' : 'unsupported_or_conflict';
  const doc = `SYN-DOC-${String(((i - 1) % 30) + 1).padStart(3, '0')}`;
  cases.push({ id: `SYN-EVAL-${String(i).padStart(3, '0')}`, category, question: category === 'unsupported_or_conflict' ? `合成资料之外的政策问题 ${i} 应如何处理？` : `资料 ${doc} 的首次响应时限是多少？`, expectedDocumentIds: category === 'unsupported_or_conflict' ? [] : [doc], expectedAnswer: category === 'unsupported_or_conflict' ? '拒答并提示人工确认，资料不足。' : '2 个工作日内完成首次响应。', expectedLocations: category === 'table_or_location' ? [{ documentId: doc, page: 1, section: '处理规则' }] : [], reviewer: 'synthetic-fixture', reviewStatus: 'synthetic-only' });
}
await writeFile(resolve(root, 'evaluation-cases.jsonl'), cases.map(x => JSON.stringify(x)).join('\n') + '\n');
console.log(JSON.stringify({ provenance: 'synthetic', documents: docs.length, cases: cases.length, output: root }));
