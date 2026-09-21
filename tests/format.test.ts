import { describe, expect, it } from "vitest";
import { joinBounded } from "../src/format.js";

describe("joinBounded", () => {
  it("returns an empty string for no items", () => {
    expect(joinBounded([])).toBe("");
  });

  it("joins every item when the list is within the limit", () => {
    expect(joinBounded(["a.ts", "b.ts"], 8)).toBe("a.ts, b.ts");
  });

  it("caps long lists and reports how many were omitted", () => {
    expect(joinBounded(["a.ts", "b.ts", "c.ts", "d.ts"], 2)).toBe(
      "a.ts, b.ts, and 2 more",
    );
  });

  it("rejects a non-positive limit", () => {
    expect(() => joinBounded(["a.ts"], 0)).toThrow(/at least 1/);
  });
});
