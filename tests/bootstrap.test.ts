import { describe, it, expect } from "vitest";
import { OPERATOR_NAME, OPERATOR_VERSION } from "../src/index.js";

describe("Bootstrap Foundation", () => {
  it("exports correct operator metadata", () => {
    expect(OPERATOR_NAME).toBe("YarTrader.Op");
    expect(OPERATOR_VERSION).toBe("0.1.0");
  });
});
