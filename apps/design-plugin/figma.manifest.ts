// https://www.figma.com/plugin-docs/manifest/
export default {
  name: "Frottage",
  // Placeholder: the owner replaces this with a real Figma plugin ID at publication.
  id: "frottage-dev",
  api: "1.0.0",
  main: "plugin.js",
  ui: "index.html",
  // Required for all new plugins. Figma loads pages lazily; node lookups across
  // pages must use the *Async APIs (e.g. figma.getNodeByIdAsync).
  documentAccess: "dynamic-page",
  // ["none"] is deliberate: Frottage makes no network requests. Pages arrive as
  // .frottage files the user opens, so the plugin never needs a domain allowlist.
  networkAccess: { allowedDomains: ["none"] },
  capabilities: [],
  enableProposedApi: false,
  editorType: ["figma"],
};
