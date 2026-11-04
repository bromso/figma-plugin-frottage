import { describe, expect, test } from "bun:test";
import { extrasLine, planWidths } from "../plan-widths";

const LAPTOP = { width: 1512, id: "laptop" as const, name: "Laptop" };
const TABLET = { width: 834, id: "tablet-portrait" as const, name: "Tablet portrait" };
const PHONE = { width: 390, id: "phone-portrait" as const, name: "Phone portrait" };
const MAINLINE = [640, 768, 1024, 1280, 1400];

describe("planWidths", () => {
  test("one width per device, plus one per breakpoint range no device covers", () => {
    const plan = planWidths([LAPTOP, TABLET, PHONE], MAINLINE);
    expect(plan.widths.slice(0, 3)).toEqual([
      { width: 1512, device: { id: "laptop", name: "Laptop", height: 982 } },
      { width: 834, device: { id: "tablet-portrait", name: "Tablet portrait", height: 1194 } },
      { width: 390, device: { id: "phone-portrait", name: "Phone portrait", height: 844 } },
    ]);
    expect(plan.extras).toEqual([
      { width: 640, breakpoint: "sm" },
      { width: 1024, breakpoint: "lg" },
      { width: 1280, breakpoint: "xl" },
    ]);
    expect(plan.widths.slice(3)).toEqual(plan.extras);
    expect(plan.widths).toHaveLength(6);
  });

  test("a device row typed with another width keeps its name", () => {
    const plan = planWidths([{ ...LAPTOP, width: 1600 }], []);
    expect(plan.widths).toEqual([
      { width: 1600, device: { id: "laptop", name: "Laptop", height: 982 } },
    ]);
  });

  test("no breakpoints gives no extras", () => {
    expect(planWidths([LAPTOP, PHONE], []).extras).toEqual([]);
  });

  test("an uncovered base range is captured at 390, or just under the first boundary", () => {
    expect(planWidths([LAPTOP], [1024]).extras).toEqual([{ width: 390, breakpoint: "base" }]);
    expect(planWidths([LAPTOP], [300]).extras).toEqual([{ width: 299, breakpoint: "base" }]);
  });

  test("a boundary that is not Tailwind's is named by its width", () => {
    expect(planWidths([PHONE], [1400]).extras).toEqual([{ width: 1400, breakpoint: "min 1400" }]);
  });

  test("a range that can't be reached by a window is not captured", () => {
    expect(planWidths([LAPTOP], [100]).extras).toEqual([]);
    expect(planWidths([LAPTOP], [5000]).extras).toEqual([]);
  });

  test("a repeated device width is captured once, under the first name", () => {
    const plan = planWidths([LAPTOP, { ...TABLET, width: 1512 }], []);
    expect(plan.widths).toHaveLength(1);
    expect(plan.widths[0].device?.name).toBe("Laptop");
  });

  test("no devices gives no captures", () => {
    expect(planWidths([], MAINLINE)).toEqual({ widths: [], extras: [] });
  });
});

describe("extrasLine", () => {
  test("one extra", () => {
    expect(extrasLine([{ width: 1024, breakpoint: "lg" }])).toBe(
      "Also captures 1024 for the lg breakpoint"
    );
  });

  test("two extras", () => {
    expect(
      extrasLine([
        { width: 640, breakpoint: "sm" },
        { width: 1024, breakpoint: "lg" },
      ])
    ).toBe("Also captures 640 and 1024 for the sm and lg breakpoints");
  });

  test("several extras join with commas and a final and", () => {
    expect(
      extrasLine([
        { width: 640, breakpoint: "sm" },
        { width: 1024, breakpoint: "lg" },
        { width: 1280, breakpoint: "xl" },
      ])
    ).toBe("Also captures 640, 1024 and 1280 for the sm, lg and xl breakpoints");
  });

  test("none says nothing", () => {
    expect(extrasLine([])).toBeNull();
  });
});
