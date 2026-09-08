import { describe, it, expect } from "vitest";
import { ApprovalManager } from "../src/index.js";

describe("ApprovalManager Canonical Fingerprinting", () => {
  it("should generate identical fingerprints for equivalent nested objects with different key insertion orders", () => {
    const mgr = new ApprovalManager();

    const objA = {
      b: 2,
      a: 1,
      nested: {
        z: "last",
        m: "middle",
        arr: [{ y: 2, x: 1 }],
      },
    };

    const objB = {
      nested: {
        arr: [{ x: 1, y: 2 }],
        m: "middle",
        z: "last",
      },
      a: 1,
      b: 2,
    };

    const fpA = mgr.createFingerprint("tool_x", objA);
    const fpB = mgr.createFingerprint("tool_x", objB);

    expect(fpA).toBe(fpB);
  });

  it("should generate different fingerprints for semantically different parameters", () => {
    const mgr = new ApprovalManager();

    const objA = { path: "/tmp/file1" };
    const objB = { path: "/tmp/file2" };

    const fpA = mgr.createFingerprint("tool_x", objA);
    const fpB = mgr.createFingerprint("tool_x", objB);

    expect(fpA).not.toBe(fpB);
  });
});
