import { describe, expect, it } from "bun:test";
import { PLUGIN, UI } from "../networkSides";

describe("networkSides", () => {
  it("exports UI side", () => {
    expect(UI).toBeDefined();
  });

  it("exports PLUGIN side", () => {
    expect(PLUGIN).toBeDefined();
  });
});
