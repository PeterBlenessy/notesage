// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { resolveColor } from "../pptx-parser";
import type { PptxTheme } from "../pptx-types";

describe("title color resolution for 45545_Comment.pptx", () => {
  it("resolves schemeClr tx2 through clrMap to yellow", () => {
    // Reproduce the exact theme state after parseSlideMaster sets clrMap
    const theme: PptxTheme = {
      colors: {
        dk1: "#000000", dk2: "#0066CC", lt1: "#FFFF00", lt2: "#F0FC02",
        accent1: "#00CCFF", accent2: "#00FFCC", accent3: "#AAB8E2",
        accent4: "#DADA00", accent5: "#AAE2FF", accent6: "#00E7B9",
        hlink: "#FF3300", folHlink: "#FF7C80",
      },
      fonts: { heading: "Times New Roman", body: "Times New Roman" },
      clrMap: {
        bg1: "dk2", tx1: "lt1", bg2: "dk1", tx2: "lt2",
        accent1: "accent1", accent2: "accent2", accent3: "accent3",
        accent4: "accent4", accent5: "accent5", accent6: "accent6",
        hlink: "hlink", folHlink: "folHlink",
      },
    };

    // Create a defRPr element with schemeClr val="tx2" (same as titleStyle)
    const xml = `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:defRPr>
        <a:solidFill><a:schemeClr val="tx2"/></a:solidFill>
      </a:defRPr>
    </root>`;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const defRPr = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "defRPr",
    )[0];

    const color = resolveColor(defRPr, theme);
    console.log("Resolved color for schemeClr tx2:", color);
    // tx2 -> clrMap -> lt2 -> #F0FC02
    expect(color).toBe("#F0FC02");
  });
});
