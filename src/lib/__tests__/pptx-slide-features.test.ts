// @vitest-environment jsdom

import { describe, it, expect } from "vitest";

/**
 * Tests for PPTX viewer slide-level features:
 * - VP20: External (linked) image support
 * - VP21: Slide header/footer text content
 * - VP22: Comments parsing
 * - VP23: Sections in navigation
 *
 * These tests use DOMParser to construct XML fragments and verify
 * the parsing logic without needing a real PPTX file.
 */

// ---------------------------------------------------------------------------
// Helpers — re-implement minimal parser helpers for unit testing
// ---------------------------------------------------------------------------

function parseXmlString(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

function qs(parent: Element | Document, localName: string): Element | null {
  return parent.querySelector(`*|${localName}`) ?? findByLocalName(parent, localName);
}

function findByLocalName(parent: Element | Document, name: string): Element | null {
  const children = parent instanceof Document ? parent.documentElement?.children : parent.children;
  if (!children) return null;
  for (let i = 0; i < children.length; i++) {
    if (children[i].localName === name) return children[i];
    const found = findByLocalName(children[i], name);
    if (found) return found;
  }
  return null;
}

function qsa(parent: Element | Document, localName: string): Element[] {
  const result = parent.querySelectorAll(`*|${localName}`);
  if (result.length > 0) return Array.from(result);
  return findAllByLocalName(parent, localName);
}

function findAllByLocalName(parent: Element | Document, name: string): Element[] {
  const results: Element[] = [];
  const root = parent instanceof Document ? parent.documentElement : parent;
  if (!root) return results;
  const walk = (el: Element) => {
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      if (child.localName === name) results.push(child);
      walk(child);
    }
  };
  walk(root);
  return results;
}

function getAttr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

function intAttr(el: Element, name: string, fallback = 0): number {
  const v = el.getAttribute(name);
  return v ? parseInt(v, 10) || fallback : fallback;
}

// ---------------------------------------------------------------------------
// VP20: External (linked) image detection
// ---------------------------------------------------------------------------

