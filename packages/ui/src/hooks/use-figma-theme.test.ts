import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useFigmaTheme } from "./use-figma-theme";

const html = () => document.documentElement;

afterEach(() => {
  cleanup();
  html().classList.remove("figma-dark", "figma-light", "dark");
});

describe("useFigmaTheme", () => {
  it("is light when no theme class is set", () => {
    const { result } = renderHook(() => useFigmaTheme());
    expect(result.current).toBe("light");
  });

  it("is dark when <html> already has figma-dark", () => {
    html().classList.add("figma-dark");
    const { result } = renderHook(() => useFigmaTheme());
    expect(result.current).toBe("dark");
  });

  it("treats the .dark class (Storybook, tests) as dark too", () => {
    html().classList.add("dark");
    const { result } = renderHook(() => useFigmaTheme());
    expect(result.current).toBe("dark");
  });

  it("follows class changes after mount", async () => {
    const { result } = renderHook(() => useFigmaTheme());
    expect(result.current).toBe("light");
    await act(async () => {
      html().classList.add("figma-dark");
      // happy-dom delivers MutationObserver records in a microtask queued by classList.add
      await Promise.resolve(); // let the MutationObserver callback run
    });
    expect(result.current).toBe("dark");
    await act(async () => {
      html().classList.remove("figma-dark");
      await Promise.resolve();
    });
    expect(result.current).toBe("light");
  });

  it("disconnects its observer on unmount", () => {
    const disconnect = spyOn(MutationObserver.prototype, "disconnect");
    const { unmount } = renderHook(() => useFigmaTheme());
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    disconnect.mockRestore();
  });
});
