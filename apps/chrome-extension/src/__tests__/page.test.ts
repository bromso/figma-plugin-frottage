import { describe, expect, test } from "bun:test";
import {
  allowAccessAndRecapture,
  captureFilename,
  captureLabel,
  DEVICES,
  friendlyError,
  imageAdvice,
  isRestrictedUrl,
  LABEL_MAX,
  nodeAdvice,
  normaliseVersion,
  pageOrigin,
  pageVersion,
  parseChoices,
  parseWidths,
  popupView,
  rerunRequest,
  viewportAdvice,
  viewportStatusLabel,
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

describe("captureFilename with a version", () => {
  const day = new Date(2026, 9, 31, 12);
  test("adds the label to the name", () => {
    expect(captureFilename("https://example.com/", day, "Dark")).toBe(
      "example.com-2026-10-31-Dark.frottage"
    );
    expect(captureFilename("https://example.com/", day, "Svenska")).toBe(
      "example.com-2026-10-31-Svenska.frottage"
    );
  });
  test("a filename stays safe with / and .. in a label", () => {
    const name = captureFilename("https://example.com/", day, "../../etc/passwd\\x\u0000\n");
    expect(name).not.toMatch(/[/\\]/);
    expect([...name].some((c) => (c.codePointAt(0) ?? 0) < 0x20)).toBe(false);
    expect(name).not.toContain("..");
    expect(name.startsWith("example.com-2026-10-31-")).toBe(true);
    expect(name.endsWith(".frottage")).toBe(true);
  });
  test("a label with nothing usable leaves the name as it was", () => {
    expect(captureFilename("https://example.com/", day, "///")).toBe(
      "example.com-2026-10-31.frottage"
    );
    expect(captureFilename("https://example.com/", day, "...")).toBe(
      "example.com-2026-10-31.frottage"
    );
  });
});

describe("normaliseVersion", () => {
  test("a lone surrogate doesn't reach the file", () => {
    const label = normaliseVersion("theme", "Dark\ud83d")?.label ?? "";
    expect(label.isWellFormed()).toBe(true);
    expect(label).toBe("Dark\ufffd");
  });

  test("a cut through a character leaves a well-formed label", () => {
    const label = normaliseVersion("theme", `${"x".repeat(39)}\u{1F600}`)?.label ?? "";
    expect(label.isWellFormed()).toBe(true);
    expect(label.length).toBeLessThanOrEqual(40);
  });

  test("label is trimmed, and blank means no version", () => {
    expect(normaliseVersion("theme", "  Dark  ")).toEqual({ label: "Dark", kind: "theme" });
    expect(normaliseVersion("theme", "   ")).toBeUndefined();
    expect(normaliseVersion("theme", "")).toBeUndefined();
    expect(normaliseVersion("theme", undefined)).toBeUndefined();
  });
  test("an unknown kind means no version", () => {
    expect(normaliseVersion("mood", "Dark")).toBeUndefined();
    expect(normaliseVersion(undefined, "Dark")).toBeUndefined();
  });
  test("a label is cut to 40 characters, keeping the text as typed", () => {
    expect(normaliseVersion("language", "a/b".repeat(20))?.label).toBe(
      "a/b".repeat(20).slice(0, 40)
    );
  });
});

describe("pageVersion", () => {
  test("a viewport capture is labelled with what the page was laid out at", () => {
    expect(pageVersion("viewport", "", 1440)).toEqual({ label: "1440", kind: "viewport" });
  });

  test("a width label carries the typed label", () => {
    expect(pageVersion("viewport", "Dark", 1512)).toEqual({ label: "1512 Dark", kind: "viewport" });
    expect(pageVersion("viewport", "  ", 1512)).toEqual({ label: "1512", kind: "viewport" });
  });

  test("a long typed label is cut to fit", () => {
    const label = pageVersion("viewport", "x".repeat(40), 1512)?.label ?? "";
    expect(label.length).toBeLessThanOrEqual(LABEL_MAX);
    expect(label.startsWith("1512 ")).toBe(true);
  });

  test("the filename has no width, and carries a typed label", () => {
    const day = new Date(2026, 10, 1);
    expect(captureFilename("https://www.volvogroup.com/", day)).toBe(
      "www.volvogroup.com-2026-11-01.frottage"
    );
    expect(captureFilename("https://www.volvogroup.com/", day, "Dark")).toBe(
      "www.volvogroup.com-2026-11-01-Dark.frottage"
    );
  });

  test("a theme or language keeps the label it was given", () => {
    expect(pageVersion("theme", "Dark", 1440)).toEqual({ label: "Dark", kind: "theme" });
    expect(pageVersion(undefined, undefined, 1440)).toBeUndefined();
  });
});

describe("pageOrigin", () => {
  test("is the URL's origin and path, without query or fragment", () => {
    expect(pageOrigin("https://example.com/a?b=c#d")).toBe("https://example.com/a");
    expect(pageOrigin("https://example.com/a?z=1")).toBe(pageOrigin("https://example.com/a#y"));
    expect(pageOrigin("https://example.com/a")).not.toBe(pageOrigin("https://example.com/b"));
  });

  test("two local files differ, though every file: URL has the same origin", () => {
    expect(pageOrigin("file:///a.html")).not.toBe(pageOrigin("file:///b.html"));
    expect(pageOrigin("file:///a.html")).toBe(pageOrigin("file:///a.html"));
  });

  test("is null when there is no readable URL", () => {
    expect(pageOrigin(undefined)).toBeNull();
    expect(pageOrigin("not a url")).toBeNull();
  });
});

describe("DEVICES", () => {
  test("lists the eight sizes in order", () => {
    expect(DEVICES.map((d) => d.name)).toEqual([
      "TV",
      "Desktop",
      "Laptop",
      "Tablet landscape",
      "Tablet portrait",
      "Phone landscape",
      "Phone portrait",
      "Watch",
    ]);
    expect(DEVICES.map((d) => d.width)).toEqual([3840, 1440, 1512, 1194, 834, 844, 390, 198]);
    expect(DEVICES.filter((d) => d.on).map((d) => d.name)).toEqual([
      "Laptop",
      "Tablet portrait",
      "Phone portrait",
    ]);
  });

  test("landscape tablets and phones turn their icon", () => {
    expect(DEVICES.filter((d) => d.rotate).map((d) => d.name)).toEqual([
      "Tablet landscape",
      "Phone landscape",
    ]);
  });
});

describe("viewport widths", () => {
  test("parseWidths accepts 120 and 3840, and refuses 119 and 3841", () => {
    expect(parseWidths(["1600", " 900 ", "120", "3840"])).toEqual([1600, 900, 120, 3840]);
    expect(parseWidths(["119", "3841", "0", "-5", "", "abc", "12.5", "1e3"])).toEqual([]);
  });

  test("duplicates collapse, keeping the first position", () => {
    expect(parseWidths(["1440", "834", "1440", "0834"])).toEqual([1440, 834]);
  });

  test("saved choices come back, and anything malformed falls back to the defaults", () => {
    const defaults = parseChoices(null);
    expect(defaults.map((c) => c.text)).toEqual(DEVICES.map((d) => String(d.width)));
    expect(defaults.map((c) => c.on)).toEqual(DEVICES.map((d) => d.on));
    const saved = JSON.stringify(
      defaults.map((c, i) => (i === 0 ? { text: "2560", on: true } : c))
    );
    expect(parseChoices(saved)[0]).toEqual({ text: "2560", on: true });
    expect(parseChoices("not json")).toEqual(defaults);
    expect(parseChoices('[{"text":1}]')).toEqual(defaults);
  });

  test("saved choices in the old five-row shape fall back to the defaults", () => {
    const old = JSON.stringify(
      ["1512", "1440", "834", "393", "390"].map((text) => ({ text, on: true }))
    );
    expect(parseChoices(old)).toEqual(parseChoices(null));
  });
});

describe("captureLabel", () => {
  test("names how many sizes the button captures", () => {
    expect(captureLabel(0)).toBe("Capture");
    expect(captureLabel(1)).toBe("Capture 1 size");
    expect(captureLabel(3)).toBe("Capture 3 sizes");
  });
});

describe("popupView", () => {
  test("a run in progress shows over a page that can't be captured", () => {
    const running = { state: "viewport", index: 1, total: 3, label: "1512" } as const;
    expect(popupView(running, true)).toBe("run");
    expect(popupView(running, null)).toBe("run");
    expect(popupView({ state: "idle" }, true)).toBe("restricted");
    expect(popupView({ state: "idle" }, false)).toBe("sizes");
    expect(popupView({ state: "idle" }, null)).toBe("sizes");
  });
});

describe("viewportAdvice", () => {
  const base = {
    state: "viewport-done" as const,
    saved: [
      { label: "1440", width: 1440 },
      { label: "834", width: 834 },
    ],
    filename: "www.volvogroup.com-2026-11-01.frottage" as string | undefined,
    request: { widths: [1440, 834], collapseWrappers: false, versionLabel: "" },
    mismatched: [],
    skipped: [] as number[],
    nodes: 0,
    nodeLimit: false,
    blockedImages: 0,
  };

  test("lists what was saved", () => {
    const a = viewportAdvice(base);
    expect(a.saved).toEqual(["1440", "834"]);
    expect(a.summary).toBe("Saved www.volvogroup.com-2026-11-01.frottage with 1440 and 834.");
    expect(a.stopped).toBeNull();
    expect(a.mismatches).toEqual([]);
  });

  test("a run's real widths are listed when one differs", () => {
    const a = viewportAdvice({ ...base, mismatched: [{ requested: 1512, width: 1497 }] });
    expect(a.mismatches).toEqual(["1512 was captured at 1497."]);
  });

  test("a stopped run says why, and a cancelled one says so", () => {
    expect(
      viewportAdvice({ ...base, stopped: "The page changed address, so the run stopped." }).stopped
    ).toBe("The page changed address, so the run stopped.");
    expect(viewportAdvice({ ...base, cancelled: true }).stopped).toBe("You stopped the run.");
  });

  test("a large page gets the layer-count warning as before", () => {
    expect(viewportAdvice({ ...base, nodes: 12_000 }).nodeWarning).toContain("12,000");
  });

  test("a skipped width is named", () => {
    expect(viewportAdvice({ ...base, skipped: [3840] }).skipped).toEqual([
      "3840 couldn't be reached, so it was skipped.",
    ]);
  });

  test("carries the size and image flags", () => {
    const a = viewportAdvice({ ...base, nodeLimit: true, blockedImages: 3 });
    expect(a.nodeWarning).toContain("20,000");
    expect(a.blockedImages).toBe(3);
  });

  test("the saved line names the file and the widths", () => {
    const three = [
      { label: "1512", width: 1512 },
      { label: "834", width: 834 },
      { label: "390", width: 390 },
    ];
    expect(viewportAdvice({ ...base, saved: three }).summary).toBe(
      "Saved www.volvogroup.com-2026-11-01.frottage with 1512, 834 and 390."
    );
    expect(viewportAdvice({ ...base, saved: three.slice(0, 1) }).summary).toBe(
      "Saved www.volvogroup.com-2026-11-01.frottage with 1512."
    );
  });

  test("with no file the line says so, and a stop reason still shows", () => {
    const none = viewportAdvice({ ...base, saved: [], filename: undefined, cancelled: true });
    expect(none.summary).toBe("No file was saved.");
    expect(none.stopped).toBe("You stopped the run.");
    const partial = viewportAdvice({
      ...base,
      stopped: "The page changed address, so the run stopped.",
    });
    expect(partial.summary).toStartWith("Saved www.volvogroup.com-2026-11-01.frottage");
    expect(partial.stopped).toBe("The page changed address, so the run stopped.");
  });
});

describe("rerunRequest", () => {
  const done = {
    state: "viewport-done" as const,
    saved: [],
    mismatched: [],
    skipped: [] as number[],
    nodes: 0,
    nodeLimit: false,
    blockedImages: 0,
    request: { widths: [1512, 390], collapseWrappers: true, versionLabel: "Dark" },
  };

  test("a re-run sends the widths, label and wrappers setting the run was asked", () => {
    expect(rerunRequest(done)).toEqual({
      widths: [1512, 390],
      collapseWrappers: true,
      versionLabel: "Dark",
    });
  });

  test("a re-run can turn wrappers off or on without losing the rest", () => {
    expect(
      rerunRequest({ ...done, request: { ...done.request, collapseWrappers: false } }, true)
    ).toEqual({ widths: [1512, 390], collapseWrappers: true, versionLabel: "Dark" });
  });
});

describe("viewportStatusLabel", () => {
  test("names the width and place in the run", () => {
    expect(viewportStatusLabel({ state: "viewport", index: 2, total: 3, label: "1440" })).toBe(
      "Capturing 1440 (2 of 3)…"
    );
  });
});

describe("pageVersion under 500", () => {
  test("a plain capture under 500 is labelled with its width", () => {
    expect(pageVersion(undefined, undefined, 393)).toEqual({ label: "393", kind: "viewport" });
    expect(pageVersion("theme", "  ", 390)).toEqual({ label: "390", kind: "viewport" });
  });
  test("500 and over stay plain, and a given label wins", () => {
    expect(pageVersion(undefined, undefined, 500)).toBeUndefined();
    expect(pageVersion("theme", "Dark", 393)).toEqual({ label: "Dark", kind: "theme" });
  });
});

describe("a label in a filename", () => {
  const nameFor = (label: string) =>
    captureFilename("https://example.com/", new Date(2026, 10, 1), label);
  const part = (label: string) => nameFor(label).replace("example.com-2026-11-01", "");

  test.each([
    ["a zero-width space", "Da\u200brk"],
    ["a soft hyphen", "Da\u00adrk"],
    ["a joiner", "Da\u200drk"],
    ["a right-to-left override", "\u202eDark"],
    ["a byte order mark", "\ufeffDark"],
  ])("%s goes", (_, label) => {
    expect(part(label)).toBe("-Dark.frottage");
  });

  test.each([
    ["a line separator", "Dark\u2028mode"],
    ["a paragraph separator", "Dark\u2029mode"],
    ["a C1 control", "Dark\u0085mode"],
    ["a tilde", "Dark~mode"],
  ])("%s separates words", (_, label) => {
    expect(part(label)).toBe("-Dark-mode.frottage");
  });
});
