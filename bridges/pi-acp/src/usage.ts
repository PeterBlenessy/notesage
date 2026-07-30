// Best-effort usage reporting (task #10): pi get_session_stats → ACP
// usage_update. Never fails a turn — a missing/changed stats shape degrades to
// "no update". pi's contextUsage maps directly onto ACP's {used, size}; the
// session cost (USD) rides along when present.
import type { PiRpc } from "./pi-rpc";
import type { SessionUpdate } from "./translate";

export async function usageUpdateFromStats(pi: PiRpc): Promise<SessionUpdate | null> {
  try {
    const stats = await pi.request({ type: "get_session_stats" });
    const data = stats.data as
      | { contextUsage?: { tokens?: unknown; contextWindow?: unknown } | null; cost?: unknown }
      | undefined;
    const cu = data?.contextUsage;
    if (!cu || typeof cu.tokens !== "number" || typeof cu.contextWindow !== "number" || cu.contextWindow <= 0) {
      return null; // omitted pre-model, or tokens null right after compaction
    }
    return {
      sessionUpdate: "usage_update",
      used: cu.tokens,
      size: cu.contextWindow,
      ...(typeof data?.cost === "number" ? { cost: { amount: data.cost, currency: "USD" } } : {}),
    };
  } catch {
    return null;
  }
}
