import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { readBreakpoints } from "../breakpoints";

function read(css: string) {
  const win = new Window();
  const doc = win.document as unknown as Document;
  doc.head.innerHTML = `<style>${css}</style>`;
  return readBreakpoints(doc);
}
const widths = (css: string) => read(css).widths;

describe("readBreakpoints", () => {
  test("reads min-width and max-width in px and rem", () => {
    expect(
      widths(
        "@media (min-width: 640px){a{color:red}} @media (min-width:48rem){a{color:red}} @media (max-width: 1023px){a{color:red}}"
      )
    ).toEqual([640, 768, 1024]);
  });

  test("reads range syntax", () => {
    expect(widths("@media (width >= 80rem){a{color:red}}")).toEqual([1280]);
    expect(widths("@media (width < 64rem){a{color:red}}")).toEqual([1024]);
    expect(widths("@media (width <= 600px){a{color:red}}")).toEqual([601]);
  });

  test("rounds a fractional max-width up", () => {
    expect(widths("@media (max-width: 1023.98px){a{color:red}}")).toEqual([1024]);
  });

  test("ignores conditions that are not on width", () => {
    expect(
      widths(
        "@media (prefers-color-scheme: dark){a{color:red}} @media (hover: hover){a{color:red}} @media (min-height: 700px){a{color:red}} @media print{a{color:red}}"
      )
    ).toEqual([]);
  });

  test("keeps the eight boundaries used by the most rules", () => {
    let css = "";
    for (let i = 1; i <= 10; i++) css += `@media (min-width: ${i * 100}px){a{color:red}}`;
    // 100 and 200 get a single rule each; the rest get two.
    for (let i = 3; i <= 10; i++) css += `@media (min-width: ${i * 100}px){b{color:red}}`;
    expect(widths(css)).toEqual([300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  test("breaks ties toward the smaller width", () => {
    let css = "";
    for (let i = 1; i <= 10; i++) css += `@media (min-width: ${i * 100}px){a{color:red}}`;
    expect(widths(css)).toEqual([100, 200, 300, 400, 500, 600, 700, 800]);
  });

  test("counts a media rule nested in @supports", () => {
    expect(widths("@supports (display:grid){@media (min-width: 700px){a{color:red}}}")).toEqual([
      700,
    ]);
  });

  test("ignores @container conditions", () => {
    expect(widths("@container (min-width: 28rem){a{color:red}}")).toEqual([]);
  });

  test("counts only the @media width inside an @container", () => {
    expect(
      widths("@container (min-width: 28rem){@media (min-width: 700px){a{color:red}}}")
    ).toEqual([700]);
  });

  test("reads em, reversed and compound forms", () => {
    expect(widths("@media (width <= 48em){a{color:red}}")).toEqual([769]);
    expect(widths("@media (600px <= width){a{color:red}}")).toEqual([600]);
    expect(widths("@media (min-width: 768px) and (max-width: 1023px){a{color:red}}")).toEqual([
      768, 1024,
    ]);
  });

  test("counts boundaries a pixel or two apart as one, keeping the most used", () => {
    expect(
      widths(
        "@media (max-width: 999px){a{color:red}} @media (min-width: 1000px){a{color:red}} @media (max-width: 1000px){a{color:red}} @media (min-width: 999px){a{color:red}}"
      )
    ).toEqual([1000]);
    expect(
      widths(
        "@media (max-width: 999px){a{color:red}} @media (min-width: 1000px){a{color:red}} @media (min-width: 1000px){b{color:red}} @media (max-width: 1000px){a{color:red}}"
      )
    ).toEqual([1000]);
  });

  test("prefers a Tailwind-named width within a cluster", () => {
    expect(
      widths(
        "@media (max-width: 767px){a{color:red}} @media (min-width: 769px){a{color:red}} @media (min-width: 769px){b{color:red}} @media (min-width: 769px){c{color:red}} @media (min-width: 768px){a{color:red}}"
      )
    ).toEqual([768]);
  });

  test("keeps boundaries more than two pixels apart", () => {
    expect(
      widths("@media (min-width: 640px){a{color:red}} @media (min-width: 768px){a{color:red}}")
    ).toEqual([640, 768]);
  });

  test("a cluster's summed uses decide the top-8 cut", () => {
    let css = "";
    // Eight single-use boundaries far apart, then a cluster of two single uses (sum 2).
    for (let i = 1; i <= 8; i++) css += `@media (min-width: ${i * 100}px){a{color:red}}`;
    css += "@media (min-width: 2000px){a{color:red}} @media (min-width: 2001px){a{color:red}}";
    expect(widths(css)).toEqual([100, 200, 300, 400, 500, 600, 700, 2000]);
  });

  test("gives nothing for a page without media", () => {
    expect(read("a{color:red}")).toEqual({ widths: [], unreadable: 0 });
  });
});
