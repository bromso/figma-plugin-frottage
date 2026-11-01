import { describe, expect, test } from "bun:test";
import {
  allowAccessAndRecapture,
  captureFilename,
  friendlyError,
  imageAdvice,
  isRestrictedUrl,
  nodeAdvice,
} from "../page";

describe("isRestrictedUrl", () => {
  test.each([
    "chrome://extensions",
    "chrome-extension://abc/popup.html",
    "edge://settings",
    "about:blank",
    "https://chromewebstore.google.com/detail/x",
    "https://chrome.google.com/webstore/detail/x",
  ])("%p is restricted", (url) => {
    expect(isRestrictedUrl(url)).toBe(true);
  });

  test.each([
    undefined,
    "",
    "not a url",
    "https://example.com/",
    "http://localhost:3000/",
    "file:///a/landing.html",
  ])("%p is capturable", (url) => {
    expect(isRestrictedUrl(url)).toBe(false);
  });
});

describe("captureFilename", () => {
  const day = new Date(2026, 9, 31, 12);
  test("uses hostname and local date", () => {
    expect(captureFilename("https://www.example.com/a?b", day)).toBe(
      "www.example.com-2026-10-31.frottage"
    );
  });
  test("always the hostname, port or not", () => {
    expect(captureFilename("https://staging.example.com:8443/", day)).toBe(
      "staging.example.com-2026-10-31.frottage"
    );
    expect(captureFilename("http://127.0.0.1:3000/", day)).toBe("127.0.0.1-2026-10-31.frottage");
    expect(captureFilename("http://localhost:8080/", day)).toBe("localhost-2026-10-31.frottage");
    expect(captureFilename("http://[::1]:8080/", day)).toBe("ipv6--1-2026-10-31.frottage");
  });
  test("page for an empty hostname (file:)", () => {
    expect(captureFilename("file:///a/landing.html", day)).toBe("page-2026-10-31.frottage");
  });
  test("page for unparsable URLs", () => {
    expect(captureFilename("not a url", day)).toBe("page-2026-10-31.frottage");
  });
  test("sanitises unsafe characters", () => {
    expect(captureFilename("https://xn--bcher-kva.example/", day)).toBe(
      "xn--bcher-kva.example-2026-10-31.frottage"
    );
    expect(captureFilename("https://a_b%2F..c.test/", day)).not.toMatch(/[/\\%]/);
  });
});

describe("friendlyError", () => {
  test.each([
    "Cannot access a chrome:// URL",
    "The extensions gallery cannot be scripted.",
    "Frame with ID 0 is showing error page",
    "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
  ])("maps %p to the restricted message", (raw) => {
    expect(friendlyError(raw)).toBe("This page can't be captured.");
  });
  test("explains file URLs", () => {
    expect(friendlyError('Cannot access contents of url "file:///a/b.html".')).toMatch(
      /Allow access to file URLs/
    );
  });
  test("leaves other errors alone", () => {
    expect(friendlyError("disk full")).toBe("disk full");
  });
});

describe("nodeAdvice", () => {
  test("the popup warns at 5,000 nodes", () => {
    expect(nodeAdvice(4_999, false)).toEqual({ warning: null, offerCollapse: false });
    const advice = nodeAdvice(5_000, false);
    expect(advice.warning).toMatch(/5,000 layers/);
    expect(advice.warning).not.toMatch(/DOM/);
    expect(advice.offerCollapse).toBe(false);
  });
  test("at 20,000 nodes the popup offers a capture without wrappers", () => {
    expect(nodeAdvice(20_000, true).offerCollapse).toBe(true);
    expect(nodeAdvice(20_000, true).warning).toMatch(/left out/);
    // Reaching the count without the limit warning is not a stop.
    expect(nodeAdvice(20_000, false).offerCollapse).toBe(true);
  });
});

describe("imageAdvice", () => {
  test("says nothing when no image was blocked", () => {
    expect(imageAdvice(0, false)).toBeNull();
  });

  test("counts blocked images and offers access when it is not held", () => {
    const a = imageAdvice(3, false);
    expect(a?.message).toContain("3 images could not be read");
    expect(a?.message).toContain("does not allow");
    expect(a?.offerAccess).toBe(true);
    expect(imageAdvice(1, false)?.message).toContain("1 image could not be read");
  });

  test("offers no button once access is held, because the fallback already ran", () => {
    const a = imageAdvice(2, true);
    expect(a?.message).toContain("2 images could not be fetched");
    expect(a?.message).not.toContain("does not allow");
    expect(a?.offerAccess).toBe(false);
  });
});

describe("allowAccessAndRecapture", () => {
  test("after a grant the capture runs again", async () => {
    let runs = 0;
    expect(
      await allowAccessAndRecapture(
        async () => true,
        () => runs++
      )
    ).toBe(true);
    expect(runs).toBe(1);
  });

  test("a declined request keeps everything as it was", async () => {
    let runs = 0;
    expect(
      await allowAccessAndRecapture(
        async () => false,
        () => runs++
      )
    ).toBe(false);
    expect(runs).toBe(0);
  });

  test("a request that throws changes nothing", async () => {
    let runs = 0;
    const request = async () => {
      throw new Error("no gesture");
    };
    expect(await allowAccessAndRecapture(request, () => runs++)).toBe(false);
    expect(runs).toBe(0);
  });
});
