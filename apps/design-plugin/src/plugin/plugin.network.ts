import { PLUGIN, UI } from "@repo/common/networkSides";
import { createApplier } from "./applier";

export const PLUGIN_CHANNEL = PLUGIN.channelBuilder()
  .emitsTo(UI, (message) => {
    figma.ui.postMessage(message);
  })
  .receivesFrom(UI, (next) => {
    const listener: MessageEventHandler = (event) => next(event);
    figma.ui.on("message", listener);
    return () => figma.ui.off("message", listener);
  })
  .startListening();

// ---------- Message handlers

PLUGIN_CHANNEL.registerMessageHandler("ping", () => {
  return "pong";
});

PLUGIN_CHANNEL.registerMessageHandler("hello", (text) => {
  console.log("UI side said:", text);
});

// ---------- Import

const applier = createApplier(figma);
let batchTotal = 0;
let batchDone = 0;

PLUGIN_CHANNEL.registerMessageHandler("listFonts", async () => {
  const fonts = await figma.listAvailableFontsAsync();
  return fonts.map((f) => ({ family: f.fontName.family, style: f.fontName.style }));
});

PLUGIN_CHANNEL.registerMessageHandler("getPrefs", (key) => figma.clientStorage.getAsync(key));

PLUGIN_CHANNEL.registerMessageHandler("setPrefs", (key, value) =>
  figma.clientStorage.setAsync(key, value)
);

PLUGIN_CHANNEL.registerMessageHandler("importBegin", async (meta) => {
  batchTotal = meta.totalOps;
  batchDone = 0;
  await applier.begin(meta);
});

PLUGIN_CHANNEL.registerMessageHandler("importTokens", (tokens, options) =>
  applier.importTokens(tokens, options)
);

PLUGIN_CHANNEL.registerMessageHandler("importModes", (tokens, options) =>
  applier.importModes(tokens, options)
);

PLUGIN_CHANNEL.registerMessageHandler("importImage", (hash, bytes) =>
  applier.addImage(hash, bytes)
);

PLUGIN_CHANNEL.registerMessageHandler("importBatch", async (ops) => {
  await applier.applyBatch(ops);
  batchDone += ops.length;
  PLUGIN_CHANNEL.emit(UI, "importProgress", [batchDone, batchTotal]);
});

PLUGIN_CHANNEL.registerMessageHandler("importEnd", () => applier.end());

PLUGIN_CHANNEL.registerMessageHandler("importCancel", () => applier.cancel());

figma.on("close", () => applier.cancel());
