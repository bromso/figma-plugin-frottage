import { probeComponents } from "@repo/component-probe";

(globalThis as unknown as { __frottageProbe: unknown }).__frottageProbe = probeComponents;
