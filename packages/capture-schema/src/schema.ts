import { z } from "zod";

export const SCHEMA_VERSION = 1;

const unit = z.number().min(0).max(1);
const color = z.object({ r: unit, g: unit, b: unit, a: unit });
const box = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
const four = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const border = z.object({
  width: z.number(),
  color,
  style: z.string(),
});

const borders = z.object({
  top: border,
  right: border,
  bottom: border,
  left: border,
});

const stop = z.object({ color, position: z.number() });

/** Past this a file is refused; the walker cuts a gradient here, so its captures still import. */
export const MAX_GRADIENT_STOPS = 256;

const backgroundImage = z.object({
  type: z.enum(["linear-gradient", "radial-gradient", "conic-gradient", "image"]),
  css: z.string(),
  assetHash: z.string().optional(),
  stops: z.array(stop).max(MAX_GRADIENT_STOPS).optional(),
  angle: z.number().optional(),
  size: z.string().optional(),
  position: z.string().optional(),
  repeat: z.string().optional(),
});

const boxShadow = z.object({
  inset: z.boolean(),
  x: z.number(),
  y: z.number(),
  blur: z.number(),
  spread: z.number(),
  color,
});

const style = z.object({
  backgroundColor: color,
  backgroundImages: z.array(backgroundImage),
  borders,
  // [topLeft, topRight, bottomRight, bottomLeft]
  borderRadius: four,
  boxShadows: z.array(boxShadow),
  filters: z.array(z.string()),
  backdropFilter: z.string().optional(),
  /** `background-clip`, only when it is not `border-box`. */
  backgroundClip: z.string().optional(),
  overflow: z.string(),
  clip: box.optional(),
});

const MAX_HOVER_SHADOWS = 8;

/** What `:hover` changes on an element: only these properties, only their parsed values. */
const hoverBase = z.object({
  backgroundColor: color.optional(),
  color: color.optional(),
  /** The element's computed `color` at rest, set with `color`: text that has it inherits the hover. */
  restingColor: color.optional(),
  borderColor: color.optional(),
  opacity: unit.optional(),
  decoration: z.string().max(60).optional(),
});
const hover = hoverBase.extend({
  boxShadows: z.array(boxShadow).max(MAX_HOVER_SHADOWS).optional(),
});

/** `--name`, or `--name*n` for `calc(var(--name) * n)`. */
const ref = z
  .string()
  .max(80)
  .regex(/^--[A-Za-z0-9_-]+(?:\*-?(?:\d+\.?\d*|\.\d+))?$/);

/** A rounding utility's size, as `md` for `.rounded-md`, or `DEFAULT` for bare `.rounded`. */
const radiusClass = z
  .string()
  .max(20)
  .regex(/^(?:DEFAULT|[a-z0-9.]+)$/)
  .nullable();

/** Which custom property each property's winning rule used, where the page's value agrees. */
const tokenRefs = z.object({
  background: ref.optional(),
  color: ref.optional(),
  border: ref.optional(),
  radius: ref.optional(),
  // [top-left, top-right, bottom-right, bottom-left]: the class of each corner's winning rule.
  radiusClass: z.tuple([radiusClass, radiusClass, radiusClass, radiusClass]).optional(),
  // [top, right, bottom, left]
  padding: z.tuple([ref.nullable(), ref.nullable(), ref.nullable(), ref.nullable()]).optional(),
  gap: ref.optional(),
  fontSize: ref.optional(),
  lineHeight: ref.optional(),
  letterSpacing: ref.optional(),
  fontFamily: ref.optional(),
  fontWeight: ref.optional(),
});

/** Past this many props a component is refused; the probe keeps no more. */
const MAX_COMPONENT_PROPS = 16;

/**
 * The page's component an element is the root of, as the probe found it. Only values that can't
 * hold what a person typed: a boolean, a finite number or a short plain word.
 */
const component = z.object({
  source: z.enum(["react", "vue", "marker"]),
  name: z.string().min(1).max(40),
  props: z
    .record(
      z.string().min(1).max(40),
      z.union([z.string().regex(/^[A-Za-z0-9_-]{1,24}$/), z.number(), z.boolean()])
    )
    .refine((p) => Object.keys(p).length <= MAX_COMPONENT_PROPS, "too many props")
    // The refine is code, so the JSON Schema states the bound itself.
    .meta({ maxProperties: MAX_COMPONENT_PROPS }),
  /** The minified code name a `data-slot` name replaced, only then. */
  codeName: z.string().min(1).max(40).optional(),
});

const marginAuto = z.tuple([z.boolean(), z.boolean(), z.boolean(), z.boolean()]);

