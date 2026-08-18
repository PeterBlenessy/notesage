// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withLinkAgent } from "@/components/mobile/html-link-agent";

/**
 * Executes the injected link agent for real (jsdom): the script is what runs
 * inside a sandboxed HTML report, where the app cannot reach — so the agent's
 * own behaviour is the only link handling there is.
 */

function bootAgent() {
  const body = withLinkAgent("").replace(/<\/?script>/g, "");
  // eslint-disable-next-line no-eval
  window.eval(body);
}

function touch(target: Element, x: number, y: number) {
  return { clientX: x, clientY: y, target } as unknown as Touch;
}

function fireTouch(type: string, target: Element, x = 0, y = 0) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: [touch(target, x, y)] });
  Object.defineProperty(e, "target", { value: target });
  target.dispatchEvent(e);
}

describe("HTML link agent", () => {
  let sent: Array<{ href: string; menu: boolean }>;
  let booted = false;

  beforeEach(() => {
    document.body.innerHTML = "";
    sent = [];
    // Boot and subscribe exactly once. A listener per test would push the
    // same message once per preceding test, and every whole-array assertion
    // below would count duplicates.
    if (!booted) {
      // In jsdom window.parent === window, so agent posts land here.
      window.addEventListener("message", (e: MessageEvent) => {
        const d = e.data as { ns?: string; type?: string; href?: string; menu?: boolean };
        if (d?.ns === "notesage-link" && d.type === "open") {
          sent.push({ href: d.href ?? "", menu: d.menu === true });
        }
      });
      bootAgent();
      booted = true;
    }
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  function click(el: Element) {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  it("reports a clicked link instead of letting the frame navigate", async () => {
    document.body.innerHTML = '<a id="l" href="./page2.html">next</a>';
    const a = document.getElementById("l")!;
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(sent).toEqual([{ href: "./page2.html", menu: false }]));
  });

  it("reports a click on an element nested inside the link", async () => {
    document.body.innerHTML = '<a href="a.html"><span><b id="deep">go</b></span></a>';
    click(document.getElementById("deep")!);
    await vi.waitFor(() => expect(sent[0]?.href).toBe("a.html"));
  });

  it("leaves in-page anchors to the document", () => {
    document.body.innerHTML = '<a id="l" href="#section">jump</a>';
    const a = document.getElementById("l")!;
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(e);
    // Not reported, and not prevented — the document scrolls itself.
    expect(sent).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it("ignores clicks that are not on a link, and links with no href", () => {
    document.body.innerHTML = '<p id="p">text</p><a id="a">no href</a>';
    click(document.getElementById("p")!);
    click(document.getElementById("a")!);
    expect(sent).toEqual([]);
  });

  it("asks for a menu after a long press", async () => {
    document.body.innerHTML = '<a id="l" href="b.html">b</a>';
    const a = document.getElementById("l")!;
    fireTouch("touchstart", a, 10, 10);
    await vi.advanceTimersByTimeAsync(600);
    await vi.waitFor(() => expect(sent).toEqual([{ href: "b.html", menu: true }]));
  });

  it("swallows the click that follows a long press", async () => {
    // Otherwise the target opens as well as the menu appearing.
    document.body.innerHTML = '<a id="l" href="b.html">b</a>';
    const a = document.getElementById("l")!;
    fireTouch("touchstart", a, 10, 10);
    await vi.advanceTimersByTimeAsync(600);
    fireTouch("touchend", a, 10, 10);
    click(a);
    await vi.waitFor(() => expect(sent).toEqual([{ href: "b.html", menu: true }]));
  });

  it("does not fire the menu when the finger moves — that is a scroll", async () => {
    document.body.innerHTML = '<a id="l" href="b.html">b</a>';
    const a = document.getElementById("l")!;
    fireTouch("touchstart", a, 10, 10);
    fireTouch("touchmove", a, 10, 60);
    await vi.advanceTimersByTimeAsync(600);
    expect(sent).toEqual([]);
  });

  it("does not fire the menu when the finger lifts early — that is a tap", async () => {
    document.body.innerHTML = '<a id="l" href="b.html">b</a>';
    const a = document.getElementById("l")!;
    fireTouch("touchstart", a, 10, 10);
    fireTouch("touchend", a, 10, 10);
    await vi.advanceTimersByTimeAsync(600);
    expect(sent.filter((s) => s.menu)).toEqual([]);
  });

  it("closes a dangling <script> in the report before appending the agent", () => {
    // An unclosed <script> would otherwise swallow the agent element whole
    // and silently kill link handling for that file.
    const out = withLinkAgent("<p>x</p><script>var a = 1");
    const opens = (out.match(/<script/gi) ?? []).length;
    const closes = (out.match(/<\/script/gi) ?? []).length;
    expect(closes).toBe(opens);
    expect(out.indexOf("</script>")).toBeLessThan(out.indexOf("notesage-link"));
  });

  it("adds nothing extra to well-formed reports", () => {
    const out = withLinkAgent("<p>fine</p><script>ok()</script>");
    expect(out.startsWith("<p>fine</p><script>ok()</script>\n<script>")).toBe(true);
  });
});
