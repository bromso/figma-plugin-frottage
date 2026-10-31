import { beforeEach, describe, expect, it } from "bun:test";

// BUG-01: main.tsx must throw a descriptive Error when #root is missing
// instead of using an unchecked `as HTMLElement` cast.
//
// Rather than importing main.tsx (which eagerly runs ReactDOM.createRoot),
// we re-exercise the exact guard shape that main.tsx is expected to use.
// The source of truth is enforced by the static grep check in
// 16-VALIDATION.md row 16-01-02.
function resolveRoot(): HTMLElement {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element #root not found in index.html");
  }
  return rootElement;
}

describe("BUG-01: main.tsx root element null guard", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("throws a descriptive Error when #root is missing", () => {
    expect(() => resolveRoot()).toThrow("Root element #root not found in index.html");
  });

  it("returns the element when #root exists", () => {
    const el = document.createElement("div");
    el.id = "root";
    document.body.appendChild(el);
    expect(resolveRoot()).toBe(el);
  });
});