const layout = z.object({
  display: z.string(),
  position: z.string(),
  flexDirection: z.string().optional(),
  flexWrap: z.string().optional(),
  justifyContent: z.string().optional(),
  alignItems: z.string().optional(),
  alignSelf: z.string().optional(),
  gap: z.tuple([z.number(), z.number()]).optional(),
  padding: four,
  margin: four,
  // `margin` holds used pixels, so this says which sides were `auto`: [top, right, bottom, left].
  marginAuto: marginAuto.optional(),
  order: z.number(),
  grow: z.number(),
  shrink: z.number(),
  rowGap: z.number().optional(),
  columnGap: z.number().optional(),
  // Resolved px tracks, as computed style gives them.
  gridTemplateColumns: z.string().optional(),
  gridTemplateRows: z.string().optional(),
  // The stylesheet's value, kept only when it shows `fr`, which computed style resolves away.
  authoredGridTemplateColumns: z.string().optional(),
  authoredGridTemplateRows: z.string().optional(),
  gridColumn: z.string().optional(),
  gridRow: z.string().optional(),
});

const semantic = z.object({
  tag: z.string(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  headingLevel: z.number().int().min(1).max(6).optional(),
  landmark: z.string().optional(),
  href: z.string().optional(),
  alt: z.string().optional(),
  // The first class token, when it reads as a name: never hashed, never longer than 40.
  className: z.string().max(40).optional(),
  // The element id, under the same filters as className.
  id: z.string().max(40).optional(),
});

const common = {
  id: z.string(),
  box,
  paintOrder: z.number(),
  /** Computed z-index, only for a positioned box (or a flex or grid item) whose value is not `auto`. */
  zIndex: z.number().int().optional(),
  visible: z.boolean(),
  opacity: unit,
  blendMode: z.string(),
  transform: z
    .tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
    .optional(),
  semantic,
};

const textRun = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  family: z.string(),
  weight: z.number(),
  style: z.string(),
  size: z.number(),
  lineHeight: z.number().nullable(),
  letterSpacing: z.number(),
  color,
  decoration: z.string(),
  transform: z.string(),
  align: z.string(),
  /** Cleaned http(s) target of the link the text sits in; no query, fragment or userinfo. */
  href: z.string().optional(),
});

const textNode = z.object({
  ...common,
  kind: z.literal("text"),
  text: z.string(),
  lines: z.array(box),
  runs: z.array(textRun),
  tokenRefs: tokenRefs.optional(),
});

// How a leaf sits among its siblings; left out when static or zero. Elements have `layout`.
const flow = {
  position: z.string().optional(),
  margin: four.optional(),
  marginAuto: marginAuto.optional(),
};

const imageNode = z.object({
  ...common,
  ...flow,
  kind: z.literal("image"),
  assetHash: z.string().optional(),
  sourceUrl: z.string().optional(),
  fit: z.enum(["cover", "contain", "fill", "none", "tile"]),
  objectPosition: z.string(),
  borders,
  // [topLeft, topRight, bottomRight, bottomLeft]
  borderRadius: four,
  tokenRefs: tokenRefs.optional(),
});

const svgNode = z.object({
  ...common,
  ...flow,
  kind: z.literal("svg"),
  markup: z.string(),
  /** Computed overflow of the `<svg>`; browsers clip inline SVG unless this is `visible`. */
  overflow: z.string().optional(),
});

const placeholderNode = z.object({
  ...common,
  ...flow,
  kind: z.literal("placeholder"),
  placeholderKind: z.enum(["canvas", "video", "cross-origin-iframe", "blocked-image"]),
  sourceUrl: z.string().optional(),
  assetHash: z.string().optional(),
});

const elementBase = z.object({
  ...common,
  kind: z.literal("element"),
  style,
  layout,
  hover: hover.optional(),
  tokenRefs: tokenRefs.optional(),
  component: component.optional(),
});

const elementNode = z.object({
  ...elementBase.shape,
  get children(): z.ZodArray<z.ZodType<CaptureNode>> {
    return z.array(nodeSchema);
  },
});

const nodeSchema: z.ZodType<CaptureNode> = z.discriminatedUnion("kind", [
  elementNode,
  textNode,
  imageNode,
  svgNode,
  placeholderNode,
]) as unknown as z.ZodType<CaptureNode>;

export type TextNode = z.infer<typeof textNode>;
export type ImageNode = z.infer<typeof imageNode>;
export type SvgNode = z.infer<typeof svgNode>;
export type PlaceholderNode = z.infer<typeof placeholderNode>;
export type TokenRefs = z.infer<typeof tokenRefs>;
export type CaptureComponent = z.infer<typeof component>;
export type ElementNode = z.infer<typeof elementBase> & {
  children: CaptureNode[];
};
export type CaptureNode = ElementNode | TextNode | ImageNode | SvgNode | PlaceholderNode;

const MAX_THEMES = 8;
const MAX_THEME_PROPERTIES = 2000;
const MAX_MODE_LENGTH = 40;
const MAX_CONTEXT_LENGTH = 200;
const MAX_BREAKPOINTS = 8;

