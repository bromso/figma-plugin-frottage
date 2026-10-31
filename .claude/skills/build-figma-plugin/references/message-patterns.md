# Message Patterns

The plugin and UI communicate via typed messages using `monorepo-networker`.

## Step 1: Define Message Types

In `packages/common/src/networkSides.ts`, define what each side **listens** for:

```typescript
import { Networker } from "monorepo-networker";

// UI side listens for these messages FROM the plugin:
export const UI = Networker.createSide("UI-side").listens<{
  ping(): "pong";
  hello(text: string): void;
  // Add your plugin→UI messages here:
  selectionChanged(count: number): void;
  taskComplete(message: string): void;
}>();

// Plugin side listens for these messages FROM the UI:
export const PLUGIN = Networker.createSide("Plugin-side").listens<{
  ping(): "pong";
  hello(text: string): void;
  // Add your UI→plugin messages here:
  renameSelection(newName: string): void;
  getSelectionInfo(): { name: string; type: string }[];
  exportSelected(format: "PNG" | "SVG"): string;
}>();
```

**Rules:**
- If the handler returns a value, the return type goes in the signature
- If the handler returns nothing, use `void`
- If the handler is async, use `Promise<T>` as the return type
- Parameter types must be serializable (no functions, no DOM nodes, no Figma nodes)

## Step 2: Register Plugin-Side Handlers

In `apps/design-plugin/src/plugin/plugin.network.ts`:

```typescript
import { PLUGIN, UI } from "@repo/common/networkSides";

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

// Handler for each message the UI can send:
PLUGIN_CHANNEL.registerMessageHandler("renameSelection", (newName: string) => {
  for (const node of figma.currentPage.selection) {
    node.name = newName;
  }
});

PLUGIN_CHANNEL.registerMessageHandler("getSelectionInfo", () => {
  return figma.currentPage.selection.map(n => ({
    name: n.name,
    type: n.type,
  }));
});
```

## Step 3: Send Messages from the UI

In `packages/ui/src/app.tsx` (or any UI component):

```typescript
import { UI_CHANNEL } from "./app.network";
import { PLUGIN } from "@repo/common/networkSides";

// Fire-and-forget (no return value):
UI_CHANNEL.emit(PLUGIN, "renameSelection", ["New Name"]);

// Request-response (waits for return value):
const info = await UI_CHANNEL.request(PLUGIN, "getSelectionInfo", []);
// info is typed as { name: string; type: string }[]
```

**Key difference:**
- `emit()` — fire-and-forget, no return value
- `request()` — returns a Promise with the handler's return value

## Step 4: Register UI-Side Handlers (if plugin sends messages to UI)

In `packages/ui/src/app.network.tsx`:

```typescript
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

// Handler for messages the plugin sends TO the UI:
UI_CHANNEL.registerMessageHandler("selectionChanged", (count: number) => {
  // Update UI state — but since this is outside React,
  // you'll need a state management pattern (see below)
});
```

## Common Pattern: Plugin→UI State Updates

For plugin-initiated updates (e.g., selection changed), use a subscription pattern:

```typescript
// In app.network.tsx — export a subscriber
type SelectionListener = (count: number) => void;
const listeners: SelectionListener[] = [];

export function onSelectionChange(fn: SelectionListener) {
  listeners.push(fn);
  return () => { listeners.splice(listeners.indexOf(fn), 1); };
}

UI_CHANNEL.registerMessageHandler("selectionChanged", (count: number) => {
  for (const fn of listeners) fn(count);
});

// In app.tsx — subscribe in a React component
import { useEffect, useState } from "react";
import { onSelectionChange } from "./app.network";

function App() {
  const [count, setCount] = useState(0);
  useEffect(() => onSelectionChange(setCount), []);
  return <Type>Selected: {count}</Type>;
}
```

## Sending Messages from Plugin Side to UI

In `apps/design-plugin/src/plugin/plugin.ts` or `plugin.network.ts`:

```typescript
import { PLUGIN_CHANNEL } from "./plugin.network";
import { UI } from "@repo/common/networkSides";

// Notify the UI that selection changed
figma.on("selectionchange", () => {
  PLUGIN_CHANNEL.emit(UI, "selectionChanged", [figma.currentPage.selection.length]);
});
```
