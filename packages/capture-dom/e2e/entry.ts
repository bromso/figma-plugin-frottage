import { browserFetchBytes, browserNormalise, captureDocument, collectAssets } from "../src/index";

(globalThis as unknown as { __frottageCapture: unknown }).__frottageCapture = {
  captureDocument,
  collectAssets,
  browserFetchBytes,
  browserNormalise,
};
