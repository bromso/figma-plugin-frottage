/// <reference types="bun" />

import type { AsymmetricMatcher, expect } from "bun:test";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

type StringMatcher = ReturnType<typeof expect.stringContaining>;

declare module "bun:test" {
  interface Matchers<T> extends TestingLibraryMatchers<StringMatcher, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<StringMatcher, AsymmetricMatcher> {}
}
