import { describe, expect, test } from "bun:test";
import { matchFont } from "../fonts";
import { inter } from "./fixtures";

describe("matchFont", () => {
  test("exact family and weight match", () => {
    expect(matchFont("Inter", 700, false, inter)).toEqual({
      font: { family: "Inter", style: "Bold" },
      substituted: false,
    });
  });
  test("weight 450 takes the nearest style", () => {
    expect(matchFont("Inter", 450, false, inter).font.style).toBe("Regular");
  });
  test("ties go to the heavier style", () => {
    const f = [
      { family: "Inter", style: "Regular" },
      { family: "Inter", style: "Medium" },
    ];
    expect(matchFont("Inter", 450, false, f).font.style).toBe("Medium");
    expect(matchFont("Inter", 449, false, f).font.style).toBe("Regular");
  });
  test("italic picks the italic style when there is one", () => {
    expect(matchFont("Inter", 700, true, inter).font.style).toBe("Bold Italic");
  });
  test("italic falls back to upright if the family has none", () => {
    expect(matchFont("Inter", 400, true, [{ family: "Inter", style: "Regular" }]).font.style).toBe(
      "Regular"
    );
  });
  test("family matching ignores case", () => {
    expect(matchFont("inter", 400, false, inter).font.family).toBe("Inter");
  });
  test("a missing family becomes Inter Regular, substituted", () => {
    expect(matchFont("Nimbus Sans", 700, false, inter)).toEqual({
      font: { family: "Inter", style: "Regular" },
      substituted: true,
    });
  });
});
