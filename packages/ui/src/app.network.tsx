import { PLUGIN, UI } from "@repo/common/networkSides";

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
