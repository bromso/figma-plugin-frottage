import { describe, expect, test } from "bun:test";
import manifest from "../../chrome.manifest";
import pkg from "../../package.json";

describe("manifest", () => {
  test("requests exactly the agreed permissions", () => {
    expect([...manifest.permissions].sort()).toEqual([
      "activeTab",
      "downloads",
      "offscreen",
      "scripting",
    ]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest.manifest_version).toBe(3);
  });

  test("host access is optional, and required permissions are unchanged", () => {
    expect(manifest.optional_host_permissions).toEqual(["<all_urls>"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest.permissions).not.toContain("<all_urls>");
  });

  test("needs Chrome 127, the first with openPopup", () => {
    expect(manifest.minimum_chrome_version).toBe("127");
  });

  test("version comes from package.json", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  test("declares no content scripts and a module worker", () => {
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest.background.service_worker).toBe("service-worker.js");
  });
});
