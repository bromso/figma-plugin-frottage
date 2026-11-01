import { describe, expect, test } from "bun:test";
import { cleanCss, cleanText, cleanUrl, firstUrlInCss, fullUrlOf, rememberUrl } from "../urls";

describe("cleanUrl", () => {
  test.each([
    ["https://x.com/a/b.png?token=1&b=2#frag", "https://x.com/a/b.png"],
    ["https://user:pw@x.com:8443/a", "https://x.com:8443/a"],
    ["https://x.com/", "https://x.com/"],
    ["mailto:ada@example.com?subject=hi", "mailto:ada@example.com"],
    ["javascript:void(document.cookie)", "javascript:"],
    ["blob:https://x.com/1234", "blob:https://x.com/1234"],
    ["/relative/a.png?token=1#x", "/relative/a.png"],
    ["not a url?secret=1", "not a url"],
    ["//u:p@x.com/a?b", "//x.com/a"],
  ])("%s", (raw, clean) => {
    expect(cleanUrl(raw)).toBe(clean);
  });

  test("a long data URL becomes a short head and its length", () => {
    const url = `data:text/csv;base64,${"A".repeat(5000)}`;
    const out = cleanUrl(url);
    expect(out.length).toBeLessThan(200);
    expect(out).toContain("[5021 chars]");
  });
});

describe("cleanCss", () => {
  test("cleans every url() and bare URL, and leaves the rest", () => {
    expect(cleanCss('image-set(url("https://x/a.png?t=1") 1x, url(b.png?t=2) 2x)')).toBe(
      'image-set(url("https://x/a.png") 1x, url("b.png") 2x)'
    );
    expect(cleanCss("https://u:p@x/v1?key=1 rest")).toBe("https://x/v1 rest");
    expect(cleanCss("12px solid red")).toBe("12px solid red");
  });
  test("a quoted URL with spaces is cleaned whole", () => {
    expect(cleanCss('url("https://x/a b.png?t=one two")')).toBe('url("https://x/a%20b.png")');
  });
});

describe("cleanText", () => {
  test.each([
    ["/reset?token=SECRET", "/reset"],
    ["./reset?token=SECRET", "./reset"],
    ["../reset#SECRET", "../reset"],
    ["//cdn.test/x?token=SECRET", "//cdn.test/x"],
    ["https://a.test/x,y?token=SECRET", "https://a.test/x,y"],
    ["https://a.test/(x)?token=SECRET", "https://a.test/(x)"],
    ["see /reset?token=SECRET now", "see /reset now"],
    ['"/reset?token=SECRET"', '"/reset"'],
    ["(/reset?token=SECRET)", "(/reset)"],
    ["href=/reset?token=SECRET", "href=/reset"],
    ["a /b?t=SECRET,/c?t=SECRET", "a /b"],
    ["[/reset?token=SECRET]", "[/reset]"],
    ["</reset?token=SECRET>", "</reset>"],
    ["{/reset?token=SECRET}", "{/reset}"],
    ["a|/reset?token=SECRET", "a|/reset"],
    ["a|/reset?token=SECRET|RET", "a|/reset"],
  ])("takes the query off %s", (raw, clean) => {
    expect(cleanText(raw)).toBe(clean);
  });

  test.each([
    "Why? Because",
    "Is it 1/2? Yes",
    "and/or? Both",
    "Issue #12 and C#",
    "What is /etc/passwd? A file",
    "1 / 2 # 3",
    "Rock & roll!",
    "[Why? Because]",
    "{a|b}? Yes",
    "<b>Why?</b> Because",
    "a | b # c",
  ])("leaves prose alone: %s", (text) => {
    expect(cleanText(text)).toBe(text);
  });

  test("cleans URLs inside an error message", () => {
    expect(cleanText("Could not load https://x/a?token=1, sorry")).toBe(
      "Could not load https://x/a, sorry"
    );
  });
});

test("firstUrlInCss returns the raw URL, unescaped", () => {
  expect(firstUrlInCss('url("https://x/a\\"b.png?t=1")')).toBe('https://x/a"b.png?t=1');
  expect(firstUrlInCss("linear-gradient(red, blue)")).toBeNull();
});

test("a remembered URL stays with its object", () => {
  const key = {};
  expect(fullUrlOf(key)).toBeUndefined();
  rememberUrl(key, "https://x/?t=1");
  expect(fullUrlOf(key)).toBe("https://x/?t=1");
});
