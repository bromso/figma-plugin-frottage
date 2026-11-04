import { describe, expect, test } from "bun:test";
import type { Capture } from "@repo/capture-schema";
import { parseCssColor } from "@repo/capture-schema/css-values";
import { buildCatalogue, MAX_VARIABLES } from "../catalogue";
import type { PlanVarValue } from "../plan";
import { cap, el } from "./fixtures";

/** Stock shadcn on Tailwind v4: the root's computed values, the authored ones and `.dark`. */
function shadcn(): Capture {
  const capture = cap(el("root", [0, 0]));
  capture.source.url = "https://mainline.example.com/";
  capture.tokens = {
    cssCustomProperties: {
      "--radius": ".625rem",
      "--background": "oklch(1 0 0)",
      "--foreground": "oklch(0.145 0 0)",
      "--card": "oklch(1 0 0)",
      "--popover": "oklch(1 0 0)",
      "--border": "oklch(0.922 0 0)",
      "--spacing": ".25rem",
      "--text-sm": ".875rem",
      "--text-sm--line-height": "calc(1.25 / .875)",
      "--font-sans": "ui-sans-serif, system-ui, sans-serif",
      "--font-weight-medium": "500",
      "--tracking-tight": "-.025em",
      "--color-gray-200": "oklch(0.928 0.006 264.531)",
      "--color-background": "oklch(1 0 0)",
      "--color-card": "oklch(1 0 0)",
      "--color-popover": "oklch(1 0 0)",
      "--radius-lg": ".625rem",
      "--radius-md": "calc(.625rem - 2px)",
      "--tw-shadow": "0 0 #0000",
      "--tw-ring-color": "#fff",
    },
    authored: {
      "--color-background": "var(--background)",
      "--color-card": "var(--card)",
      "--color-popover": "var(--popover)",
      "--radius-lg": "var(--radius)",
      "--radius-md": "calc(var(--radius) - 2px)",
    },
    themes: [
      {
        context: ".dark",
        mode: "Dark",
        properties: {
          "--background": "oklch(0.145 0 0)",
          "--foreground": "oklch(0.985 0 0)",
          "--card": "oklch(0.205 0 0)",
          "--popover": "oklch(0.205 0 0)",
          "--border": "oklch(1 0 0 / 10%)",
        },
      },
    ],
  };
  return capture;
}

const rgba = (css: string) => parseCssColor(css) as NonNullable<ReturnType<typeof parseCssColor>>;

function expectColour(value: PlanVarValue | undefined, css: string) {
  const want = rgba(css);
  expect(typeof value).toBe("object");
  const got = value as { r: number; g: number; b: number; a: number };
  for (const c of ["r", "g", "b", "a"] as const) expect(got[c]).toBeCloseTo(want[c], 4);
}

