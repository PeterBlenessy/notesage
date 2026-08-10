// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { HTML_FIND_AGENT } from "@/components/mobile/html-find-agent";

/**
 * Executes the injected find agent for real (jsdom): the script is what runs
 * inside a sandboxed HTML report, where the app cannot reach — so the agent's
 * own behaviour is the only search there is.
 */

function bootAgent() {
  const body = HTML_FIND_AGENT.replace(/<\/?script>/g, "");
  // eslint-disable-next-line no-eval
  window.eval(body);
}

function send(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

describe("HTML find agent", () => {
  let replies: Array<{ total: number; current: number }>;
  let booted = false;

  beforeEach(() => {
    document.body.innerHTML = "";
    Element.prototype.scrollIntoView = vi.fn();
    replies = [];
    // In jsdom window.parent === window, so agent replies land here.
    window.addEventListener("message", (e: MessageEvent) => {
      const d = e.data as { ns?: string; type?: string; total?: number; current?: number };
      if (d?.ns === "notesage-find" && d.type === "state") {
        replies.push({ total: d.total ?? -1, current: d.current ?? -1 });
      }
    });
    // Boot exactly once — each eval registers another message listener, and
    // a second instance would see the first one's <mark> wrapping.
    if (!booted) {
      bootAgent();
      booted = true;
    }
  });

  it("wraps every case-insensitive match and reports the count", async () => {
    document.body.innerHTML = "<p>Needle here, and needle there. Not a haystack.</p>";
    send({ ns: "notesage-find", type: "query", q: "needle" });
    const marks = document.querySelectorAll("mark[data-nsfind]");
    expect(marks.length).toBe(2);
    await vi.waitFor(() => expect(replies[replies.length - 1]).toEqual({ total: 2, current: 0 }));
  });

  it("skips script and style text so code never matches", () => {
    document.body.innerHTML =
      "<style>.needle{}</style><script>var needle=1</script><p>needle</p>";
    send({ ns: "notesage-find", type: "query", q: "needle" });
    expect(document.querySelectorAll("mark[data-nsfind]").length).toBe(1);
  });

  it("navigates between matches with wrap-around", async () => {
    document.body.innerHTML = "<p>a needle, b needle, c needle</p>";
    send({ ns: "notesage-find", type: "query", q: "needle" });
    send({ ns: "notesage-find", type: "nav", dir: 1 });
    await vi.waitFor(() => expect(replies[replies.length - 1]).toEqual({ total: 3, current: 1 }));
    send({ ns: "notesage-find", type: "nav", dir: -1 });
    send({ ns: "notesage-find", type: "nav", dir: -1 });
    await vi.waitFor(() => expect(replies[replies.length - 1]).toEqual({ total: 3, current: 2 }));
  });

  it("clears marks and restores the original text on empty query", async () => {
    document.body.innerHTML = "<p>needle in text</p>";
    send({ ns: "notesage-find", type: "query", q: "needle" });
    expect(document.querySelectorAll("mark[data-nsfind]").length).toBe(1);
    send({ ns: "notesage-find", type: "query", q: "" });
    expect(document.querySelectorAll("mark[data-nsfind]").length).toBe(0);
    expect(document.body.textContent).toContain("needle in text");
    await vi.waitFor(() => expect(replies[replies.length - 1]).toEqual({ total: 0, current: 0 }));
  });

  it("ignores messages from other protocols", () => {
    document.body.innerHTML = "<p>needle</p>";
    send({ type: "query", q: "needle" });
    send({ ns: "something-else", type: "query", q: "needle" });
    expect(document.querySelectorAll("mark[data-nsfind]").length).toBe(0);
  });
});
