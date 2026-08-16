/**
 * WebKit (Safari/WKWebView — so every Tauri window on macOS AND iOS) does not
 * implement async iteration of ReadableStream (`for await (const x of stream)`
 * throws "undefined is not a function"). pdf.js ≥ 4 relies on it inside
 * `getTextContent()` — the pdfjs-dist advisory bump silently broke PDF text
 * search on all WebKit platforms. This installs the standard `values()` /
 * `Symbol.asyncIterator` shape when missing (spec: streams.spec.whatwg.org,
 * "Asynchronous iteration").
 */

type AsyncIterableReadableStream<R> = ReadableStream<R> & {
  values?: (options?: { preventCancel?: boolean }) => AsyncIterableIterator<R>;
};

export function makeStreamIterator<R>(
  stream: ReadableStream<R>,
  { preventCancel = false }: { preventCancel?: boolean } = {},
): AsyncIterableIterator<R> {
  const reader = stream.getReader();
  const iterator: AsyncIterableIterator<R> = {
    async next(): Promise<IteratorResult<R>> {
      try {
        const result = await reader.read();
        if (result.done) reader.releaseLock();
        return result as IteratorResult<R>;
      } catch (err) {
        reader.releaseLock();
        throw err;
      }
    },
    async return(value?: R): Promise<IteratorResult<R>> {
      if (preventCancel) {
        reader.releaseLock();
      } else {
        const cancel = reader.cancel(value);
        reader.releaseLock();
        await cancel;
      }
      return { done: true, value: value as R };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return iterator;
}

/** Install onto a ReadableStream prototype when async iteration is missing. */
export function installReadableStreamAsyncIterator(
  proto: AsyncIterableReadableStream<unknown> = ReadableStream.prototype,
): void {
  const target = proto as unknown as Record<PropertyKey, unknown>;
  if (typeof target[Symbol.asyncIterator] === "function") return;
  const values = function (
    this: ReadableStream<unknown>,
    options?: { preventCancel?: boolean },
  ) {
    return makeStreamIterator(this, options);
  };
  target.values = values;
  target[Symbol.asyncIterator] = values;
}

if (typeof ReadableStream !== "undefined") {
  installReadableStreamAsyncIterator();
}
