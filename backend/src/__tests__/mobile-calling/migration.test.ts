import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(
  new URL("../../../scripts/migrate-mobile-calling.mjs", import.meta.url),
);
it("migration defaults to a connection-free dry run even when a database URL exists", () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL:
        "mysql://sensitive-user:private-password@unreachable.invalid/live",
    },
  });
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.mode).toBe("dry-run");
  expect(report.databaseWrites).toBe(false);
  expect(report.tables).toHaveLength(6);
  expect(result.stdout + result.stderr).not.toContain("private-password");
});
it("refuses apply without an explicitly named target schema", () => {
  const result = spawnSync(process.execPath, [script, "--apply"], {
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("--expect-database");
});
