import { captureDocument } from "../src/index";

(globalThis as unknown as { __frottageCapture: unknown }).__frottageCapture = { captureDocument };
