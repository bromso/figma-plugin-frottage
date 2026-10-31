// https://www.figma.com/plugin-docs/manifest/
export default {
  name: "Figma Plugin Template",
  id: "1222852692367737510",
  api: "1.0.0",
  main: "plugin.js",
  ui: "index.html",
  // Required for all new plugins. Figma loads pages lazily; node lookups across
  // pages must use the *Async APIs (e.g. figma.getNodeByIdAsync).
  documentAccess: "dynamic-page",
  // The template makes no network requests. Replace "none" with a domain list
  // (and add `reasoning`) if your plugin calls external services.
  networkAccess: { allowedDomains: ["none"] },
  capabilities: [],
  enableProposedApi: false,
  editorType: ["figma", "figjam"],
};
