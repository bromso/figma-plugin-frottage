# Phase 17: Type Safety — Design

**Date:** 2026-04-21
**Approach:** TYPE-01 first (infrastructure), then TYPE-02 (feature)

## TYPE-01: tsc Pipeline Wiring

Wire `tsc --noEmit` into the Turborepo `types` pipeline for `packages/ui` and `packages/common`.

### Changes

**`packages/ui/package.json`** and **`packages/common/package.json`** — add script:
```json
"types": "tsc --noEmit && tsc --noEmit -p tsconfig.node.json"
```

**`packages/ui/tsconfig.node.json`** and **`packages/common/tsconfig.node.json`** — new files:
```json
{
  "compilerOptions": {
    "noEmit": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["*.ts", "vitest.config.ts"]
}
```

**`turbo.json`** — no changes. Existing `types` task picks up new scripts automatically.

After wiring, run `bun run types` and fix any latent errors.

## TYPE-02: registerIcons API & Type Extensibility

### StaticIconNameMap interface (replaces bare union)

```ts
export interface StaticIconNameMap {
  "lucide:plus": true;
  "lucide:info": true;
  "lucide:star": true;
}
export type StaticIconName = keyof StaticIconNameMap;
```

Consumers extend via declaration merging:
```ts
declare module "@repo/ui" {
  interface StaticIconNameMap {
    "mdi:home": true;
  }
}
```

### registerIcons wrapper

```ts
export function registerIcons(data: IconifyJSON): boolean {
  return addCollection(data);
}
```

Thin wrapper around iconify's `addCollection`. Called once at module init before `createRoot`.

### ICONS const

```ts
export const ICONS = {
  plus: "lucide:plus",
  info: "lucide:info",
  star: "lucide:star",
} as const satisfies Record<string, StaticIconName>;
```

### Unknown-icon guard (deduped warning)

```ts
import { iconExists } from "@iconify/react/offline";

const warnedNames = new Set<string>();

export function Icon({ name, spin, className, ...props }: IconProps) {
  if (!iconExists(name)) {
    if (!warnedNames.has(name)) {
      warnedNames.add(name);
      console.warn(`[@repo/ui] Unknown icon: "${name}". Did you forget to call registerIcons()?`);
    }
    return null;
  }
  return (
    <IconifyIcon icon={name} className={cn("size-4", spin && "animate-spin", className)} {...props} />
  );
}
```

### Barrel exports update (`packages/ui/src/index.ts`)

```ts
export { Icon, type IconProps, type StaticIconName, type StaticIconNameMap, ICONS, registerIcons } from "./components/figma/icon";
```

### REQUIREMENTS.md update

Reword TYPE-02 to reflect the iconify-based `registerIcons(iconifyData)` API per context decision D-07.

## Execution Sequence

1. Add `tsconfig.node.json` + `types` scripts to both packages
2. Run `bun run types`, fix any errors surfaced
3. Restructure `StaticIconName` into `StaticIconNameMap` interface
4. Add `registerIcons`, `ICONS` const, unknown-icon guard
5. Update barrel exports and REQUIREMENTS.md
6. Final verification pass

## Success Criteria

All 11 verification criteria from `17-CONTEXT.md` must pass:

1. `packages/ui/package.json` has `types` script
2. `turbo run types` executes across `@repo/common`, `@repo/ui`, `@repo/design-plugin`
3. `bun run types` exits 0 with zero errors
4. `registerIcons(collection)` compiles and registers icons at runtime
5. `ICONS.plus` typed as literal `"lucide:plus"`; `StaticIconName = keyof StaticIconNameMap`
6. `<Icon name={"unknown" as StaticIconName} />` warns and returns null
7. Module augmentation works for consumers
8. REQUIREMENTS.md TYPE-02 updated
9. `packages/common` has matching `types` script + `tsconfig.node.json`
10. `bun run build`, `bun run lint`, `bun run test` all exit 0
11. TYPE-01 and TYPE-02 can be marked satisfied in REQUIREMENTS.md
