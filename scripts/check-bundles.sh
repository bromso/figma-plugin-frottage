#!/usr/bin/env bash
# Keeps Zod, fflate and noble out of the bundles that must not carry them, and the component probe
# small: it runs in the page's own world before every capture. Run after building the plugin and
# the extension. Minifying removes library names, so the checks look for strings each
# library keeps; the offscreen and capture bundles do hold them, which proves the strings still work.
set -euo pipefail

plugin=apps/design-plugin/dist/plugin.js
page=apps/chrome-extension/dist/capture-entry.js
breakpoints=apps/chrome-extension/dist/breakpoints-entry.js
components=apps/chrome-extension/dist/component-probe-entry.js
offscreen=$(ls apps/chrome-extension/dist/offscreen-*.js)

zod='ZodError|zod'
fflate='invalid zip data'
noble='outputLen'

refuse() {
  if grep -Eq "$2" "$1"; then
    echo "$1 must not contain $3" >&2
    exit 1
  fi
}

require() {
  if ! grep -Eq "$2" "$1"; then
    echo "The $3 marker is out of date: it is missing from $1" >&2
    exit 1
  fi
}

limit() {
  local size
  size=$(wc -c < "$1" | tr -d ' ')
  if [ "$size" -gt "$2" ]; then
    echo "$1 is $size bytes, over its $2-byte limit" >&2
    exit 1
  fi
}

require "$offscreen" "$zod" zod
require "$offscreen" "$fflate" fflate
require "$page" "$noble" noble

refuse "$plugin" "$zod" zod
refuse "$plugin" "$fflate" fflate
refuse "$plugin" "$noble" noble
refuse "$page" "$zod" zod
refuse "$page" "$fflate" fflate
refuse "$breakpoints" "$zod" zod
refuse "$breakpoints" "$fflate" fflate
refuse "$components" "$zod" zod
refuse "$components" "$fflate" fflate
limit "$components" 8192

echo "Bundle boundaries hold"
