// Injected into the page by the service worker when the popup opens. Reads the width boundaries
// the page's stylesheets switch at and whether it has a dark theme, and leaves them for the
// worker's next call, which reads and clears them: an IIFE has no completion value for
// `executeScript` to return.
import { probePage } from "./probe";

const win = window as Window & { __frottageBreakpoints?: unknown };
try {
  win.__frottageBreakpoints = probePage(document, document.documentElement, (v) =>
    CSS.supports("color", v)
  );
} catch {
  win.__frottageBreakpoints = undefined;
}
