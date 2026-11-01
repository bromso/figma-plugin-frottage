import { describe, expect, test } from "bun:test";
import type { CaptureNode, ElementNode, TextNode } from "@repo/capture-schema";
import { isReadableName, layerName } from "../names";
import { el, textNode } from "./fixtures";

const o = { htmlNames: false };

function elem(sem: Partial<ElementNode["semantic"]> = {}, children: CaptureNode[] = []) {
  return el("e", [0, 0], children, { semantic: { tag: "div", ...sem } });
}
function words(text: string, tag = "p", id = "t"): TextNode {
  return textNode(id, { text, semantic: { tag } });
}

describe("priority order", () => {
  test("aria-label wins", () => {
    expect(layerName(elem({ ariaLabel: "Main menu" }), [], o)).toBe("Main menu");
  });
  test("landmarks", () => {
    expect(layerName(elem({ tag: "header", landmark: "banner" }), [], o)).toBe("Header");
    expect(layerName(elem({ tag: "nav", landmark: "navigation" }), [], o)).toBe("Navigation");
    expect(layerName(elem({ tag: "main", landmark: "main" }), [], o)).toBe("Main");
    expect(layerName(elem({ tag: "footer", landmark: "contentinfo" }), [], o)).toBe("Footer");
  });
  test("a labelled landmark", () => {
    expect(
      layerName(elem({ tag: "nav", landmark: "navigation", ariaLabel: "Main menu" }), [], o)
    ).toBe("Navigation - Main menu");
  });
  test("role names a generic element", () => {
    expect(layerName(elem({ role: "dialog" }), [], o)).toBe("Dialog");
  });
  test("a heading frame carries its text, its text node is just Heading", () => {
    const h = elem({ tag: "h1", headingLevel: 1 }, [words("Get started", "h1")]);
    expect(layerName(h, [], o)).toBe("H1 - Get started");
    expect(layerName(words("Get started", "h1"), [], o)).toBe("Heading");
  });
  test("interactive with text", () => {
    expect(layerName(elem({ tag: "a", href: "/p" }, [words("Pricing", "a")]), [], o)).toBe(
      "Link - Pricing"
    );
    expect(layerName(elem({ tag: "button" }, [words("Sign up", "button")]), [], o)).toBe(
      "Button - Sign up"
    );
  });
  test("an interactive element without text keeps its kind", () => {
    expect(layerName(elem({ tag: "button" }), [], o)).toBe("Button");
  });
  test("images read their alt", () => {
    const img = { ...el("i", [0, 0]), kind: "image", semantic: { tag: "img", alt: "A dog" } };
    expect(layerName(img as unknown as CaptureNode, [], o)).toBe("Image - A dog");
    const bare = { ...el("i", [0, 0]), kind: "image", semantic: { tag: "img" } };
    expect(layerName(bare as unknown as CaptureNode, [], o)).toBe("Image");
  });
});

describe("custom elements", () => {
  test("read as words without the short prefix", () => {
    expect(layerName(elem({ tag: "vcdk-search-field" }), [], o)).toBe("Search field");
  });
  test("with text", () => {
    expect(layerName(elem({ tag: "vcdk-link" }, [words("Careers", "vcdk-link")]), [], o)).toBe(
      "Link - Careers"
    );
  });
  test("a long first segment is part of the name", () => {
    expect(layerName(elem({ tag: "product-card" }), [], o)).toBe("Product card");
  });
});

