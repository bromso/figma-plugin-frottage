import { addCollection, Icon as IconifyIcon } from "@iconify/react/offline";
import type { IconifyJSON } from "@iconify/types";
import type * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Static icon registry
// ---------------------------------------------------------------------------

// Curated lucide subset preloaded at module init.
// Using @iconify/react/offline means this bundle has ZERO network code:
// no references to api.iconify.design, no fetch, no XMLHttpRequest.
//
// Body strings are copied verbatim from
// node_modules/@iconify-json/lucide/icons.json (v1.2.102) keys plus/info/star/ellipsis.
const lucideSubset: IconifyJSON = {
  prefix: "lucide",
  icons: {
    plus: {
      body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14m-7-7v14"/>',
    },
    info: {
      body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></g>',
    },
    star: {
      body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.12 2.12 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.12 2.12 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16z"/>',
    },
    ellipsis: {
      body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></g>',
    },
  },
  width: 24,
  height: 24,
};

addCollection(lucideSubset);

// ---------------------------------------------------------------------------
// Type-safe icon name system
// ---------------------------------------------------------------------------

/**
 * Extensible icon name registry. Consumers widen this via module augmentation:
 *
 * ```ts
 * import type {} from "@repo/ui";
 *
 * declare module "@repo/ui" {
 *   interface StaticIconNameMap {
 *     "mdi:home": true;
 *     "mdi:account": true;
 *   }
 * }
 * ```
 *
 * Uses the same pattern as `@tanstack/react-router` (Register),
 * `react-i18next` (Resources), and `next-auth` (Session).
 */
export interface StaticIconNameMap {
  "lucide:plus": true;
  "lucide:info": true;
  "lucide:star": true;
  "lucide:ellipsis": true;
}

export type StaticIconName = keyof StaticIconNameMap;

/** Typed const for referencing built-in icons without raw string literals. */
export const ICONS = {
  plus: "lucide:plus",
  info: "lucide:info",
  star: "lucide:star",
  ellipsis: "lucide:ellipsis",
} as const satisfies Record<string, StaticIconName>;

// ---------------------------------------------------------------------------
// Runtime icon registration
// ---------------------------------------------------------------------------

/** Tracks all icon names registered via addCollection for unknown-name guard. */
const registeredNames = new Set<string>();

// Seed with the built-in lucide subset
for (const name of Object.keys(lucideSubset.icons)) {
  registeredNames.add(`${lucideSubset.prefix}:${name}`);
}

/**
 * Register an iconify icon collection for use with `<Icon>`.
 *
 * Call this once at module init (e.g., in `main.tsx` before `createRoot`):
 * ```ts
 * import lucideIcons from "@iconify-json/lucide";
 * registerIcons(lucideIcons);
 * ```
 *
 * @returns `true` if the collection was accepted by iconify's internal registry.
 */
export function registerIcons(data: IconifyJSON): boolean {
  const result = addCollection(data);
  for (const name of Object.keys(data.icons)) {
    registeredNames.add(`${data.prefix}:${name}`);
  }
  return result as unknown as boolean;
}

// ---------------------------------------------------------------------------
// Unknown-name warning (dedup'd per name)
// ---------------------------------------------------------------------------

const warnedNames = new Set<string>();

// ---------------------------------------------------------------------------
// Icon component
// ---------------------------------------------------------------------------

export interface IconProps {
  name: StaticIconName;
  spin?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, spin, className, style }: IconProps) {
  if (!registeredNames.has(name)) {
    if (!warnedNames.has(name)) {
      warnedNames.add(name);
      console.warn(
        `[@repo/ui] Unknown icon name: "${name}". Did you forget to call registerIcons()?`
      );
    }
    return null;
  }

  return (
    <IconifyIcon
      icon={name}
      className={cn("size-4", spin && "animate-spin", className)}
      style={style}
    />
  );
}
