// https://developer.chrome.com/docs/extensions/reference/manifest
import pkg from "./package.json";

export default {
  manifest_version: 3,
  name: "Frottage",
  version: pkg.version,
  description: "Capture the rendered page into a .frottage file for the Frottage Figma plugin.",
  minimum_chrome_version: "116",
  // activeTab + scripting inject the capture script only into the tab the user clicked;
  // offscreen builds the Blob URL and downloads saves the file. No host permissions.
  permissions: ["activeTab", "scripting", "downloads", "offscreen"],
  action: { default_title: "Frottage", default_popup: "popup.html" },
  background: { service_worker: "service-worker.js", type: "module" },
};
