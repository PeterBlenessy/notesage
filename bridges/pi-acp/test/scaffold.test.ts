import { describe, expect, it } from "vitest";
import { BRIDGE_VERSION, parseArgs } from "../src/index";

describe("scaffold", () => {
  it("exposes a version", () => {
    expect(BRIDGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("parses --pi-bin", () => {
    expect(parseArgs(["--pi-bin", "/opt/pi/pi"])).toEqual({ piBin: "/opt/pi/pi" });
  });

  it("rejects a missing --pi-bin", () => {
    expect(() => parseArgs([])).toThrow(/--pi-bin/);
  });
});