describe("buildCatalogue", () => {
  test("theme properties hold Light from the root and Dark from the context", () => {
    const cat = buildCatalogue(shadcn());
    expect(cat.modes).toEqual(["Light", "Dark"]);
    expect(cat.themeSource).toBe("site");
    expect(cat.hostname).toBe("mainline.example.com");
    const dark = { background: "oklch(0.145 0 0)", card: "oklch(0.205 0 0)" } as const;
    for (const name of ["background", "card", "popover"] as const) {
      const v = cat.variables.find((x) => x.name === name);
      expect(v?.collection).toBe("theme");
      expect(v?.key).toBe(`theme:${name}`);
      expect(v?.type).toBe("COLOR");
      expect(v?.values).toHaveLength(2);
      expectColour(v?.values[0], "#ffffff");
      expectColour(v?.values[1], name === "background" ? dark.background : dark.card);
      expect(v?.scopes).toEqual(["ALL_FILLS", "STROKE_COLOR", "EFFECT_COLOR"]);
    }
  });

  test("descriptions name the site's property", () => {
    const cat = buildCatalogue(shadcn());
    expect(cat.byCssVar.get("--card")?.description).toBe("From the site: --card");
    expect(cat.resolveRef("--radius-md")?.description).toBe("From the site: --radius-md");
  });

  test("a Dark value with alpha keeps it", () => {
    const border = buildCatalogue(shadcn()).byCssVar.get("--border");
    expectColour(border?.values[1], "oklch(1 0 0 / 10%)");
    expect(border?.values[1]).toMatchObject({ a: expect.closeTo(0.1, 4) });
  });

  test("an alias of a theme property resolves to the theme variable", () => {
    const cat = buildCatalogue(shadcn());
    expect(cat.resolveRef("--color-card")?.key).toBe("theme:card");
    expect(cat.resolveRef("--color-popover")?.key).toBe("theme:popover");
    expect(cat.resolveRef("--card")?.key).toBe("theme:card");
    // A collapsed alias is not a variable of its own.
    expect(cat.variables.some((v) => v.cssVar === "--color-card")).toBe(false);
  });

  test("on a page with no theme, an alias of a primitive collapses into it", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens = {
      cssCustomProperties: {
        "--foreground": "#111111",
        "--color-foreground": "#111111",
        "--color-ink": "#111111",
      },
      authored: {
        "--color-foreground": "var(--foreground)",
        "--color-ink": "var(--color-foreground)",
      },
    };
    const cat = buildCatalogue(capture);
    expect(cat.variables.map((v) => v.name)).toEqual(["foreground"]);
    expect(cat.resolveRef("--color-foreground")?.key).toBe("primitives:foreground");
    expect(cat.resolveRef("--color-ink")?.key).toBe("primitives:foreground");
  });

  test("a theme value authored as a collapsed color alias aliases the primitive", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens = {
      cssCustomProperties: { "--zinc": "#111111", "--color-zinc": "#111111", "--card": "#ffffff" },
      authored: { "--color-zinc": "var(--zinc)" },
      themes: [{ context: ".dark", mode: "Dark", properties: { "--card": "var(--color-zinc)" } }],
    };
    const cat = buildCatalogue(capture);
    expect(cat.byCssVar.get("--card")?.values[1]).toEqual({ alias: "primitives:zinc" });
  });

  test("radius primitives evaluate calc() against the root", () => {
    const md = buildCatalogue(shadcn()).resolveRef("--radius-md");
    expect(md?.name).toBe("radius/md");
    expect(md?.key).toBe("primitives:radius/md");
    expect(md?.collection).toBe("primitives");
    expect(md?.type).toBe("FLOAT");
    expect(md?.values).toEqual([8]);
    expect(md?.scopes).toEqual(["CORNER_RADIUS"]);
  });

  test("spacing steps are made on demand from --spacing", () => {
    const cat = buildCatalogue(shadcn());
    const four = cat.resolveRef("--spacing*4");
    expect(four?.name).toBe("spacing/4");
    expect(four?.key).toBe("primitives:spacing/4");
    expect(four?.values).toEqual([16]);
    expect(four?.scopes).toEqual(["GAP", "WIDTH_HEIGHT"]);
    expect(cat.resolveRef("--spacing*4")).toBe(four);
    expect(cat.variables).toContain(four as NonNullable<typeof four>);
    expect(cat.resolveRef("--spacing*0.5")?.values).toEqual([2]);
  });

  test("type, font and color primitives follow the naming rules", () => {
    const cat = buildCatalogue(shadcn());
    const sm = cat.resolveRef("--text-sm");
    expect(sm?.name).toBe("text/sm");
    expect(sm?.values).toEqual([14]);
    expect(sm?.scopes).toEqual(["FONT_SIZE"]);
    // The line height belongs to `text/sm`; it is not a variable of its own.
    expect(cat.resolveRef("--text-sm--line-height")).toBeNull();
    expect(cat.variables.some((v) => v.name.includes("line-height"))).toBe(false);
    const sans = cat.resolveRef("--font-sans");
    expect(sans?.name).toBe("font/sans");
    expect(sans?.type).toBe("STRING");
    expect(sans?.values).toEqual(["ui-sans-serif"]);
    const medium = cat.resolveRef("--font-weight-medium");
    expect(medium?.name).toBe("font-weight/medium");
    expect(medium?.values).toEqual([500]);
    // Tailwind tracking is em-relative, so it is left out.
    expect(cat.resolveRef("--tracking-tight")).toBeNull();
    expect(cat.resolveRef("--color-gray-200")?.name).toBe("color/gray-200");
  });

  test("Tailwind internals produce nothing", () => {
    const cat = buildCatalogue(shadcn());
    expect(cat.resolveRef("--tw-shadow")).toBeNull();
    expect(cat.resolveRef("--tw-ring-color")).toBeNull();
    expect(cat.variables.some((v) => v.cssVar?.startsWith("--tw-"))).toBe(false);
  });

  test("framework prefixes are removed from names", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens.cssCustomProperties = { "--bs-primary": "#0d6efd", "--bs-border-radius": "6px" };
    const cat = buildCatalogue(capture);
    const primary = cat.resolveRef("--bs-primary");
    expect(primary?.name).toBe("primary");
    expect(primary?.description).toBe("From the site: --bs-primary");
    expect(primary?.cssVar).toBe("--bs-primary");
    expect(cat.resolveRef("--bs-border-radius")?.name).toBe("border/radius");
  });

  test("a theme value authored as var() of a primitive aliases it", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens = {
      cssCustomProperties: { "--color-white": "#fff", "--surface": "#fff", "--ink": "#000" },
      authored: { "--surface": "var(--color-white)" },
      themes: [
        {
          context: ".dark",
          mode: "Dark",
          properties: { "--surface": "var(--ink)", "--ink": "var(--color-white)" },
        },
      ],
    };
    const cat = buildCatalogue(capture);
    const surface = cat.byCssVar.get("--surface");
    expect(surface?.values[0]).toEqual({ alias: "primitives:color/white" });
    // `--ink` is a theme property, so Dark resolves it in the context: white.
    expectColour(surface?.values[1], "#ffffff");
    expect(cat.byCssVar.get("--ink")?.values[1]).toEqual({ alias: "primitives:color/white" });
  });

  test("equal values never alias by themselves", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens = {
      cssCustomProperties: { "--color-white": "#ffffff", "--surface": "#ffffff" },
      themes: [{ context: ".dark", mode: "Dark", properties: { "--surface": "#000000" } }],
    };
    const surface = buildCatalogue(capture).byCssVar.get("--surface");
    expectColour(surface?.values[0], "#ffffff");
  });

  test("a page captured in its Dark theme still reads Light from the root's base values", () => {
    const capture = shadcn();
    const dark = capture.tokens.themes?.[0]?.properties ?? {};
    const light: Record<string, string> = {};
    for (const [prop, value] of Object.entries(dark)) {
      light[prop] = capture.tokens.cssCustomProperties[prop] as string;
      capture.tokens.cssCustomProperties[prop] = value;
    }
    // What the page computed: the aliases already follow the dark values.
    capture.tokens.cssCustomProperties["--color-card"] = "oklch(0.205 0 0)";
    capture.tokens.activeTheme = "Dark";
    capture.tokens.base = light;
    const cat = buildCatalogue(capture);
    expect(cat.modes).toEqual(["Light", "Dark"]);
    expect(cat.activeMode).toBe("Dark");
    const card = cat.resolveRef("--color-card");
    expect(card?.key).toBe("theme:card");
    expectColour(card?.values[0], "#ffffff");
    expectColour(card?.values[1], "oklch(0.205 0 0)");
    const border = cat.byCssVar.get("--border");
    expectColour(border?.values[0], "oklch(0.922 0 0)");
    expectColour(border?.values[1], "oklch(1 0 0 / 10%)");
  });

  test("a context's value reaches a theme property through a root-only alias", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens = {
      cssCustomProperties: { "--brand": "#000000", "--ring-base": "#000000", "--ring": "#000000" },
      authored: { "--ring-base": "var(--brand)", "--ring": "var(--ring-base)" },
      themes: [
        {
          context: ".dark",
          mode: "Dark",
          properties: { "--brand": "#ffffff", "--ring": "var(--ring-base)" },
        },
      ],
    };
    const ring = buildCatalogue(capture).byCssVar.get("--ring");
    expectColour(ring?.values[0], "#000000");
    expectColour(ring?.values[1], "#ffffff");
  });

  test("an active Light theme, or one not among the modes, opens in Light", () => {
    const capture = shadcn();
    capture.tokens.activeTheme = "Light";
    expect(buildCatalogue(capture).activeMode).toBe("Light");
    capture.tokens.activeTheme = "Sepia";
    expect(buildCatalogue(capture).activeMode).toBe("Light");
    delete capture.tokens.activeTheme;
    expect(buildCatalogue(capture).activeMode).toBe("Light");
  });

  test("a capture with no themes has one Light mode and no theme source", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens.cssCustomProperties = { "--color-primary": "#2563eb" };
    const cat = buildCatalogue(capture);
    expect(cat.modes).toEqual(["Light"]);
    expect(cat.themeSource).toBe("none");
    const primary = cat.resolveRef("--color-primary");
    expect(primary?.collection).toBe("primitives");
    expect(primary?.values).toHaveLength(1);
  });

  test("values that are neither color nor length are left out", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens.cssCustomProperties = {
      "--ease": "cubic-bezier(.4, 0, .2, 1)",
      "--leading-tight": "1.25",
      "--indent": "2em",
    };
    expect(buildCatalogue(capture).variables).toEqual([]);
  });

  test("a value named like an Object.prototype member is just not a color", () => {
    const capture = cap(el("root", [0, 0]));
    capture.tokens.cssCustomProperties = {
      "--a": "constructor",
      "--b": "__proto__",
      "--c": "toString",
      "--d": "hasOwnProperty",
    };
    const cat = buildCatalogue(capture);
    expect(cat.variables).toEqual([]);
  });

  test("spacing steps must be finite and between 0 and 1000", () => {
    const cat = buildCatalogue(shadcn());
    expect(cat.resolveRef(`--spacing*${"9".repeat(400)}`)).toBeNull();
    expect(cat.resolveRef("--spacing*-2")).toBeNull();
    expect(cat.resolveRef("--spacing*1001")).toBeNull();
    expect(cat.resolveRef("--spacing*1000")?.values).toEqual([4000]);
    expect(cat.resolveRef("--spacing*0")?.values).toEqual([0]);
    const steps = cat.variables.filter((v) => v.name.startsWith("spacing/")).map((v) => v.name);
    expect(steps.sort()).toEqual(["spacing/0", "spacing/1000"]);
  });

  test("variables stop at the cap, theme first, and the rest are counted", () => {
    const capture = cap(el("root", [0, 0]));
    const props: Record<string, string> = { "--spacing": "4px", "--surface": "#fff" };
    for (let i = 0; i < MAX_VARIABLES + 5; i++) props[`--size-${i}`] = `${i + 1}px`;
    capture.tokens = {
      cssCustomProperties: props,
      authored: { "--surface": "var(--size-1010)" },
      themes: [{ context: ".dark", mode: "Dark", properties: { "--surface": "#000" } }],
    };
    const cat = buildCatalogue(capture);
    expect(cat.variables).toHaveLength(MAX_VARIABLES);
    expect(cat.variables.some((v) => v.key === "theme:surface")).toBe(true);
    // The theme variable takes one place, so the last six primitives go.
    expect(cat.dropped).toBe(6);
    expect(cat.resolveRef("--size-998")?.name).toBe("size/998");
    expect(cat.resolveRef("--size-999")).toBeNull();
    // Steps made on demand count against the cap too.
    expect(cat.resolveRef("--spacing*4")).toBeNull();
    expect(cat.resolveRef("--spacing*4")).toBeNull();
    expect(cat.dropped).toBe(7);
  });

  test("a theme alias to a primitive past the cap holds its value", () => {
    const capture = cap(el("root", [0, 0]));
    const props: Record<string, string> = { "--surface": "#fff" };
    for (let i = 0; i < MAX_VARIABLES; i++) props[`--size-${i}`] = `${i + 1}px`;
    props["--color-white"] = "#fff";
    capture.tokens = {
      cssCustomProperties: props,
      authored: { "--surface": "var(--color-white)" },
      themes: [{ context: ".dark", mode: "Dark", properties: { "--surface": "#000" } }],
    };
    const cat = buildCatalogue(capture);
    expect(cat.resolveRef("--color-white")).toBeNull();
    expectColour(cat.byCssVar.get("--surface")?.values[0], "#ffffff");
  });

  test("a hostile page with eight 2,000-property themes over 10,000 root properties is quick", () => {
    const capture = cap(el("root", [0, 0]));
    const root: Record<string, string> = {};
    const authored: Record<string, string> = {};
    for (let i = 0; i < 10_000; i++) {
      root[`--c${i}`] = `#${(i % 0xffffff).toString(16).padStart(6, "0")}`;
      if (i > 0) authored[`--c${i}`] = `var(--c${i - 1})`;
    }
    const themes = Array.from({ length: 8 }, (_, k) => {
      const properties: Record<string, string> = {};
      for (let j = 0; j < 2000; j++) properties[`--c${(k * 1250 + j) % 10_000}`] = "#000000";
      return { context: `.t${k}`, mode: `T${k}`, properties };
    });
    capture.tokens = { cssCustomProperties: root, authored, themes };
    const start = performance.now();
    const cat = buildCatalogue(capture);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(cat.modes).toHaveLength(9);
  });

  test("only the first 5,000 properties in name order are read; the rest count as dropped", () => {
    const capture = cap(el("root", [0, 0]));
    const root: Record<string, string> = {};
    // Listed out of order: the cut goes by name.
    for (let i = 19; i >= 0; i--) root[`--z${String(i).padStart(2, "0")}`] = `${i + 1}px`;
    for (let i = 0; i < 4_990; i++) root[`--a${String(i).padStart(4, "0")}`] = "ease-in";
    capture.tokens = {
      cssCustomProperties: root,
      authored: { "--z19": "var(--z00)" },
      themes: [{ context: ".dark", mode: "Dark", properties: { "--z15": "2px" } }],
    };
    const cat = buildCatalogue(capture);
    expect(cat.resolveRef("--z09")?.name).toBe("z09");
    expect(cat.resolveRef("--z10")).toBeNull();
    expect(cat.resolveRef("--z15")).toBeNull();
    expect(cat.dropped).toBe(10);
  });
});
