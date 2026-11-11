// The scripts the worker injects for one capture, in order. Kept apart from the worker so a test
// can run them against a stand-in for `chrome.scripting`.
import { ATTRIBUTE } from "@repo/component-probe/attribute";

type Injection = { target: { tabId: number }; world?: "MAIN" } & (
  | { files: string[]; func?: undefined }
  | { func: (attribute: string) => void; args: [string]; files?: undefined }
);
export type ScriptingApi = { executeScript(injection: Injection): Promise<unknown> };

// Runs in the page, serialised: it can use nothing from this module.
function clearTags(attribute: string): void {
  for (const el of document.querySelectorAll(`[${attribute}]`)) el.removeAttribute(attribute);
}

/**
 * Tags the page's components, then starts the capture. The probe runs in the page's own world,
 * where React's fibers and Vue's app can be seen; if it can't run there (a refusal, an error) the
 * capture goes on and the page has no components. Tags a previous size left are cleared first.
 */
export async function injectCapture(scripting: ScriptingApi, tabId: number): Promise<void> {
  const target = { tabId };
  await scripting.executeScript({ target, func: clearTags, args: [ATTRIBUTE] }).catch(() => {});
  await scripting
    .executeScript({ target, world: "MAIN", files: ["component-probe-entry.js"] })
    .catch(() => {});
  await scripting.executeScript({ target, files: ["capture-entry.js"] });
}
