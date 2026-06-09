// Structural split gate for issue #439
// All tests RED before the split, GREEN after.
// Uses fs.readFileSync to avoid any React/Tauri bootstrap overhead.

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const componentDir = resolve(__dirname, "..");

describe("StatusTray structural split (#439)", () => {
  it("EditorToolsGroup.tsx exists and exports EditorToolsGroup", () => {
    const src = readFileSync(resolve(componentDir, "EditorToolsGroup.tsx"), "utf8");
    expect(src).toContain("export function EditorToolsGroup");
  });

  it("CompletionsGroup.tsx exists and exports CompletionsGroup", () => {
    const src = readFileSync(resolve(componentDir, "CompletionsGroup.tsx"), "utf8");
    expect(src).toContain("export function CompletionsGroup");
  });

  it("CommentsGroup.tsx exists and exports CommentsGroup", () => {
    const src = readFileSync(resolve(componentDir, "CommentsGroup.tsx"), "utf8");
    expect(src).toContain("export function CommentsGroup");
  });

  it("ActionsGroup.tsx exists and exports ActionsGroup", () => {
    const src = readFileSync(resolve(componentDir, "ActionsGroup.tsx"), "utf8");
    expect(src).toContain("export function ActionsGroup");
  });

  it("SessionGroup.tsx exists and exports SessionGroup", () => {
    const src = readFileSync(resolve(componentDir, "SessionGroup.tsx"), "utf8");
    expect(src).toContain("export function SessionGroup");
  });

  it("HelpGroup.tsx exists and exports HelpGroup", () => {
    const src = readFileSync(resolve(componentDir, "HelpGroup.tsx"), "utf8");
    expect(src).toContain("export function HelpGroup");
  });

  it("StatusTray.tsx is at most 200 lines after the split", () => {
    const src = readFileSync(resolve(componentDir, "StatusTray.tsx"), "utf8");
    const lines = src.split("\n").length;
    expect(lines).toBeLessThanOrEqual(200);
  });

  it("StatusTray.tsx still exports StatusTray for backward compatibility", () => {
    const src = readFileSync(resolve(componentDir, "StatusTray.tsx"), "utf8");
    expect(src).toContain("export function StatusTray");
  });

  it("StatusTray.tsx still exports StatusTrayGroup type for backward compatibility", () => {
    const src = readFileSync(resolve(componentDir, "StatusTray.tsx"), "utf8");
    expect(src).toMatch(/export type StatusTrayGroup|export\s+\{[^}]*StatusTrayGroup/);
  });
});