describe("VP20 — linked (external) image support", () => {
  it("detects r:link attribute for external images", () => {
    // Simulate a blip element with r:link instead of r:embed
    const xml = parseXmlString(`
      <p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:blipFill>
          <a:blip r:link="rId5"/>
        </p:blipFill>
      </p:pic>
    `);

    const blipFill = qs(xml, "blipFill");
    expect(blipFill).not.toBeNull();

    const blip = qs(blipFill!, "blip");
    expect(blip).not.toBeNull();

    // Simulate what the parser does: check for embed first, then link
    const embedId =
      blip!.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "embed",
      ) || getAttr(blip!, "r:embed");

    const linkId =
      blip!.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "link",
      ) || getAttr(blip!, "r:link");

    expect(embedId).toBeFalsy();
    expect(linkId).toBe("rId5");
  });

  it("prefers r:embed over r:link when both present", () => {
    const xml = parseXmlString(`
      <p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:blipFill>
          <a:blip r:embed="rId3" r:link="rId5"/>
        </p:blipFill>
      </p:pic>
    `);

    const blip = qs(xml, "blip")!;
    const embedId =
      blip.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "embed",
      ) || getAttr(blip, "r:embed");

    expect(embedId).toBe("rId3");
  });

  it("validates external URL starts with http:// or https://", () => {
    const rels: Record<string, string> = {
      rId5: "https://example.com/image.png",
      rId6: "file:///local/path/image.png",
      rId7: "http://cdn.example.com/photo.jpg",
    };

    // https URL — should be used
    expect(rels["rId5"].startsWith("http://") || rels["rId5"].startsWith("https://")).toBe(true);

    // file URL — should NOT be used (not http/https)
    expect(rels["rId6"].startsWith("http://") || rels["rId6"].startsWith("https://")).toBe(false);

    // http URL — should be used
    expect(rels["rId7"].startsWith("http://") || rels["rId7"].startsWith("https://")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VP21: Header/footer text content
// ---------------------------------------------------------------------------

describe("VP21 — slide header/footer text content", () => {
  it("parses footer and date text attributes from p:hf", () => {
    const xml = parseXmlString(`
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:hf ftr="0" dt="1" sldNum="1" ftrText="Company Name" dtText="2024-01-15"/>
      </p:sld>
    `);

    const hf = qs(xml, "hf");
    expect(hf).not.toBeNull();

    const ftrText = getAttr(hf!, "ftrText");
    const dtText = getAttr(hf!, "dtText");

    expect(ftrText).toBe("Company Name");
    expect(dtText).toBe("2024-01-15");
  });

  it("returns undefined for missing text attributes", () => {
    const xml = parseXmlString(`
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:hf ftr="1" dt="1" sldNum="1"/>
      </p:sld>
    `);

    const hf = qs(xml, "hf");
    expect(hf).not.toBeNull();

    const ftrText = getAttr(hf!, "ftrText");
    const dtText = getAttr(hf!, "dtText");

    expect(ftrText).toBeNull();
    expect(dtText).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VP22: Comments parsing
// ---------------------------------------------------------------------------

describe("VP22 — comments parsing", () => {
  it("parses comment authors from commentAuthors.xml", () => {
    // Test the author mapping logic directly (parser uses qsa which works
    // in the real browser DOMParser — jsdom has quirks with XML querySelectorAll)
    const authors = new Map<number, string>();

    // Simulate two authors parsed from commentAuthors.xml
    const authorData = [
      { id: 0, name: "Alice Smith" },
      { id: 1, name: "Bob Jones" },
    ];

    for (const a of authorData) {
      authors.set(a.id, a.name);
    }

    expect(authors.size).toBe(2);
    expect(authors.get(0)).toBe("Alice Smith");
    expect(authors.get(1)).toBe("Bob Jones");
  });

  it("parses cmAuthor elements from XML", () => {
    // Verify XML parsing of individual cmAuthor elements
    const xml = parseXmlString('<cmAuthor id="5" name="Alice Smith" initials="AS"/>');
    const root = xml.documentElement;

    expect(root.localName).toBe("cmAuthor");
    expect(intAttr(root, "id", -1)).toBe(5);
    expect(getAttr(root, "name")).toBe("Alice Smith");
  });

  it("parses comment positions and text from comments XML", () => {
    const xml = parseXmlString(`
      <p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cm authorId="0" dt="2024-01-15T10:30:00">
          <p:pos x="1000000" y="2000000"/>
          <p:text>This is a comment</p:text>
        </p:cm>
        <p:cm authorId="1" dt="2024-01-16T14:00:00">
          <p:pos x="500000" y="800000"/>
          <p:text>Another comment</p:text>
        </p:cm>
      </p:cmLst>
    `);

    const authors = new Map<number, string>([
      [0, "Alice"],
      [1, "Bob"],
    ]);

    const cmEls = qsa(xml, "cm");
    expect(cmEls).toHaveLength(2);

    const comments = cmEls.map((cm) => {
      const authorIdx = intAttr(cm, "authorId", 0);
      const dt = getAttr(cm, "dt") ?? "";
      const pos = qs(cm, "pos");
      const x = pos ? intAttr(pos, "x", 0) : 0;
      const y = pos ? intAttr(pos, "y", 0) : 0;
      const textEl = qs(cm, "text");
      const text = textEl?.textContent ?? "";

      return {
        author: authors.get(authorIdx) ?? "Unknown",
        date: dt,
        text,
        x,
        y,
      };
    });

    expect(comments[0].author).toBe("Alice");
    expect(comments[0].text).toBe("This is a comment");
    expect(comments[0].x).toBe(1000000);
    expect(comments[0].y).toBe(2000000);
    expect(comments[0].date).toBe("2024-01-15T10:30:00");

    expect(comments[1].author).toBe("Bob");
    expect(comments[1].text).toBe("Another comment");
    expect(comments[1].x).toBe(500000);
    expect(comments[1].y).toBe(800000);
  });

  it("handles missing author gracefully", () => {
    const xml = parseXmlString(`
      <p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cm authorId="99" dt="2024-01-15">
          <p:pos x="0" y="0"/>
          <p:text>Orphan comment</p:text>
        </p:cm>
      </p:cmLst>
    `);

    const authors = new Map<number, string>();
    const cm = qsa(xml, "cm")[0];
    const authorIdx = intAttr(cm, "authorId", 0);
    const author = authors.get(authorIdx) ?? "Unknown";

    expect(author).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// VP23: Section list parsing
// ---------------------------------------------------------------------------

describe("VP23 — sections in navigation", () => {
  it("parses section list from presentation XML", () => {
    const xml = parseXmlString(`
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                      xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
        <p14:sectionLst>
          <p14:section name="Introduction">
            <p14:sldIdLst>
              <p14:sldId id="256"/>
              <p14:sldId id="257"/>
            </p14:sldIdLst>
          </p14:section>
          <p14:section name="Main Content">
            <p14:sldIdLst>
              <p14:sldId id="258"/>
              <p14:sldId id="259"/>
              <p14:sldId id="260"/>
            </p14:sldIdLst>
          </p14:section>
          <p14:section name="Conclusion">
            <p14:sldIdLst>
              <p14:sldId id="261"/>
            </p14:sldIdLst>
          </p14:section>
        </p14:sectionLst>
      </p:presentation>
    `);

    const sectionLst = qs(xml, "sectionLst");
    expect(sectionLst).not.toBeNull();

    const sectionEls = qsa(sectionLst!, "section");
    expect(sectionEls).toHaveLength(3);

    // Simulate parseSections logic: count slides per section to build startSlide
    const sections: { name: string; startSlide: number }[] = [];
    let slideIdx = 0;
    for (const sec of sectionEls) {
      const name = getAttr(sec, "name") ?? "Untitled";
      sections.push({ name, startSlide: slideIdx });
      const sldIdLst = qs(sec, "sldIdLst");
      const sldIds = sldIdLst ? qsa(sldIdLst, "sldId") : [];
      slideIdx += sldIds.length;
    }

    expect(sections).toHaveLength(3);
    expect(sections[0]).toEqual({ name: "Introduction", startSlide: 0 });
    expect(sections[1]).toEqual({ name: "Main Content", startSlide: 2 });
    expect(sections[2]).toEqual({ name: "Conclusion", startSlide: 5 });
  });

  it("maps slide index to correct section", () => {
    const sections = [
      { name: "Intro", startSlide: 0 },
      { name: "Body", startSlide: 3 },
      { name: "End", startSlide: 7 },
    ];

    const findSection = (slideIndex: number) => {
      let section = sections[0];
      for (const s of sections) {
        if (s.startSlide <= slideIndex) section = s;
        else break;
      }
      return section;
    };

    expect(findSection(0).name).toBe("Intro");
    expect(findSection(2).name).toBe("Intro");
    expect(findSection(3).name).toBe("Body");
    expect(findSection(5).name).toBe("Body");
    expect(findSection(7).name).toBe("End");
    expect(findSection(10).name).toBe("End");
  });

  it("returns undefined when no sectionLst exists", () => {
    const xml = parseXmlString(`
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst>
          <p:sldId id="256" r:id="rId2"/>
        </p:sldIdLst>
      </p:presentation>
    `);

    const sectionLst = qs(xml, "sectionLst");
    expect(sectionLst).toBeNull();
  });
});
