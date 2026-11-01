import { describe, expect, test } from "bun:test";
import { isTokenValue } from "../styles";

// Stands in for `CSS.supports("color", value)`, which only a browser has.
const isColor = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\(.*\)|hsla?\(.*\)|red)$/i.test(v);

describe("isTokenValue", () => {
  test.each([
    "#336699",
    "rgb(1, 2, 3)",
    "hsl(120 50% 50%)",
    "red",
    "var(--brand)",
    "var(--brand, #123)",
    "var(--a, var(--b, 12px))",
    "0",
    "16px",
    "-1.5rem",
    ".5em",
    "100%",
    "10vw",
  ])("keeps %s", (value) => {
    expect(isTokenValue(value, isColor)).toBe(true);
  });

  test.each([
    "",
    "abc123",
    "eyJhbGciOiJIUzI1NiJ9.e30.abc",
    "1234567",
    "Inter, sans-serif",
    'url("/a.png")',
    "https://a.test/v1",
    "var(--a, abc123)",
    "var(--a, var(--b, abc123))",
    "var(--a) abc123",
    "rgb(var(--r) 0 0)",
    "16px 24px",
    `var(--a, ${"#fff".padEnd(201)})`,
  ])("drops %s", (value) => {
    expect(isTokenValue(value, isColor)).toBe(false);
  });

  test("the browser's verdict never overrules a long value", () => {
    expect(isTokenValue(`#${"a".repeat(200)}`, () => true)).toBe(false);
  });
});
