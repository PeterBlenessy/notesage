// Spike marker extension: proves TS extension loading inside the Bun-compiled
// pi binary under the sandbox. Type-only import (erased at runtime).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
const MARKER = process.env.SPIKE_MARKER_FILE ?? "/tmp/pi-spike-marker.txt";
export default function (pi: ExtensionAPI) {
  fs.writeFileSync(MARKER, `loaded pid=${process.pid}\n`);
  pi.on("tool_call", async (event, ctx) => {
    fs.appendFileSync(MARKER, `tool_call:${event.toolName}:hasUI=${ctx.hasUI}\n`);
    return undefined;
  });
}
