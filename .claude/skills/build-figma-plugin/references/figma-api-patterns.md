# Figma API Patterns

All Figma API code goes in `apps/design-plugin/src/plugin/plugin.network.ts` as message handlers.

The `figma` global is only available in the plugin process. The UI process cannot access it.

## Reading Selection

```typescript
PLUGIN_CHANNEL.registerMessageHandler("getSelection", () => {
  const nodes = figma.currentPage.selection;
  if (nodes.length === 0) throw new Error("Nothing selected");
  return nodes.map(n => ({ id: n.id, name: n.name, type: n.type }));
});
```

## Modifying Text Layers

```typescript
PLUGIN_CHANNEL.registerMessageHandler("renameSelected", (newName: string) => {
  for (const node of figma.currentPage.selection) {
    node.name = newName;
  }
});

PLUGIN_CHANNEL.registerMessageHandler("setTextContent", async (text: string) => {
  const nodes = figma.currentPage.selection.filter(
    (n): n is TextNode => n.type === "TEXT"
  );
  for (const node of nodes) {
    await figma.loadFontAsync(node.fontName as FontName);
    node.characters = text;
  }
});
```

## Changing Colors

```typescript
PLUGIN_CHANNEL.registerMessageHandler("setFillColor", (r: number, g: number, b: number) => {
  for (const node of figma.currentPage.selection) {
    if ("fills" in node) {
      node.fills = [{ type: "SOLID", color: { r: r/255, g: g/255, b: b/255 } }];
    }
  }
});
```

Note: Figma colors use 0-1 range, not 0-255.

## Creating Nodes

```typescript
PLUGIN_CHANNEL.registerMessageHandler("createRect", (width: number, height: number) => {
  const rect = figma.createRectangle();
  rect.resize(width, height);
  rect.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.5, b: 1 } }];
  figma.currentPage.appendChild(rect);
  figma.viewport.scrollAndZoomIntoView([rect]);
});

PLUGIN_CHANNEL.registerMessageHandler("createText", async (content: string) => {
  const text = figma.createText();
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  text.characters = content;
  figma.currentPage.appendChild(text);
});
```

## Exporting

```typescript
PLUGIN_CHANNEL.registerMessageHandler("exportAsPng", async () => {
  const node = figma.currentPage.selection[0];
  if (!node) throw new Error("Nothing selected");
  const bytes = await node.exportAsync({ format: "PNG" });
  return `data:image/png;base64,${figma.base64Encode(bytes)}`;
});

PLUGIN_CHANNEL.registerMessageHandler("exportAsSvg", async () => {
  const node = figma.currentPage.selection[0];
  if (!node) throw new Error("Nothing selected");
  const bytes = await node.exportAsync({ format: "SVG" });
  return new TextDecoder().decode(bytes);
});
```

## Traversing the Document

```typescript
// Find all text nodes on the current page
function findAllText(node: SceneNode): TextNode[] {
  const results: TextNode[] = [];
  if (node.type === "TEXT") results.push(node);
  if ("children" in node) {
    for (const child of node.children) {
      results.push(...findAllText(child));
    }
  }
  return results;
}

// Use in a handler:
PLUGIN_CHANNEL.registerMessageHandler("findAllText", () => {
  const allText: TextNode[] = [];
  for (const child of figma.currentPage.children) {
    allText.push(...findAllText(child));
  }
  return allText.map(t => ({ id: t.id, text: t.characters, name: t.name }));
});
```

## Window Configuration

In `plugin.ts`, configure the plugin window:

```typescript
figma.showUI(__html__, {
  width: 320,    // pixels — the template's UI3 panel width
  height: 480,   // pixels — adjust to content
  themeColors: true, // required: Figma injects its light/dark colour variables only when set
  title: "My Plugin Name",
});
```

## Closing the Plugin

```typescript
figma.closePlugin();           // Close silently
figma.closePlugin("Done!");    // Close with a toast message
```

## Notifications

```typescript
figma.notify("Operation complete!");                    // Info toast
figma.notify("Something went wrong", { error: true }); // Error toast
```

## Key Types

- `SceneNode` — Any node on the canvas
- `TextNode` — A text layer (`node.type === "TEXT"`)
- `FrameNode` — A frame/group (`node.type === "FRAME"`)
- `RectangleNode` — A rectangle shape
- `ComponentNode` — A component master
- `InstanceNode` — A component instance
