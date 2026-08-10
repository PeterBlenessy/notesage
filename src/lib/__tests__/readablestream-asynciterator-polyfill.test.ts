import { describe, it, expect } from "vitest";
import {
  makeStreamIterator,
  installReadableStreamAsyncIterator,
} from "@/lib/readablestream-asynciterator-polyfill";

function streamOf<R>(chunks: R[]): ReadableStream<R> {
  return new ReadableStream<R>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe("ReadableStream async-iterator polyfill (WebKit)", () => {
  // pdf.js ≥ 4 does `for await (const chunk of page.streamTextContent())`
  // inside getTextContent(); WebKit has no ReadableStream[Symbol.asyncIterator],
  // which broke PDF text search on macOS AND iOS after the pdfjs-dist bump.

  it("iterates all chunks in order via for-await", async () => {
    const seen: number[] = [];
    for await (const chunk of makeStreamIterator(streamOf([1, 2, 3]))) {
      seen.push(chunk);
    }
    expect(seen).toEqual([1, 2, 3]);
  });

  it("cancels the stream when iteration exits early", async () => {
    let cancelled = false;
    const stream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const chunk of makeStreamIterator(stream)) {
      expect(chunk).toBe(1);
      break; // triggers iterator.return()
    }
    expect(cancelled).toBe(true);
  });

  it("installs values + Symbol.asyncIterator on a prototype that lacks them", () => {
    const proto: Record<PropertyKey, unknown> = {};
    installReadableStreamAsyncIterator(proto as never);
    expect(typeof proto[Symbol.asyncIterator]).toBe("function");
    expect(typeof proto.values).toBe("function");
  });

  it("leaves a native implementation untouched", () => {
    const native = () => {};
    const proto: Record<PropertyKey, unknown> = { [Symbol.asyncIterator]: native };
    installReadableStreamAsyncIterator(proto as never);
    expect(proto[Symbol.asyncIterator]).toBe(native);
    expect(proto.values).toBeUndefined();
  });
});
