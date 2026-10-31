// Preload 2 of 2. Runs after happydom.ts (order is set in bunfig.toml).
// Do not merge into happydom.ts: static imports are evaluated before the
// module body, so @testing-library/* would load before
// GlobalRegistrator.register() runs.

import { afterEach, expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";

expect.extend(matchers);

// Vitest unmounted rendered trees between tests automatically; bun test does not.
// Testing Library's own auto-cleanup needs a global `afterEach` at import time,
// and a preload has none, so register it explicitly here.
afterEach(() => {
  cleanup();
});
