import { describe, it, expect } from "vitest";
import { stripGhostTaskItems } from "../markdown";

describe("stripGhostTaskItems", () => {
  it("strips trailing ghost at end of bullet list", () => {
    const input = "## Section\n\n- item 1\n- item 2\n- [ ] \n\n## Next";
    expect(stripGhostTaskItems(input)).toBe(
      "## Section\n\n- item 1\n- item 2\n\n## Next"
    );
  });

  it("strips escaped brackets from corruption", () => {
    expect(stripGhostTaskItems("- item 1\n- \\[ \\]\n")).toBe("- item 1\n");
  });

  it("strips multiple trailing ghosts", () => {
    expect(stripGhostTaskItems("- item 1\n- [ ] \n- [ ]\n")).toBe(
      "- item 1\n"
    );
  });

  it("strips mixed ghost + escaped brackets", () => {
    expect(stripGhostTaskItems("- item 1\n- [ ] \n- \\[ \\]\n")).toBe(
      "- item 1\n"
    );
  });

  it("preserves non-trailing empty task items", () => {
    const input = "- [ ] task 1\n- [ ] \n- [ ] task 2\n";
    expect(stripGhostTaskItems(input)).toBe(input);
  });

  it("preserves task list with real content", () => {
    const input = "- [ ] task 1\n- [x] task 2\n";
    expect(stripGhostTaskItems(input)).toBe(input);
  });

  it("strips ghost at document tail", () => {
    expect(stripGhostTaskItems("- item 1\n\n- [ ] \n")).toBe("- item 1\n");
  });

  it("leaves non-list content unchanged", () => {
    const input = "# Hello\n\nSome text\n";
    expect(stripGhostTaskItems(input)).toBe(input);
  });

  it("strips mid-document ghost between sections", () => {
    const input = "## A\n\n- item\n- [ ] \n\n## B\n\n- other\n";
    expect(stripGhostTaskItems(input)).toBe(
      "## A\n\n- item\n\n## B\n\n- other\n"
    );
  });

  it("strips ghost from only the affected list block", () => {
    const input = "- a\n- b\n\n- c\n- [ ] \n";
    expect(stripGhostTaskItems(input)).toBe("- a\n- b\n\n- c\n");
  });

  it("removes all-ghost list entirely", () => {
    const input = "# Title\n\n- [ ] \n\n# Next\n";
    expect(stripGhostTaskItems(input)).toBe("# Title\n\n# Next\n");
  });

  it("preserves intentional task list with content", () => {
    const input = "- [ ] buy milk\n- [x] write code\n- [ ] review PR\n";
    expect(stripGhostTaskItems(input)).toBe(input);
  });
});
