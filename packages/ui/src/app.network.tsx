import { PLUGIN, UI } from "@repo/common/networkSides";
import type { ImportPort } from "./import/import-flow";

export const UI_CHANNEL = UI.channelBuilder()
  .emitsTo(PLUGIN, (message: unknown) => {
    parent.postMessage({ pluginMessage: message }, "*");
  })
  .receivesFrom(PLUGIN, (next: (message: unknown) => void) => {
    const listener = (event: MessageEvent) => {
      if (event.data?.pluginId == null) return;
      next(event.data.pluginMessage);
    };

    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  })
  .startListening();

// ---------- Message handlers

UI_CHANNEL.registerMessageHandler("ping", () => {
  return "pong";
});

UI_CHANNEL.registerMessageHandler("hello", (text: string) => {
  console.log("Plugin side said", text);
});

// The sandbox reports progress after every batch. The import flow counts the same
// batches itself as each request resolves, so this only acknowledges the event.
UI_CHANNEL.registerMessageHandler("importProgress", () => {});

/** The sandbox end of the import, as `runImport` sees it. */
export const channelImportPort: ImportPort = {
  getPrefs: (key) => UI_CHANNEL.request(PLUGIN, "getPrefs", [key]),
  setPrefs: (key, value) => UI_CHANNEL.request(PLUGIN, "setPrefs", [key, value]),
  listFonts: () => UI_CHANNEL.request(PLUGIN, "listFonts", []),
  beginSet: () => UI_CHANNEL.request(PLUGIN, "importBeginSet", []),
  begin: (meta) => UI_CHANNEL.request(PLUGIN, "importBegin", [meta]),
  tokens: (tokens, options) => UI_CHANNEL.request(PLUGIN, "importTokens", [tokens, options]),
  importModes: (tokens, options) => UI_CHANNEL.request(PLUGIN, "importModes", [tokens, options]),
  image: (hash, bytes) => UI_CHANNEL.request(PLUGIN, "importImage", [hash, bytes]),
  batch: (ops) => UI_CHANNEL.request(PLUGIN, "importBatch", [ops]),
  end: () => UI_CHANNEL.request(PLUGIN, "importEnd", []),
  endSet: () => UI_CHANNEL.request(PLUGIN, "importEndSet", []),
  cancel: () => UI_CHANNEL.request(PLUGIN, "importCancel", []),
};
