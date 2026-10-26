import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
// Execute the actual handler in isolation; avoid booting unrelated channel/Redis modules.
function updater(prisma: unknown) {
  const source = readFileSync(
    new URL(
      "../../modules/platform_config/platform_config.routes.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const file = ts.createSourceFile(
    "routes.ts",
    source,
    ts.ScriptTarget.ES2023,
    true,
  );
  const decl = file.statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) && s.name?.text === "updateSystemParam",
  );
  if (!decl) throw Error("Handler missing");
  const text = ts.transpileModule(
    decl.getText(file).replace(/^export\s+/, ""),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
  return new Function(
    "prisma",
    "MANAGED_PUSH_CONFIG_KEY",
    `${text};return updateSystemParam;`,
  )(prisma, "push_accounts_v1");
}
function reply() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    code(n: number) {
      this.statusCode = n;
      return this;
    },
    send(v: unknown) {
      this.payload = v;
      return this;
    },
  };
}
it("generic parameter writes cannot erase or advance managed push snapshots", async () => {
  const calls: unknown[] = [];
  const run = updater({
    platform_configs: { upsert: async (v: unknown) => calls.push(v) },
  });
  const out = reply();
  await run(
    {
      params: { key: "push_accounts_v1" },
      body: {
        value: JSON.stringify({
          revision: Number.MAX_SAFE_INTEGER,
          accounts: [],
        }),
      },
    },
    out,
  );
  expect(out.statusCode).toBe(403);
  expect(calls).toHaveLength(0);
});
it("ordinary parameter updates retain existing behavior", async () => {
  const calls: unknown[] = [];
  const run = updater({
    platform_configs: { upsert: async (v: unknown) => calls.push(v) },
  });
  const out = reply();
  await run(
    { params: { key: "display_refresh_seconds" }, body: { value: "30" } },
    out,
  );
  expect(out.statusCode).toBe(200);
  expect(calls).toHaveLength(1);
});
