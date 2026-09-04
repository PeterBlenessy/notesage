import { installSpeechHighlight } from "./speech-highlight-core";

/**
 * Read-aloud highlight agent, injected into a saved page (#833).
 *
 * The page is a bridge-less native web view or a sandboxed cross-origin
 * iframe, so the marks can only be drawn from inside it: the shared
 * `installSpeechHighlight` is serialised into the page with `toString()`
 * (which is why that function references nothing outside itself) and
 * driven by messages the agent LISTENS for:
 *
 *   iframe:  parent → frame  postMessage { ns: "notesage-speech", ...msg }
 *   native:  a `notesage:speech-agent` CustomEvent with `detail: msg`
 *
 *   { type: "paragraphs", items: string[] }   the utterances, in order
 *   { type: "position", index, location?, length? }
 *   { type: "clear" }
 */
function agentScript(): string {
  return `
<script>
(function () {
  "use strict";
  var install = ${installSpeechHighlight.toString()};
  var api = install(document.body || document.documentElement, { injectStyle: true, allowWrap: true });
  function handle(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "paragraphs" && Array.isArray(msg.items)) { api.setParagraphs(msg.items); return; }
    if (msg.type === "position" && typeof msg.index === "number") { api.position(msg.index, msg.location, msg.length); return; }
    if (msg.type === "clear") api.clear();
  }
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || d.ns !== "notesage-speech") return;
    handle(d);
  });
  window.addEventListener("notesage:speech-agent", function (e) { handle(e.detail); });
})();
</script>
`;
}

/** Append the read-aloud agent to a saved page (see `withFindAgent` for the
 *  dangling-`<script>` guard). */
export function withSpeechAgent(raw: string): string {
  const opens = (raw.match(/<script\b/gi) ?? []).length;
  const closes = (raw.match(/<\/script/gi) ?? []).length;
  const guard = opens > closes ? "</script>".repeat(opens - closes) : "";
  return raw + guard + agentScript();
}
