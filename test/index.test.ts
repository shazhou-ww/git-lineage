import { describe, expect, it } from "vitest";

import { greet } from "../src/index.js";

describe("greet", () => {
  it("formats a trimmed name", () => {
    expect(greet("  world  ")).toBe("Hello, world!");
  });

  it("rejects an empty name", () => {
    expect(() => greet("   ")).toThrowError(
      new TypeError("name must not be empty"),
    );
  });
});
