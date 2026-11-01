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

const backgroundImage = z.object({
  type: z.enum(["linear-gradient", "radial-gradient", "conic-gradient", "image"]),
  css: z.string(),
  assetHash: z.string().optional(),
  stops: z.array(stop).optional(),
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
  borderColor: color.optional(),
  opacity: unit.optional(),
  decoration: z.string().max(60).optional(),
});
const hover = hoverBase.extend({
  boxShadows: z.array(boxShadow).max(MAX_HOVER_SHADOWS).optional(),
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
export type ElementNode = z.infer<typeof elementBase> & {
  children: CaptureNode[];
};
export type CaptureNode = ElementNode | TextNode | ImageNode | SvgNode | PlaceholderNode;

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
  tokens: z.object({ cssCustomProperties: z.record(z.string(), z.string()) }),
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
  element: elementBase.extend({
    style: style.omit({ backgroundImages: true, boxShadows: true, filters: true }),
    hover: hoverBase.optional(),
  }),
  text: textNode.omit({ lines: true, runs: true }),
  image: imageNode,
  svg: svgNode,
  placeholder: placeholderNode,
};
