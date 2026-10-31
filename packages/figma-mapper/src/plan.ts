/** Plain-data layer plan. JSON-safe: it crosses postMessage to the sandbox. */

export type FontRef = { family: string; style: string };

export type PlanRgb = { r: number; g: number; b: number };

export type PlanPaint =
  | { type: "SOLID"; color: PlanRgb; opacity: number }
  | { type: "IMAGE"; hash: string; fit: "FILL" | "FIT" | "CROP" | "TILE" };

/** Per-side weights; one colour (the most common among drawn sides). */
export type PlanStroke = {
  color: PlanRgb;
  opacity: number;
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
};

export type PlanOp =
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
    };

export type ImportReport = {
  nodes: number;
  texts: number;
  images: number;
  placeholders: number;
  substitutedFonts: { from: string; to: string }[];
  warnings: string[];
};

export type LayerPlan = {
  ops: PlanOp[];
  fonts: FontRef[];
  assetHashes: string[];
  report: ImportReport;
};
