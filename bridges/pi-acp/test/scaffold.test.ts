import { describe, expect, it } from "vitest";
import { BRIDGE_VERSION, parseArgs } from "../src/index";

describe("scaffold", () => {
  it("exposes a version", () => {
    expect(BRIDGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("parses --pi-bin", () => {
    expect(parseArgs(["--pi-bin", "/opt/pi/pi"])).toEqual({ piBin: "/opt/pi/pi", piArgs: [] });
  });

  it("passes everything after -- to pi", () => {
    expect(parseArgs(["--pi-bin", "/opt/pi/pi", "--", "--provider", "local", "--model", "m"])).toEqual({
      piBin: "/opt/pi/pi",
      piArgs: ["--provider", "local", "--model", "m"],
    });
  });

  it("rejects a missing --pi-bin (even when present only after --)", () => {
    expect(() => parseArgs([])).toThrow(/--pi-bin/);
    expect(() => parseArgs(["--", "--pi-bin", "/x"])).toThrow(/--pi-bin/);
  });
});
