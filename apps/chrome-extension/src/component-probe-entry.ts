// Injected into the page's own JavaScript world (`world: "MAIN"`) by the service worker before
// each size's capture: React's fibers and Vue's app are invisible from the isolated world the
// capture runs in. Tags each component's root element for the capture. Its default export is the
// script's completion value, which `executeScript` returns: the build turns it into the value of
// the wrapping function (see `completionValue` in build.ts), so the page gets no global.
import { clearComponents, probeComponents } from "@repo/component-probe";

function probe(): number {
  try {
    return probeComponents(document);
  } catch {
    // A probe that fails part way leaves no attribute behind.
    try {
      clearComponents(document);
    } catch {}
    return 0;
  }
}

export default probe();
