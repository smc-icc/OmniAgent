/** JSONPath 子集：`$` 整对象，`$.a.b` 字段。 */

export function getJsonPath(root: unknown, path: string): unknown {
  const p = path.trim();
  if (p === '$') return root;
  if (!p.startsWith('$.')) throw new Error(`不支持的 JSONPath: ${path}`);
  const parts = p.slice(2).split('.');
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
