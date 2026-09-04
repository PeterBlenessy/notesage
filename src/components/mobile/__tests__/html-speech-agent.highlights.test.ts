// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withSpeechAgent } from "@/components/mobile/html-speech-agent";
import { htmlToSpeechText, splitSpeechParagraphs } from "@/components/mobile/speech-text";

/**
 * The CSS Custom Highlight API path — what every current WKWebView takes.
 * jsdom has none of it, so a Map stands in for `CSS.highlights` and a class
 * that keeps its ranges for `Highlight`; installed BEFORE the agent boots,
 * because it decides the path once.
 */
class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}
const highlights = new Map<string, FakeHighlight>();

const PAGE = `<html><body><h1>Q3 results</h1><p>Revenue <b>grew</b> nine percent.</p><p>Costs fell.</p></body></html>`;
const send = (msg: Record<string, unknown>) =>
  window.dispatchEvent(new CustomEvent("notesage:speech-agent", { detail: msg }));
const text = (name: string) => highlights.get(name)?.ranges.map((r) => r.toString()).join("") ?? null;

describe("html-speech-agent with the Highlight API", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "CSS", { value: { highlights }, configurable: true });
    Object.defineProperty(globalThis, "Highlight", { value: FakeHighlight, configurable: true });
    document.body.innerHTML = PAGE.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
    const agent = withSpeechAgent("").replace(/^[\s\S]*?<script>/, "").replace(/<\/script>[\s\S]*$/, "");
    // eslint-disable-next-line no-new-func
    new Function(agent)();
  });
  beforeEach(() => {
    highlights.clear();
    send({ type: "paragraphs", items: splitSpeechParagraphs(htmlToSpeechText(PAGE)) });
  });

  it("registers the paragraph and the word as highlights, and never touches the DOM", () => {
    const before = document.body.innerHTML;
    send({ type: "position", index: 1, location: 13, length: 4 });
    expect(text("ns-speech-para")).toBe("Revenue grew nine percent.");
    expect(text("ns-speech-word")).toBe("nine");
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll("mark").length).toBe(0);
  });

  it("moving on replaces both; clear removes both", () => {
    send({ type: "position", index: 1, location: 0, length: 7 });
    send({ type: "position", index: 2 });
    expect(text("ns-speech-para")).toBe("Costs fell.");
    expect(highlights.has("ns-speech-word")).toBe(false);
    send({ type: "clear" });
    expect(highlights.size).toBe(0);
  });
});
