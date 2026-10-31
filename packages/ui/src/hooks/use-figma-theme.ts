import { useEffect, useState } from "react";

export type FigmaTheme = "light" | "dark";

/**
 * Reads the theme Figma applies to the plugin iframe. With `themeColors: true`
 * Figma toggles `figma-dark` / `figma-light` on `<html>`; Storybook and tests
 * use `.dark`. Returns "light" when there is no document (server rendering).
 * Only the <html> element is read; a nested .dark wrapper is honoured by the
 * CSS but not by this hook.
 */
function readTheme(): FigmaTheme {
  if (typeof document === "undefined") return "light";
  const classes = document.documentElement.classList;
  return classes.contains("figma-dark") || classes.contains("dark") ? "dark" : "light";
}

export function useFigmaTheme(): FigmaTheme {
  const [theme, setTheme] = useState<FigmaTheme>(readTheme);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => setTheme(readTheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
