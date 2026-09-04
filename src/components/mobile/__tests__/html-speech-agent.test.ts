// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { withSpeechAgent } from "@/components/mobile/html-speech-agent";
import { htmlToSpeechText, splitSpeechParagraphs } from "@/components/mobile/speech-text";

let agentBooted = false;
/** Load the page into the test document; run the agent's script ONCE per
 *  file (its listeners live on the shared window — a second boot would
 *  answer every message twice). */
function boot(html: string): void {
  const body = html.slice(html.indexOf("<body"));
  document.body.innerHTML = body.replace(/^<body[^>]*>/, "").replace(/<\/body>[\s\S]*$/, "");
  if (agentBooted) return;
  agentBooted = true;
  const agent = withSpeechAgent("").replace(/^[\s\S]*?<script>/, "").replace(/<\/script>[\s\S]*$/, "");
  // eslint-disable-next-line no-new-func
  new Function(agent)();
}

const send = (msg: Record<string, unknown>) =>
  window.dispatchEvent(new CustomEvent("notesage:speech-agent", { detail: msg }));

const PAGE = `<html><head><title>T</title><style>p{color:red}</style></head><body>
<h1>Q3   results</h1>
<p>Revenue <b>grew</b> nine percent.</p>
<script>var ignored = "not prose";</script>
<p>Costs fell.
  Margins widened.</p>
</body></html>`;

describe("html-speech-agent (the highlight inside the page)", () => {
  let paragraphs: string[];
  beforeEach(() => {
    boot(PAGE);
    paragraphs = splitSpeechParagraphs(htmlToSpeechText(PAGE));
    send({ type: "paragraphs", items: paragraphs });
  });

  it("splits the page the way the player does, script and style excluded", () => {
    expect(paragraphs).toEqual(["Q3 results", "Revenue grew nine percent.", "Costs fell. Margins widened."]);
  });

  it("marks the paragraph being read across inline elements and odd whitespace", () => {
    send({ type: "position", index: 1 });
    const marks = Array.from(document.querySelectorAll("mark.ns-speech-para"));
    expect(marks.map((m) => m.textContent).join("")).toBe("Revenue grew nine percent.");
    send({ type: "position", index: 2 });
    expect(Array.from(document.querySelectorAll("mark.ns-speech-para")).map((m) => m.textContent).join("")).toBe(
      "Costs fell.\n  Margins widened.",
    );
    // Moving on removes the previous paragraph's marks.
    expect(document.querySelectorAll("mark").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Revenue grew nine percent.");
  });

  it("marks the word from the voice's range within the paragraph", () => {
    const p = paragraphs[1];
    const at = p.indexOf("nine");
    send({ type: "position", index: 1, location: at, length: "nine".length });
    expect(Array.from(document.querySelectorAll("mark.ns-speech-word")).map((m) => m.textContent).join("")).toBe("nine");
    expect(Array.from(document.querySelectorAll("mark.ns-speech-para")).map((m) => m.textContent).join("")).toBe(
      "Revenue grew nine percent.",
    );
  });

  it("clears every mark and leaves the text intact", () => {
    send({ type: "position", index: 0 });
    send({ type: "clear" });
    expect(document.querySelectorAll("mark").length).toBe(0);
    expect(document.body.textContent).toContain("Q3   results");
  });

  it("skips a paragraph it cannot find rather than throwing", () => {
    send({ type: "paragraphs", items: ["Q3 results", "Never in this page", "Costs fell. Margins widened."] });
    expect(() => send({ type: "position", index: 1 })).not.toThrow();
    expect(document.querySelectorAll("mark.ns-speech-para").length).toBe(0);
    send({ type: "position", index: 2 });
    expect(document.querySelectorAll("mark.ns-speech-para").length).toBeGreaterThan(0);
  });

  it("ignores messages from the wrong namespace and malformed ones", async () => {
    window.postMessage({ ns: "notesage-find", type: "position", index: 0 }, "*");
    window.postMessage({ ns: "notesage-speech", type: "position", index: 0 }, "*");
    // postMessage delivers asynchronously; let both land.
    await new Promise((r) => setTimeout(r, 0));
    // The right namespace painted; the wrong one did not add a second mark.
    expect(document.querySelectorAll("mark.ns-speech-para").length).toBeGreaterThan(0);
    send({ type: "clear" });
    send({ type: "position" });
    send(null as unknown as Record<string, unknown>);
    expect(document.querySelectorAll("mark").length).toBe(0);
  });
});