export const captureSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  capturedAt: z.string(),
  tool: z.object({ name: z.string(), version: z.string() }),
  source: z.object({
    url: z.string(),
    title: z.string(),
    viewport: z.object({ w: z.number(), h: z.number() }),
    scrollSize: z.object({ w: z.number(), h: z.number() }),
    devicePixelRatio: z.number(),
    colorScheme: z.enum(["light", "dark"]),
  }),
  /** Which version of the page this file is: a viewport, a theme or a language. Text the user typed. */
  version: z
    .object({
      label: z.string().min(1).max(40),
      kind: z.enum(["viewport", "theme", "language"]),
      /** The device a viewport capture is for: a nominal height is reference data only. */
      device: z
        .object({
          id: z.string().min(1).max(40),
          name: z.string().min(1).max(40),
          height: z.number().positive().max(100000),
        })
        .optional(),
      /** The breakpoint mode name an extra capture is for. */
      breakpoint: z.string().min(1).max(40).optional(),
      /** The width (px) the page was laid out at, `innerWidth`: what media queries matched. */
      width: z.number().int().min(1).max(100000).optional(),
    })
    .optional(),
  /** Which of the page's themes to import: what the user ticked when capturing. Older files lack it. */
  themeChoice: z.object({ light: z.boolean(), dark: z.boolean() }).optional(),
  /** The language the page was captured in, when the run captured several. Older files lack it. */
  language: z
    .object({
      code: z.string().min(1).max(20),
      name: z.string().min(1).max(40),
      url: z.string().max(2048),
      current: z.boolean(),
      /** The address the run began at, the page in its own language: ties a run's captures to it. */
      base: z.string().max(2048).optional(),
    })
    .optional(),
  /** Width boundaries (px) the page's stylesheets switch at, and how many sheets could not be read. */
  breakpoints: z
    .object({
      widths: z.array(z.number().int().min(1).max(10000)).max(MAX_BREAKPOINTS),
      unreadable: z.number().int().min(0),
    })
    .optional(),
  tokens: z.object({
    cssCustomProperties: z.record(z.string(), z.string()),
    /** A root custom property's authored value, kept only when it holds `var(` or `calc(`. */
    authored: z.record(z.string(), z.string()).optional(),
    /** Stylesheet contexts that restyle the root, such as `.dark`: one entry per mode. */
    themes: z
      .array(
        z.object({
          context: z.string().max(MAX_CONTEXT_LENGTH),
          mode: z.string().max(MAX_MODE_LENGTH),
          properties: z
            .record(z.string(), z.string())
            .refine((p) => Object.keys(p).length <= MAX_THEME_PROPERTIES, "too many properties"),
        })
      )
      .max(MAX_THEMES)
      .optional(),
    /** The mode of the theme context the page was in when captured, as `Dark`. */
    activeTheme: z.string().max(MAX_MODE_LENGTH).optional(),
    /**
     * With a theme context active: the root's authored values outside every theme context, for
     * the properties an active context sets, so Light is not read from the active theme.
     */
    base: z
      .record(z.string(), z.string())
      .refine((p) => Object.keys(p).length <= MAX_THEME_PROPERTIES, "too many properties")
      .optional(),
  }),
  fonts: z.array(
    z.object({
      family: z.string(),
      weight: z.number(),
      style: z.string(),
      loadedAsWebFont: z.boolean(),
    })
  ),
  assets: z.array(
    z.object({
      hash: z.string(),
      mime: z.string(),
      width: z.number(),
      height: z.number(),
      sourceUrl: z.string(),
      downscaledFrom: z.object({ w: z.number(), h: z.number() }).optional(),
    })
  ),
  warnings: z.array(
    z.object({
      code: z.string(),
      nodeId: z.string().optional(),
      detail: z.string(),
    })
  ),
  root: nodeSchema,
});

export type Capture = z.infer<typeof captureSchema>;

/**
 * Pieces of the schema for `parseCapture`, which validates in bounded steps:
 * one object at a time, arrays item by item, so a hostile file can never make
 * Zod build an unbounded list of issues. `captureSchema` stays the source of
 * truth; a test keeps both paths in step.
 */
export const parts = {
  // Item schemas for every array in the format.
  font: captureSchema.shape.fonts.element,
  asset: captureSchema.shape.assets.element,
  warning: captureSchema.shape.warnings.element,
  box,
  textRun,
  boxShadow,
  maxHoverShadows: MAX_HOVER_SHADOWS,
  component,
  maxComponentProps: MAX_COMPONENT_PROPS,
  maxThemes: MAX_THEMES,
  maxThemeProperties: MAX_THEME_PROPERTIES,
  theme: captureSchema.shape.tokens.shape.themes.unwrap().unwrap(),
  activeTheme: captureSchema.shape.tokens.shape.activeTheme.unwrap(),
  backgroundImage: backgroundImage.omit({ stops: true }),
  stop,
  string: z.string(),
  // Top level without its unbounded members.
  captureShell: captureSchema.omit({
    fonts: true,
    assets: true,
    warnings: true,
    tokens: true,
    root: true,
  }),
  // Node kinds without `children` or any array.
  element: elementBase.omit({ component: true }).extend({
    style: style.omit({ backgroundImages: true, boxShadows: true, filters: true }),
    hover: hoverBase.optional(),
  }),
  text: textNode.omit({ lines: true, runs: true }),
  image: imageNode,
  svg: svgNode,
  placeholder: placeholderNode,
};

/** A language the captured page is offered in; the capture's `language` (when set) has this shape. */
export type PageLanguage = NonNullable<Capture["language"]>;
