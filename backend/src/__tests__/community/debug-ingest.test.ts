import { afterEach, describe, it, expect, vi } from "vitest";
import { agentDbg } from "../../modules/itr/debug-ingest.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("public source debug telemetry", () => {
  it("does not send any diagnostic data unless explicitly configured", () => {
    vi.stubEnv("SMC_DEBUG_INGEST_URL", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    agentDbg("h", "test", "hello", { customer: "private" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses only an explicitly configured HTTP endpoint and contains no fixed developer session", async () => {
    vi.stubEnv("SMC_DEBUG_INGEST_URL", "http://127.0.0.1:7705/debug");
    const fetch = vi.fn().mockResolvedValue({});
    vi.stubGlobal("fetch", fetch);
    agentDbg("h", "test", "hello", { count: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:7705/debug");
    const options = fetch.mock.calls[0][1];
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(options.body)).not.toHaveProperty("sessionId");
  });
  it("ignores invalid endpoints and never throws into the caller", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const url of [
      "file:///tmp/debug",
      "ftp://example.invalid/debug",
      "not-a-url",
    ]) {
      vi.stubEnv("SMC_DEBUG_INGEST_URL", url);
      expect(() => agentDbg("h", "test", "hello", {})).not.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("runtime sources do not contain hardcoded developer ingestion endpoints", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const base = path.resolve("src");
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name === "__tests__") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".ts")) {
        const text = await fs.readFile(full, "utf8");
        if (
          /https?:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal):[0-9]+\/ingest\//.test(
            text,
          )
        )
          hits.push(path.relative(base, full));
      }
    }
  }
  await walk(base);
  expect(hits).toEqual([]);
});
