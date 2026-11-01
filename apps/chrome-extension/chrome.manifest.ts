// https://developer.chrome.com/docs/extensions/reference/manifest
import pkg from "./package.json";

export default {
  manifest_version: 3,
  name: "Frottage",
  version: pkg.version,
  description: "Capture the rendered page into a .frottage file for the Frottage Figma plugin.",
  minimum_chrome_version: "116",
  // activeTab + scripting inject the capture script only into the tab the user clicked;
  // offscreen builds the Blob URL and downloads saves the file. No required host permissions.
  permissions: ["activeTab", "scripting", "downloads", "offscreen"],
  // Asked for at runtime, from a click, so blocked CDN images can be fetched by the worker.
  optional_host_permissions: ["<all_urls>"],
  action: { default_title: "Frottage", default_popup: "popup.html" },
  background: { service_worker: "service-worker.js", type: "module" },
};
