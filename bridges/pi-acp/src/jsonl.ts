// LF-delimited JSONL framing for the pi RPC channel.
//
// pi --mode rpc speaks strict one-JSON-object-per-line over stdio. The decoder
// is incremental: feed it raw chunks (which may split or merge lines
// arbitrarily) and it yields parsed objects in order. Non-JSON lines are
// surfaced through `onNonJson` rather than thrown — pi must never be able to
// wedge the bridge with a stray diagnostic line on stdout.

export function encodeJsonl(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

export class JsonlDecoder {
  private buf = "";

  constructor(private readonly onNonJson?: (line: string) => void) {}

  /** Feed a chunk; returns every complete JSON value that became available. */
  push(chunk: string | Buffer): unknown[] {
    this.buf += chunk.toString();
    const out: unknown[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        this.onNonJson?.(line);
      }
    }
    return out;
  }

  /** Bytes currently buffered without a terminating newline. */
  get pending(): number {
    return this.buf.length;
  }
}
