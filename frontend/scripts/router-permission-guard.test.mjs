import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8')
// Execute the real guard with isolated stores, without mounting Vue or making requests.
const isolated = ts.transform(ts.createSourceFile('router.ts', source, ts.ScriptTarget.ES2022, true),
  [context => root => {
    const visit = node => ts.isMetaProperty(node)
      ? ts.factory.createObjectLiteralExpression([ts.factory.createPropertyAssignment('env',
        ts.factory.createObjectLiteralExpression([ts.factory.createPropertyAssignment('BASE_URL', ts.factory.createStringLiteral('/'))]))])
      : ts.visitEachChild(node, visit, context)
    return ts.visitEachChild(ts.factory.updateSourceFile(root,
      root.statements.filter(s => !ts.isImportDeclaration(s) && !ts.isExportAssignment(s))), visit, context)
  }])
const { outputText } = ts.transpileModule(ts.createPrinter().printFile(isolated.transformed[0]), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
isolated.dispose()
function harness({ mobile = true, loggedIn = true, allowed = [], blockedModules = [] } = {}) {
  let guard, routes
  vm.runInNewContext(outputText, {
    exports: {}, MainLayout: {}, MobileLayout: {}, pagePermissions: {},
    createWebHistory: () => ({}),
    createRouter: options => { routes = options.routes; return { beforeEach: fn => { guard = fn } } },
    useMobileLayout: () => mobile,
    useAuthStore: () => ({ isLoggedIn: loggedIn, autoLogin: async () => true,
      startSocket: async () => {}, ensureCcsSessionAlive: async () => 'ok' }),
    useProductModulesStore: () => ({ refresh: async () => {}, canVisit: path => !blockedModules.includes(path) }),
    useAccessStore: () => ({ refresh: async () => {}, can: code => allowed.includes(code) }),
  })
  return { guard, routes }
}
const target = (path, permission) => ({ path, fullPath: path, meta: permission ? { permission } : {}, query: {} })
test('mobile denied routes land on a permission-free page without a redirect loop', async () => {
  for (const loggedIn of [true, false]) {
    const { guard, routes } = harness({ loggedIn })
    const denied = await guard(target('/m/sessions', 'conversation.read'))
    assert.equal(denied.path, '/m/profile')
    assert.equal(await guard(target(denied.path)), true)
    const profile = routes.find(r => r.path === '/m').children.find(r => r.path === 'profile')
    assert.equal(profile.meta.permission, undefined)
  }
})
test('desktop denied routes retain their existing dashboard fallback', async () => {
  const { guard } = harness({ mobile: false })
  assert.equal((await guard(target('/knowledge', 'knowledge.read'))).path, '/')
})
test('authorized mobile knowledge route remains accessible', async () => {
  const { guard } = harness({ allowed: ['knowledge.read'] })
  assert.equal(await guard(target('/m/knowledge', 'knowledge.read')), true)
  assert.equal((await guard(target('/knowledge', 'knowledge.read'))).path, '/m/knowledge')
})

test('disabled ICC blocks mobile deep links before voice session hydration',async()=>{const{guard}=harness({blockedModules:['/m/dialer']});assert.equal((await guard(target('/m/dialer'))).path,'/m/sessions')});
test('disabled commercial desktop pages return to the base workbench',async()=>{const{guard}=harness({mobile:false,blockedModules:['/outbound']});assert.equal((await guard(target('/outbound'))).path,'/omnichannel')});
