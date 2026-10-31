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
    for (const bad of ["Div", "Span", "Frame", "div.flex", "Component 5", "Text", "Svg"]) {
      expect(isReadableName(bad)).toBe(false);
    }
    for (const good of ["Hero", "Link - Pricing", "Item 2", "Sign up"]) {
      expect(isReadableName(good)).toBe(true);
    }
  });
});
