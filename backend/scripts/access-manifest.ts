import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { permissionCatalog } from '../src/modules/access/access.catalog.js';
import { routePolicy } from '../src/modules/access/access.route-policy.js';
import { ccsPermissions } from '../src/modules/access/access.ccs.js';
const root = path.resolve('src');
const routes: { method: string; path: string; file: string; policy: unknown }[] = [];
function scan(dir: string) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== '__tests__') scan(file); continue; }
    if (!f.name.endsWith('.ts')) continue;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const constants = new Map<string, string>();
    function str(n?: ts.Node): string | undefined {
      if (!n) return;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
      if (ts.isIdentifier(n)) return constants.get(n.text);
      if (ts.isTemplateExpression(n)) {
        let result = n.head.text;
        for (const span of n.templateSpans) { const value = str(span.expression); if (value === undefined) return; result += value + span.literal.text; }
        return result;
      }
    }
    function visit(n: ts.Node) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) { const value = str(n.initializer); if (value !== undefined) constants.set(n.name.text, value); }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text.toUpperCase();
        const receiver = n.expression.expression.getText(source);
        if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && ['app', 'fastify'].includes(receiver)) {
          const url = str(n.arguments[0]);
          if (!url) throw new Error(`Cannot resolve route ${file}: ${n.getText(source).slice(0, 100)}`);
          routes.push({ method, path: url, file: path.relative(root, file).replaceAll('\\', '/'), policy: routePolicy(method, url) ?? null });
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(source);
  }
}
scan(root);
const missing = routes.filter(r => !r.policy);
const invalid = routes.filter(r => { const p = (r.policy as any)?.permission; return p && p !== 'access.manage' && !permissionCatalog.some(c => c.code === p); });
console.log(JSON.stringify({ routes: routes.length, missing, invalid }, null, 2));
mkdirSync('../docs', { recursive: true });
writeFileSync('../docs/access-route-matrix.json', JSON.stringify(routes, null, 2) + '\n');
writeFileSync('src/modules/access/access-catalog.json', JSON.stringify(permissionCatalog, null, 2) + '\n');
mkdirSync('../frontend/src/generated', { recursive: true });
writeFileSync('../frontend/src/generated/access-routes.json', JSON.stringify(routes.map(({ method, path, policy }) => ({ method, path, policy })), null, 2) + '\n');
writeFileSync('../frontend/src/generated/access-ccs.json', JSON.stringify(ccsPermissions, null, 2) + '\n');
if (missing.length || invalid.length) process.exitCode = 1;
