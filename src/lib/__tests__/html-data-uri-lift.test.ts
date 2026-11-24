// @vitest-environment jsdom
/**
 * The lift/restore helper on its own: what it accepts, what it refuses, and
 * what restoration can and cannot write to.
 */
import { describe, it, expect } from "vitest";
import {
  liftDataUris,
  restoreDataUris,
  liftableImageType,
  LIFT_MIN_CHARS,
} from "@/lib/html-data-uri-lift";
import { base64Payload } from "./html-legacy-sanitise-reference";

const PAYLOAD = base64Payload(4096, 1);
const BIG_PNG = `data:image/png;base64,${PAYLOAD}`;

function body(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html").body;
}

describe("liftableImageType", () => {
  it("accepts raster base64 images, with or without padding", () => {
    expect(liftableImageType(BIG_PNG)).toBe("png");
    expect(liftableImageType("data:image/jpeg;base64,/9j/4AAQ")).toBe("jpeg");
    expect(liftableImageType("data:image/webp;base64,UklGRg==")).toBe("webp");
    expect(liftableImageType("data:image/gif;base64,R0lGODlhA=")).toBe("gif");
  });

  it.each([
    ["an SVG image", `data:image/svg+xml;base64,${PAYLOAD}`],
    ["an HTML document", `data:text/html;base64,${PAYLOAD}`],
    ["an HTML document dressed as an image type list", `data:text/html,image/png;base64,${PAYLOAD}`],
    ["a non-base64 image", `data:image/png,${PAYLOAD}`],
    ["an extra parameter", `data:image/png;charset=utf-8;base64,${PAYLOAD}`],
    ["an uppercase scheme", `DATA:image/png;base64,${PAYLOAD}`],
    ["an uppercase type", `data:IMAGE/PNG;base64,${PAYLOAD}`],
    ["leading whitespace", ` data:image/png;base64,${PAYLOAD}`],
    ["a tab inside the scheme", `da\tta:image/png;base64,${PAYLOAD}`],
    ["an empty payload", "data:image/png;base64,"],
    ["padding only", "data:image/png;base64,=="],
    ["three characters of padding", `data:image/png;base64,${PAYLOAD}===`],
    ["padding in the middle", `data:image/png;base64,${PAYLOAD}=${PAYLOAD}`],
    ["a quote in the payload", `data:image/png;base64,${PAYLOAD}"${PAYLOAD}`],
    ["a tag breakout in the payload", `data:image/png;base64,${PAYLOAD}"><script>alert(1)</script>`],
    ["a closing bracket at the very end", `data:image/png;base64,${PAYLOAD}>`],
    ["a newline in the payload", `data:image/png;base64,${PAYLOAD}\n${PAYLOAD}`],
    ["a space in the payload", `data:image/png;base64,${PAYLOAD} ${PAYLOAD}`],
    ["percent-encoding", `data:image/png;base64,${PAYLOAD}%3C`],
    ["a hyphen (url-safe alphabet)", `data:image/png;base64,${PAYLOAD}-_`],
    ["a non-ASCII letter", `data:image/png;base64,${PAYLOAD}é`],
    ["a NUL", `data:image/png;base64,${PAYLOAD}\u0000`],
    ["a trailing fragment", `data:image/png;base64,${PAYLOAD}#x`],
  ])("refuses %s", (_label, value) => {
    expect(liftableImageType(value)).toBeNull();
  });
});

describe("liftDataUris", () => {
  it("swaps a large image for a short stand-in of the same type and restores it exactly", () => {
    const root = body(`<p>text</p><img src="${BIG_PNG}" alt="a">`);
    const lifted = liftDataUris(root);

    expect(lifted.originals.size).toBe(1);
    expect(lifted.chars).toBe(BIG_PNG.length);
    const standIn = root.querySelector("img")!.getAttribute("src")!;
    expect(standIn).toMatch(/^data:image\/png;base64,[A-Za-z0-9]+$/);
    expect(standIn.length).toBeLessThan(100);
    expect(root.innerHTML).not.toContain(PAYLOAD);

    expect(restoreDataUris(root, lifted)).toBe(1);
    expect(root.querySelector("img")!.getAttribute("src")).toBe(BIG_PNG);
  });

  it("leaves small values, non-URL attributes, srcset and style alone", () => {
    const small = "data:image/png;base64,iVBORw0KGgo=";
    expect(small.length).toBeLessThan(LIFT_MIN_CHARS);
    const root = body(
      `<img src="${small}">` +
        `<img srcset="${BIG_PNG} 2x">` +
        `<div style="background:url(${BIG_PNG})" title="${BIG_PNG}" id="${BIG_PNG}"></div>` +
        `<input value="${BIG_PNG}">`,
    );
    const before = root.innerHTML;
    const lifted = liftDataUris(root);
    expect(lifted.originals.size).toBe(0);
    expect(root.innerHTML).toBe(before);
  });

  it("does not lift anything that is not a plain raster image", () => {
    const root = body(
      `<img src="data:image/svg+xml;base64,${PAYLOAD}">` +
        `<a href="data:text/html;base64,${PAYLOAD}">x</a>` +
        `<img src="DATA:image/png;base64,${PAYLOAD}">` +
        `<img src="data:image/png;base64,${PAYLOAD}&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">`,
    );
    const before = root.innerHTML;
    expect(liftDataUris(root).originals.size).toBe(0);
    expect(root.innerHTML).toBe(before);
  });

  it("issues a different, unpredictable stand-in on every lift", () => {
    const first = body(`<img src="${BIG_PNG}">`);
    const second = body(`<img src="${BIG_PNG}">`);
    liftDataUris(first);
    liftDataUris(second);
    const a = first.querySelector("img")!.getAttribute("src")!;
    const b = second.querySelector("img")!.getAttribute("src")!;
    expect(a).not.toBe(b);
    // 128 bits of hex after the marker.
    expect(a).toMatch(/NSLIFT[0-9a-f]{32}Z0$/);
  });
});

