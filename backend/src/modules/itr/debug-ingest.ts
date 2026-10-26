/** Optional local diagnostics. Disabled unless the operator supplies an endpoint. */
export function agentDbg(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  const endpoint = process.env.SMC_DEBUG_INGEST_URL?.trim();
  if (!endpoint) return;
  try {
    const url = new URL(endpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    const body = JSON.stringify({
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    });
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(1000),
    }).catch(() => {});
  } catch {
    // Diagnostic failures must not interrupt customer workflows.
  }
}
