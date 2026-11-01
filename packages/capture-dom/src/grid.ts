type Win = Window & typeof globalThis;
type Rule = { selector: string; columns: string; rows: string };
type Tracks = { columns?: string; rows?: string };

const HAS_FR = /\dfr\b/;

function collect(rules: CSSRuleList, win: Win, out: Rule[]) {
  for (const rule of Array.from(rules)) {
    if (rule instanceof win.CSSStyleRule) {
      const columns = rule.style.getPropertyValue("grid-template-columns");
      const rows = rule.style.getPropertyValue("grid-template-rows");
      if (columns || rows) out.push({ selector: rule.selectorText, columns, rows });
    } else if (rule instanceof win.CSSMediaRule) {
      if (win.matchMedia?.(rule.conditionText).matches) collect(rule.cssRules, win, out);
    } else if (rule instanceof win.CSSSupportsRule) {
      if (win.CSS?.supports(rule.conditionText)) collect(rule.cssRules, win, out);
    } else if ("cssRules" in rule) {
      collect(rule.cssRules as CSSRuleList, win, out);
    }
  }
}

function rulesOf(root: DocumentOrShadowRoot, win: Win): Rule[] {
  const out: Rule[] = [];
  for (const sheet of [...Array.from(root.styleSheets), ...(root.adoptedStyleSheets ?? [])]) {
    try {
      collect(sheet.cssRules, win, out);
    } catch {
      // A cross-origin stylesheet cannot be read.
    }
  }
  return out;
}

const matches = (el: Element, selector: string) => {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
};

/**
 * Finds the `fr` values computed style has already resolved to pixels. The last matching rule is
 * taken without weighing specificity, so the result is a hint: the mapper keeps it only if it
 * agrees with the computed tracks.
 */
export function authoredTracksReader(win: Win): (el: Element) => Tracks {
  const cache = new Map<Node, Rule[]>();
  const rules = (el: Element) => {
    const root = el.getRootNode();
    let list = cache.get(root);
    if (!list) {
      list = rulesOf(root as unknown as DocumentOrShadowRoot, win);
      cache.set(root, list);
    }
    return list;
  };
  return (el) => {
    const inline = (el as HTMLElement).style;
    let columns = inline?.getPropertyValue("grid-template-columns") ?? "";
    let rows = inline?.getPropertyValue("grid-template-rows") ?? "";
    const list = rules(el);
    for (let i = list.length - 1; i >= 0 && !(columns && rows); i--) {
      const rule = list[i] as Rule;
      if (!(!columns && rule.columns) && !(!rows && rule.rows)) continue;
      if (!matches(el, rule.selector)) continue;
      columns ||= rule.columns;
      rows ||= rule.rows;
    }
    return {
      ...(HAS_FR.test(columns) ? { columns } : {}),
      ...(HAS_FR.test(rows) ? { rows } : {}),
    };
  };
}