describe("restoreDataUris", () => {
  // The token is forced here to model the impossible: a document that knows
  // the stand-in it will be given. Even then restoration stays inside the
  // URL attributes and writes only a value the lift validated.
  const TOKEN = "0123456789abcdef0123456789abcdef";
  const FORGED = `data:image/png;base64,NSLIFT${TOKEN}Z0`;

  it("never expands a stand-in found in text, in a non-URL attribute, in style, or inside a longer value", () => {
    const root = body(
      `<img id="real" src="${BIG_PNG}">` +
        `<p id="text">${FORGED}</p>` +
        `<p id="title" title="${FORGED}">t</p>` +
        `<p id="style" style="background:url(${FORGED})">s</p>` +
        `<img id="srcset" srcset="${FORGED} 1x">` +
        `<img id="longer" src="${FORGED}?x">` +
        `<img id="spaced" src=" ${FORGED}">` +
        `<input id="value" value="${FORGED}">`,
    );
    const lifted = liftDataUris(root, LIFT_MIN_CHARS, TOKEN);
    expect([...lifted.originals.keys()]).toEqual([FORGED]);

    restoreDataUris(root, lifted);

    expect(root.querySelector("#real")!.getAttribute("src")).toBe(BIG_PNG);
    expect(root.querySelector("#text")!.textContent).toBe(FORGED);
    expect(root.querySelector("#text")!.children.length).toBe(0);
    expect(root.querySelector("#title")!.getAttribute("title")).toBe(FORGED);
    expect(root.querySelector("#style")!.getAttribute("style")).toBe(`background:url(${FORGED})`);
    expect(root.querySelector("#srcset")!.getAttribute("srcset")).toBe(`${FORGED} 1x`);
    expect(root.querySelector("#longer")!.getAttribute("src")).toBe(`${FORGED}?x`);
    expect(root.querySelector("#spaced")!.getAttribute("src")).toBe(` ${FORGED}`);
    expect(root.querySelector("#value")!.getAttribute("value")).toBe(FORGED);
    // The payload exists exactly once: where it was.
    expect(root.innerHTML.split(PAYLOAD).length - 1).toBe(1);
  });

  it("a forged whole-value stand-in gains only the document's own validated image", () => {
    const root = body(`<img id="real" src="${BIG_PNG}"><img id="forged" src="${FORGED}">`);
    const lifted = liftDataUris(root, LIFT_MIN_CHARS, TOKEN);
    restoreDataUris(root, lifted);
    const forged = root.querySelector("#forged")!;
    expect(forged.getAttribute("src")).toBe(BIG_PNG);
    expect(liftableImageType(forged.getAttribute("src")!)).toBe("png");
    expect(forged.attributes.length).toBe(2);
    expect(root.querySelectorAll("*").length).toBe(2);
  });

  it("writes nothing for a lifted value whose element was removed", () => {
    const root = body(`<img src="${BIG_PNG}"><p>kept</p>`);
    const lifted = liftDataUris(root);
    root.querySelector("img")!.remove();
    expect(restoreDataUris(root, lifted)).toBe(0);
    expect(root.innerHTML).toBe("<p>kept</p>");
  });

  it("restores inside <template> content too", () => {
    const root = body(`<img src="${BIG_PNG}">`);
    const lifted = liftDataUris(root);
    const standIn = root.querySelector("img")!.getAttribute("src")!;
    const host = document.createElement("div");
    host.innerHTML = `<template><img src="${standIn}"></template>`;
    expect(restoreDataUris(host, lifted)).toBe(1);
    expect(host.querySelector("template")!.content.querySelector("img")!.getAttribute("src")).toBe(BIG_PNG);
  });
});
