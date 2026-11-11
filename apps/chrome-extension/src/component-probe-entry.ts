// Injected into the page's own JavaScript world (`world: "MAIN"`) by the service worker before
// each size's capture: React's fibers and Vue's app are invisible from the isolated world the
// capture runs in. Tags each component's root element for the capture and leaves the count for
// the worker's next call, which reads and clears it: an IIFE has no completion value for
// `executeScript` to return.
import { probeComponents } from "@repo/component-probe";

const win = window as Window & { __frottageComponents?: number };
try {
  win.__frottageComponents = probeComponents(document);
} catch {
  win.__frottageComponents = 0;
}