describe("classes", () => {
  test("hashed classes are ignored", () => {
    expect(layerName(elem({ className: "css-1x2y3z" }), [], o)).toBe("Div");
    expect(layerName(elem({ className: "sc-abc123" }), [], o)).toBe("Div");
  });
  test("a readable class names the layer", () => {
    expect(layerName(elem({ className: "hero" }), [], o)).toBe("Hero");
    expect(layerName(elem({ className: "card__title" }), [], o)).toBe("Card title");
  });
  test("layout utilities are not names", () => {
    expect(layerName(elem({ className: "flex" }), [], o)).toBe("Div");
    expect(layerName(elem({ className: "mt-4" }), [], o)).toBe("Div");
  });
  test("htmlNames gives tag.class, or tag", () => {
    expect(layerName(elem({ className: "hero" }), [], { htmlNames: true })).toBe("div.hero");
    expect(layerName(elem({ className: "css-1x2y3z" }), [], { htmlNames: true })).toBe("div");
    expect(layerName(elem({ tag: "section" }), [], { htmlNames: true })).toBe("section");
  });
});

describe("from the page text", () => {
  test("a wrapper holding only text takes it", () => {
    expect(layerName(elem({}, [words("Sign up", "span")]), [], o)).toBe("Sign up");
  });
  test("a section is named by its first heading", () => {
    const s = elem({ tag: "section" }, [
      elem({ tag: "h2", headingLevel: 2 }, [words("Our brands", "h2")]),
      words("Lots of text here", "p", "p"),
    ]);
    expect(layerName(s, [], o)).toBe("Section - Our brands");
  });
  test("a card is named by its first heading", () => {
    const s = elem({ tag: "div" }, [words("Pricing", "h3"), words("Lots of text here", "p", "p")]);
    expect(layerName(s, [], o)).toBe("Card - Pricing");
  });
  test("text nodes name themselves from their first words", () => {
    expect(layerName(words("Hello there, world."), [], o)).toBe("Hello there, world");
  });
  test("whitespace collapses and trailing punctuation goes", () => {
    expect(layerName(words("  Hello \n   world!!  "), [], o)).toBe("Hello world");
  });
  test("long names stop at a word within 40 characters", () => {
    const n = layerName(
      words("The quick brown fox jumps over the lazy dog again and again"),
      [],
      o
    );
    expect(n).toBe("The quick brown fox jumps over the lazy");
    expect(n.length).toBeLessThanOrEqual(40);
    expect(layerName(words("x".repeat(80)), [], o).length).toBe(40);
  });
  test("a name that ends exactly at a word keeps it", () => {
    expect(layerName(words("a".repeat(36) + " bcd"), [], o)).toBe("a".repeat(36) + " bcd");
  });
});

describe("repeated siblings", () => {
  test("number from 1", () => {
    const a = elem({ tag: "li" });
    const b = { ...elem({ tag: "li" }), id: "b" };
    const sibs = [a, b];
    expect(layerName(a, sibs, o)).toBe("Item 1");
    expect(layerName(b, sibs, o)).toBe("Item 2");
  });
  test("a lone li is not numbered", () => {
    const a = elem({ tag: "li" });
    expect(layerName(a, [a], o)).toBe("Item");
  });
});

describe("fallbacks", () => {
  test("tags with a plain word", () => {
    expect(layerName(elem({ tag: "ul" }), [], o)).toBe("List");
    expect(layerName(elem({ tag: "p" }), [], o)).toBe("Paragraph");
  });
  test("table parts keep their own word, not a number", () => {
    const a = elem({ tag: "tr" });
    expect(layerName(a, [a, { ...elem({ tag: "tr" }), id: "b" }], o)).toBe("Row");
  });
  test("leading symbols are dropped from page text", () => {
    expect(layerName(words("→ Read more"), [], o)).toBe("Read more");
  });
  test("a bare div is Div", () => {
    expect(layerName(elem(), [], o)).toBe("Div");
  });
  test("isReadableName", () => {
    for (const bad of [
      "Div",
      "Span",
      "Frame",
      "div.flex",
      "Component 5",
      "Item 2",
      "Text",
      "Svg",
      "Btn",
    ]) {
      expect(isReadableName(bad)).toBe(false);
    }
    for (const good of ["Hero", "Link - Pricing", "Sign up"]) {
      expect(isReadableName(good)).toBe(true);
    }
  });
});

