// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseGraphicFrame } from "../pptx-parser";
import type { PptxTheme } from "../pptx-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const defaultTheme: PptxTheme = {
  colors: { dk1: "#000000", lt1: "#ffffff", dk2: "#333333", lt2: "#eeeeee", accent1: "#4472c4" },
  fonts: { heading: "Calibri", body: "Calibri" },
};

function parseXml(xml: string): Element {
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

/** Create a minimal graphic frame element containing an OLE object */
function makeOleGraphicFrame(oleAttrs: string = "", oleRId: string = "rId1"): Element {
  return parseXml(`
    <p:graphicFrame xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">
      <p:xfrm>
        <a:off x="100000" y="200000"/>
        <a:ext cx="3000000" cy="2000000"/>
      </p:xfrm>
      <a:graphic>
        <a:graphicData>
          <p:oleObj r:id="${oleRId}" ${oleAttrs}/>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>
  `);
}

/** Create a graphic frame containing a table */
function makeTableGraphicFrame(): Element {
  return parseXml(`
    <p:graphicFrame xmlns:p="${P_NS}" xmlns:a="${A_NS}">
      <p:xfrm>
        <a:off x="100000" y="200000"/>
        <a:ext cx="5000000" cy="3000000"/>
      </p:xfrm>
      <a:graphic>
        <a:graphicData>
          <a:tbl>
            <a:tblGrid><a:gridCol w="2500000"/><a:gridCol w="2500000"/></a:tblGrid>
            <a:tr h="500000">
              <a:tc><a:txBody><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc>
              <a:tc><a:txBody><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody></a:tc>
            </a:tr>
          </a:tbl>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>
  `);
}

/** Create a zip with VML drawing containing an image reference */
async function makeZipWithVmlImage(): Promise<JSZip> {
  const zip = new JSZip();

  // Add an image file
  zip.file("ppt/media/olePreview.png", "fake-png-data");

  // Add VML drawing with imagedata
  // Note: real VML uses <xml> root but DOMParser chokes on it; use a valid root.
  // In production, the parser uses readXml which parses as "application/xml".
  zip.file("ppt/drawings/vmlDrawing1.vml", `<?xml version="1.0" encoding="UTF-8"?>
    <root xmlns:v="urn:schemas-microsoft-com:vml"
          xmlns:r="${R_NS}">
      <v:shape>
        <v:imagedata r:id="rId1"/>
      </v:shape>
    </root>
  `);

  // Add VML drawing rels (XML declaration must be at start — no leading whitespace)
  zip.file("ppt/drawings/_rels/vmlDrawing1.vml.rels",
`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="../media/olePreview.png"/>
</Relationships>`);

  return zip;
}

/** Create a zip with a direct image for OLE */
async function makeZipWithDirectImage(): Promise<JSZip> {
  const zip = new JSZip();
  zip.file("ppt/media/oleImage.png", "fake-png-data");
  return zip;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OLE object handling in parseGraphicFrame", () => {
  it("returns an image when OLE rel points directly to an image file", async () => {
    const el = makeOleGraphicFrame("", "rId2");
    const rels: Record<string, string> = {
      rId2: "../media/oleImage.png",
    };
    const zip = await makeZipWithDirectImage();

    const result = await parseGraphicFrame(el, rels, zip, "ppt/slides", defaultTheme);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("image");
    if (result!.type === "image") {
      expect(result!.dataUrl).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("returns an image via VML drawing fallback", async () => {
    const el = makeOleGraphicFrame("", "rId1");
    const rels: Record<string, string> = {
      rId1: "../embeddings/oleObject1.bin",  // Not an image
      rId3: "../drawings/vmlDrawing1.vml",
    };
    const zip = await makeZipWithVmlImage();

    // Verify zip contents are set up correctly
    expect(zip.file("ppt/drawings/vmlDrawing1.vml")).not.toBeNull();
    expect(zip.file("ppt/drawings/_rels/vmlDrawing1.vml.rels")).not.toBeNull();
    expect(zip.file("ppt/media/olePreview.png")).not.toBeNull();

    const result = await parseGraphicFrame(el, rels, zip, "ppt/slides", defaultTheme);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("image");
    if (result!.type === "image") {
      expect(result!.dataUrl).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("returns a placeholder shape when no preview image is available", async () => {
    const el = makeOleGraphicFrame('name="My Spreadsheet"', "rId1");
    const rels: Record<string, string> = {
      rId1: "../embeddings/oleObject1.bin",
    };
    const zip = new JSZip();

    const result = await parseGraphicFrame(el, rels, zip, "ppt/slides", defaultTheme);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("shape");
    if (result!.type === "shape") {
      expect(result!.text[0].runs[0].text).toBe("My Spreadsheet");
      expect(result!.text[0].runs[0].italic).toBe(true);
      expect(result!.text[0].runs[0].color).toBe("#999999");
    }
  });

  it("uses 'Embedded Object' as fallback name when no name attribute", async () => {
    const el = makeOleGraphicFrame("", "rId1");
    const rels: Record<string, string> = {
      rId1: "../embeddings/oleObject1.bin",
    };
    const zip = new JSZip();

    const result = await parseGraphicFrame(el, rels, zip, "ppt/slides", defaultTheme);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("shape");
    if (result!.type === "shape") {
      expect(result!.text[0].runs[0].text).toBe("Embedded Object");
    }
  });

  it("preserves transform (position/size) from the graphic frame", async () => {
    const el = makeOleGraphicFrame("", "rId1");
    const rels: Record<string, string> = {
      rId1: "../embeddings/oleObject1.bin",
    };
    const zip = new JSZip();

    const result = await parseGraphicFrame(el, rels, zip, "ppt/slides", defaultTheme);

    expect(result).not.toBeNull();
    expect(result!.x).toBe(100000);
    expect(result!.y).toBe(200000);
    expect(result!.width).toBe(3000000);
    expect(result!.height).toBe(2000000);
  });
});

describe("parseGraphicFrame does not break existing parsing", () => {
  it("still returns a table for table content", async () => {
    const el = makeTableGraphicFrame();
    const rels: Record<string, string> = {};
    const zip = new JSZip();

    const result = await parseGraphicFrame(el, rels, zip, "ppt/slides", defaultTheme);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("table");
  });

  it("returns null for empty graphic frames (no table, chart, SmartArt, or OLE)", async () => {
    const el = parseXml(`
      <p:graphicFrame xmlns:p="${P_NS}" xmlns:a="${A_NS}">
        <p:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="100" cy="100"/>
        </p:xfrm>
        <a:graphic>
          <a:graphicData/>
        </a:graphic>
      </p:graphicFrame>
    `);
    const rels: Record<string, string> = {};
    const zip = new JSZip();

    const result = await parseGraphicFrame(el, rels, zip, "ppt/slides", defaultTheme);

    expect(result).toBeNull();
  });
});
