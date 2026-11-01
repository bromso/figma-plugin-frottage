import { describe, expect, test } from "bun:test";
import { unpackFrottage } from "@repo/capture-schema";
import { groupVersions, type LoadedFile, pageKey } from "../versions";
import { versionFile } from "./helpers";

async function load(file: File): Promise<LoadedFile> {
  const { capture, assets } = unpackFrottage(new Uint8Array(await file.arrayBuffer()));
  return { name: file.name, capture, assets };
}

const names = (files: LoadedFile[]) => files.map((f) => f.name);

describe("groupVersions", () => {
  test("files for one page form one set, in viewport width order, widest first", async () => {
    const files = await Promise.all([
      load(versionFile({ name: "a", width: 834, label: "834" })),
      load(versionFile({ name: "b", width: 1425, label: "1440" })),
      load(versionFile({ name: "c", width: 1512, label: "1512" })),
    ]);
    const sets = groupVersions(files);
    expect(sets).toHaveLength(1);
    expect(names(sets[0]?.versions ?? [])).toEqual(["c", "b", "a"]);
    // The label stays what the user chose, though the client width reads 1425.
    expect(sets[0]?.versions[1]?.capture.version?.label).toBe("1440");
  });

  test("theme and language versions follow in file order", async () => {
    const files = await Promise.all([
      load(versionFile({ name: "dark", width: 1440, label: "Dark", kind: "theme" })),
      load(versionFile({ name: "narrow", width: 834, label: "834" })),
      load(versionFile({ name: "sv", width: 1440, label: "Svenska", kind: "language" })),
      load(versionFile({ name: "wide", width: 1440, label: "1440" })),
    ]);
    expect(names(groupVersions(files)[0]?.versions ?? [])).toEqual([
      "wide",
      "narrow",
      "dark",
      "sv",
    ]);
  });

  test("a file without a label is labelled by its width", async () => {
    const [set] = groupVersions([await load(versionFile({ name: "a", width: 1280 }))]);
    expect(set?.versions[0]?.capture.version).toEqual({ label: "1280", kind: "viewport" });
  });

  test("pages compare by cleaned URL, ignoring a trailing slash, in first-seen order", async () => {
    const files = await Promise.all([
      load(versionFile({ name: "a", url: "https://one.example/p/" })),
      load(versionFile({ name: "b", url: "https://two.example/" })),
      load(versionFile({ name: "c", url: "https://one.example/p" })),
    ]);
    const sets = groupVersions(files);
    expect(sets.map((s) => names(s.versions))).toEqual([["a", "c"], ["b"]]);
  });

  test("equal widths keep file order", async () => {
    const files = await Promise.all([
      load(versionFile({ name: "first", width: 1440, label: "1440" })),
      load(versionFile({ name: "second", width: 1440, label: "1440" })),
      load(versionFile({ name: "third", width: 1440, label: "1440" })),
    ]);
    expect(names(groupVersions(files)[0]?.versions ?? [])).toEqual(["first", "second", "third"]);
  });

  test("an unlabelled file sorts by width among labelled ones and takes its width as label", async () => {
    const files = await Promise.all([
      load(versionFile({ name: "a", width: 834, label: "Tablet" })),
      load(versionFile({ name: "plain", width: 1280 })),
      load(versionFile({ name: "c", width: 1512, label: "Wide" })),
    ]);
    const versions = groupVersions(files)[0]?.versions ?? [];
    expect(names(versions)).toEqual(["c", "plain", "a"]);
    expect(versions.map((v) => v.capture.version?.label)).toEqual(["Wide", "1280", "Tablet"]);
  });

  test("pageKey drops query, fragment and trailing slash, and survives a bad URL", () => {
    expect(pageKey("https://example.com/a/?x=1#top")).toBe("https://example.com/a");
    expect(pageKey("https://example.com/a")).toBe(pageKey("https://example.com/a/"));
    expect(pageKey("not a url/")).toBe("not a url");
  });
});