describe("fix round 1", () => {
  test("20,000 sibling divs are named in under a second", () => {
    const sibs = Array.from({ length: 20000 }, (_, i) => ({ ...elem(), id: `d${i}` }));
    const t = performance.now();
    const names = sibs.map((n) => layerName(n, sibs, o));
    expect(performance.now() - t).toBeLessThan(1000);
    expect(names[0]).toBe("Item 1");
    expect(names[19999]).toBe("Item 20000");
  });
  test("bare utilities are not names", () => {
    for (const c of [
      "btn",
      "truncate",
      "shrink",
      "underline",
      "uppercase",
      "rounded",
      "sr-only",
      "inline-flex",
      "antialiased",
      "transform",
      "hidden",
      "table",
      "contents",
    ]) {
      expect(layerName(elem({ className: c }), [], o)).toBe("Div");
    }
  });
  test("only the element that opens with the heading takes its name", () => {
    const h = elem({ tag: "h1", headingLevel: 1 }, [words("Hi there", "h1")]);
    const inner = { ...elem({}, [h]), id: "in" };
    const mid = { ...elem({}, [inner]), id: "mid" };
    const outer = { ...elem({}, [mid]), id: "out" };
    expect(layerName(inner, [], o)).toBe("Card - Hi there");
    expect(layerName(mid, [], o)).toBe("Div");
    expect(layerName(outer, [], o)).toBe("Div");
  });
  test("a provider custom element is a plain frame", () => {
    const page = elem({ tag: "vcdk-theme-provider" }, [words("Hello", "p")]);
    expect(layerName(page, [], o)).toBe("Frame");
  });
  test("a custom element with a lot of text takes no text suffix", () => {
    const kids = Array.from({ length: 60 }, (_, i) => words(`t${i}`, "p", `t${i}`));
    expect(layerName(elem({ tag: "x-shell" }, [words("One", "p"), ...kids]), [], o)).toBe("Shell");
  });
  test("clip never splits a surrogate pair", () => {
    const n = layerName(words("😀".repeat(60)), [], o);
    expect(Array.from(n).length).toBe(40);
    expect(n).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
  test("an emoji-only label is kept", () => {
    expect(layerName(words("🔥"), [], o)).toBe("🔥");
  });
  test("leading + # and @ stay", () => {
    expect(layerName(words("+12 new"), [], o)).toBe("+12 new");
    expect(layerName(words("#1 pick"), [], o)).toBe("#1 pick");
    expect(layerName(words("@jonas"), [], o)).toBe("@jonas");
  });
  test("a readable id names the layer after the class", () => {
    expect(layerName(elem({ id: "pricing" }), [], o)).toBe("Pricing");
    expect(layerName(elem({ id: "pricing", className: "hero" }), [], o)).toBe("Hero");
    expect(layerName(elem({ id: "css-1x2y3z" }), [], o)).toBe("Div");
  });
});

describe("names that match Object.prototype", () => {
  for (const word of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    test(`${word} as a role gives a plain name`, () => {
      expect(layerName(elem({ role: word }), [], o)).toBe("Div");
      expect(layerName(elem({ role: word, ariaLabel: "Menu" }), [], o)).toBe("Menu");
    });
    test(`${word} as a landmark gives a plain name`, () => {
      expect(layerName(elem({ landmark: word }), [], o)).toBe("Div");
    });
    test(`${word} as a tag gives a string`, () => {
      expect(typeof layerName(elem({ tag: word }), [], o)).toBe("string");
      expect(typeof layerName(elem({ tag: word }, [words("Only text")]), [], o)).toBe("string");
    });
  }
  test("a tag named constructor reads as text, not as a function", () => {
    expect(layerName(elem({ tag: "constructor" }), [], o)).toBe("Constructor");
    expect(layerName(elem({ tag: "constructor" }, [words("Hello")]), [], o)).toBe("Hello");
  });
});
