/*
 * Safari share-sheet preprocessing (PRD 2026-08-21-self-contained-articles).
 *
 * iOS runs this IN THE PAGE'S CONTEXT before the share sheet appears and hands
 * whatever `completionFunction` receives to the extension. That gives us the
 * page as the browser actually rendered it, rather than as a server would
 * serve it to a fetch.
 *
 * Why this exists
 * ---------------
 * We used to receive only the URL and re-fetch the page ourselves. Our fetch
 * runs no JavaScript, so on any site using lazy-loaded images we got the
 * PRE-RENDER DOM — which on a news site means a low-quality placeholder in
 * `src` and the real URL nowhere in the markup at all. Aftonbladet's lead
 * photo arrived as a literal 40-pixel image inside an `<img width="8256">`,
 * and the saved article embedded that.
 *
 * The fix is not a cleverer heuristic. The browser has already resolved every
 * one of these questions — which srcset candidate, at what DPR, after which
 * scripts ran — so we ask it instead of guessing.
 *
 * `currentSrc` is the point
 * -------------------------
 * `img.currentSrc` is the URL the browser ACTUALLY loaded, after `srcset`,
 * `sizes`, DPR and any runtime swap. No parsing of ours can match it, because
 * it is the outcome of decisions only the browser made. We write it back into
 * `src` on a detached copy of the DOM, so the extracted article carries real
 * URLs.
 *
 * This runs on someone's live page: it must not mutate what they are looking
 * at. Everything below operates on `cloneNode(true)`.
 */

var ExtensionPreprocessingJS = (function () {
  "use strict";

  function run(args) {
    var payload = { url: "", title: "", html: "", selection: "" };

    try {
      payload.url = document.location.href || "";
      payload.title = document.title || "";

      var sel = window.getSelection ? String(window.getSelection()) : "";
      payload.selection = sel || "";

      // A DETACHED copy — never touch the page the user is reading.
      var clone = document.documentElement.cloneNode(true);

      // Map resolved image URLs from the live DOM onto the copy. Same document
      // order, so index alignment holds; guarded anyway in case a script
      // mutates between the two reads.
      var live = document.images || [];
      var copies = clone.querySelectorAll("img");
      var n = Math.min(live.length, copies.length);
      for (var i = 0; i < n; i++) {
        var resolved = live[i].currentSrc || live[i].src || "";
        if (!resolved) continue;
        // A data: URI here is usually the placeholder itself; there is nothing
        // better to point at, so leave whatever the markup had.
        if (resolved.lastIndexOf("data:", 0) === 0) continue;
        copies[i].setAttribute("src", resolved);
        // srcset is now redundant AND dangerous: it could send a reader back
        // to a candidate we did not capture. currentSrc already encodes the
        // browser's choice among them.
        copies[i].removeAttribute("srcset");
        copies[i].removeAttribute("data-src");
        copies[i].removeAttribute("data-srcset");

        // Drop the <source> siblings of a <picture>.
        //
        // Browsers prefer <source srcset> over <img src>, so leaving them
        // would have the saved article render from a REMOTE candidate we never
        // inlined — looking perfect online and losing its images offline,
        // which is the failure this whole feature exists to remove. `src` now
        // holds currentSrc, the URL the browser actually chose among exactly
        // those candidates, so nothing is lost by removing them.
        var parent = copies[i].parentNode;
        if (parent && parent.tagName && parent.tagName.toLowerCase() === "picture") {
          var sources = parent.querySelectorAll("source");
          for (var j = 0; j < sources.length; j++) {
            sources[j].parentNode.removeChild(sources[j]);
          }
        }
      }

      payload.html = clone.outerHTML || "";
    } catch (e) {
      // Never block the share. An empty html field makes the extension fall
      // back to fetching the URL, which is exactly the old behaviour.
      payload.html = "";
    }

    args.completionFunction(payload);
  }

  // `finalize` runs after the extension completes. We change nothing on the
  // page, so there is nothing to undo — but the key must exist or iOS logs a
  // warning on dismissal.
  function finalize(args) {}

  return { run: run, finalize: finalize };
})();
