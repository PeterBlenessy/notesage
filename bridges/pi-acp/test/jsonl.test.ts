import { describe, expect, it } from "vitest";
import { encodeJsonl, JsonlDecoder } from "../src/jsonl";

describe("encodeJsonl", () => {
  it("terminates with exactly one LF", () => {
    expect(encodeJsonl({ type: "prompt" })).toBe('{"type":"prompt"}\n');
  });
});

describe("JsonlDecoder", () => {
  it("decodes multiple objects from one chunk", () => {
    const d = new JsonlDecoder();
    expect(d.push('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("reassembles an object split across chunks", () => {
    const d = new JsonlDecoder();
    expect(d.push('{"type":"agent')).toEqual([]);
    expect(d.pending).toBeGreaterThan(0);
    expect(d.push('_start"}\n')).toEqual([{ type: "agent_start" }]);
    expect(d.pending).toBe(0);
  });

  it("skips empty lines", () => {
    const d = new JsonlDecoder();
    expect(d.push('\n\n{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it("routes non-JSON lines to onNonJson without throwing", () => {
    const stray: string[] = [];
    const d = new JsonlDecoder((l) => stray.push(l));
    expect(d.push('garbage line\n{"a":1}\n')).toEqual([{ a: 1 }]);
    expect(stray).toEqual(["garbage line"]);
  });

  it("handles Buffer input", () => {
    const d = new JsonlDecoder();
    expect(d.push(Buffer.from('{"a":1}\n'))).toEqual([{ a: 1 }]);
  });
});
