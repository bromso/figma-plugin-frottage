// Injected into the page by the service worker when the popup opens. Reads the width boundaries
// the page's stylesheets switch at and leaves them for the worker's next call, which reads and
// clears them: an IIFE has no completion value for `executeScript` to return.
import { readBreakpoints } from "@repo/capture-dom";

const win = window as Window & { __frottageBreakpoints?: unknown };
try {
  win.__frottageBreakpoints = readBreakpoints(document);
} catch {
  // No breakpoints: the popup plans no extra captures.
  win.__frottageBreakpoints = undefined;
}
