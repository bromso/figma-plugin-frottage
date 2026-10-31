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

const backgroundImage = z.object({
  type: z.enum(["linear-gradient", "radial-gradient", "conic-gradient", "image"]),
  css: z.string(),
  assetHash: z.string().optional(),
  stops: z.array(z.object({ color, position: z.number() })).optional(),
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
  borders: z.object({
    top: border,
    right: border,
    bottom: border,
    left: border,
  }),
  borderRadius: four,
  boxShadows: z.array(boxShadow),
  filters: z.array(z.string()),
  backdropFilter: z.string().optional(),
  overflow: z.string(),
  clip: box.optional(),
});

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
  order: z.number(),
  grow: z.number(),
  shrink: z.number(),
});

const semantic = z.object({
  tag: z.string(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  headingLevel: z.number().int().min(1).max(6).optional(),
  landmark: z.string().optional(),
  href: z.string().optional(),
  alt: z.string().optional(),
});

const common = {
  id: z.string(),
  box,
  paintOrder: z.number(),
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
});

const textNode = z.object({
  ...common,
  kind: z.literal("text"),
  text: z.string(),
  lines: z.array(box),
  runs: z.array(textRun),
});

const imageNode = z.object({
  ...common,
  kind: z.literal("image"),
  assetHash: z.string().optional(),
  sourceUrl: z.string().optional(),
  fit: z.enum(["cover", "contain", "fill", "none", "tile"]),
  objectPosition: z.string(),
});

const svgNode = z.object({
  ...common,
  kind: z.literal("svg"),
  markup: z.string(),
});

const placeholderNode = z.object({
  ...common,
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
