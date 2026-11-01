/** Plain-data layer plan. JSON-safe: it crosses postMessage to the sandbox. */

export type FontRef = { family: string; style: string };

export type PlanRgb = { r: number; g: number; b: number };

export type PlanPaint =
  | {
      type: "SOLID";
      color: PlanRgb;
      opacity: number;
      /** The colour token to bind, when this colour became one. */
      colorKey?: string;
    }
  | { type: "IMAGE"; hash: string; fit: "FILL" | "FIT" | "CROP" | "TILE" };

/** Per-side weights; one colour (the most common among drawn sides). */
export type PlanStroke = {
  color: PlanRgb;
  opacity: number;
  /** The colour token to bind, when this colour became one. */
  colorKey?: string;
  weights: { top: number; right: number; bottom: number; left: number };
};

export type PlanEffect = {
  type: "DROP_SHADOW" | "INNER_SHADOW";
  color: PlanRgb & { a: number };
  offset: { x: number; y: number };
  radius: number;
  spread: number;
};

export type PlanRun = {
  start: number;
  end: number;
  fontName: FontRef;
  fontSize: number;
  /** Pixels; null means AUTO. */
  lineHeight: number | null;
  /** Pixels. */
  letterSpacing: number;
  color: PlanRgb;
  opacity: number;
  decoration: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textCase: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  /** The text style to link, when this run's type became one. */
  styleKey?: string;
  /** The colour token to bind, when this colour became one. */
  colorKey?: string;
  /** An http(s) link for this range; absent when the text has none or hyperlinks are off. */
  href?: string;
};

export type PlanTrack = { type: "FIXED" | "FLEX" | "HUG"; value: number };

/** Padding is [top, right, bottom, left], and takes in the CSS border, which Figma does not lay out. */
export type PlanLayout =
  | { mode: "NONE" }
  | {
      mode: "HORIZONTAL" | "VERTICAL";
      wrap: boolean;
      itemSpacing: number;
      /** Positive, or null to follow `itemSpacing`. */
      counterSpacing: number | null;
      padding: [number, number, number, number];
      primaryAlign: "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN" | "SPACE_AROUND" | "SPACE_EVENLY";
      counterAlign: "MIN" | "MAX" | "CENTER" | "BASELINE";
      sizingH: "FIXED" | "HUG";
      sizingV: "FIXED" | "HUG";
    }
  | {
      mode: "GRID";
      rows: PlanTrack[];
      columns: PlanTrack[];
      rowGap: number;
      columnGap: number;
      padding: [number, number, number, number];
    };

export type PlanChildLayout = {
  positioning: "AUTO" | "ABSOLUTE";
  sizingH: "FIXED" | "HUG" | "FILL";
  sizingV: "FIXED" | "HUG" | "FILL";
  /** Zero-based; only under a GRID parent. */
  cell?: { row: number; column: number };
};

export type PlanOp = (
  | {
      op: "frame";
      id: string;
      parent: string | null;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      fills: PlanPaint[];
      strokes: PlanStroke | null;
      /** [topLeft, topRight, bottomRight, bottomLeft]. */
      radius: [number, number, number, number];
      opacity: number;
      effects: PlanEffect[];
      clips: boolean;
      layout: PlanLayout;
      /** Direct child ops that follow, so the applier knows when this frame is complete. */
      childCount: number;
    }
  | {
      op: "text";
      id: string;
      parent: string;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      runs: PlanRun[];
      align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
      wrap: boolean;
      /**
       * Lines the browser laid the text out on; the applier keeps this count. Limitation: it
       * judges lines by total height, so a block whose runs have very different line heights
       * can pass with a different line count.
       */
      lineCount: number;
    }
  | {
      op: "image";
      id: string;
      parent: string;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      hash: string;
      fit: "FILL" | "FIT" | "CROP" | "TILE";
      opacity: number;
      /** [topLeft, topRight, bottomRight, bottomLeft]. */
      radius: [number, number, number, number];
      strokes: PlanStroke | null;
    }
  | {
      op: "svg";
      id: string;
      parent: string;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      /** Self-contained SVG source; the applier rebuilds it with `createNodeFromSvg`. */
      markup: string;
      opacity: number;
      /** Whether the frame clips its content, as browsers clip inline SVG. Absent means yes. */
      clips?: boolean;
    }
  | {
      op: "placeholder";
      id: string;
      parent: string;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      opacity: number;
      label: string;
    }
) & {
  /** How the node sits in an auto layout parent; absent under a parent with mode NONE. */
  childLayout?: PlanChildLayout;
};

export type ImportReport = {
  nodes: number;
  texts: number;
  images: number;
  placeholders: number;
  /** Images stored smaller than the page had them, to stay within Figma's 4096 px per side. */
  downscaledImages: number;
  substitutedFonts: { from: string; to: string }[];
  warnings: string[];
};

/** A value worth a variable. `key` is the value, so it stays the same across imports. */
export type PlanColor = {
  key: string;
  /** A proposal: the sandbox keeps it only if the file has room for it. */
  name: string;
  rgba: PlanRgb & { a: number };
  /** The custom property behind it, as `--color-primary`. */
  cssVar?: string;
};

/** A type treatment worth a text style. `key` is the value, so it stays the same across imports. */
export type PlanTextStyle = {
  key: string;
  /** A proposal: the sandbox keeps it only if the file has room for it. */
  name: string;
  fontName: FontRef;
  fontSize: number;
  lineHeight: number | null;
  letterSpacing: number;
  decoration: PlanRun["decoration"];
  textCase: PlanRun["textCase"];
};

export type PlanTokens = {
  textStyles: PlanTextStyle[];
  colors: PlanColor[];
  /** The variable collection, named after the page's hostname. */
  collection: string;
};

export type LayerPlan = {
  ops: PlanOp[];
  tokens: PlanTokens;
  fonts: FontRef[];
  assetHashes: string[];
  report: ImportReport;
};
