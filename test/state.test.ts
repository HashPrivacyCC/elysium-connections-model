import { describe, expect, it } from "vitest";
import {
  HOP_STATUSES,
  InvalidTransitionError,
  assertTransition,
  canTransition,
  isTerminal,
  type HopStatus,
} from "../src/index.js";

const ALLOWED: Array<[HopStatus, HopStatus]> = [
  ["pending", "confirmed"],
  ["pending", "failed"],
  ["pending", "refunded"],
  ["confirmed", "finalized"],
  ["confirmed", "failed"],
];

describe("hop state machine", () => {
  it("lists five statuses", () => {
    expect(HOP_STATUSES).toEqual(["pending", "confirmed", "finalized", "refunded", "failed"]);
  });

  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to, "hop")).not.toThrow();
  });

  const forbidden: Array<[HopStatus, HopStatus]> = [];
  for (const a of HOP_STATUSES) {
    for (const b of HOP_STATUSES) {
      if (!ALLOWED.some(([x, y]) => x === a && y === b)) forbidden.push([a, b]);
    }
  }

  it("covers every other pair as forbidden", () => {
    expect(forbidden).toHaveLength(20);
  });

  it.each(forbidden)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to, "hop")).toThrow(InvalidTransitionError);
  });

  it("marks finalized, refunded and failed as terminal", () => {
    expect(HOP_STATUSES.filter(isTerminal)).toEqual(["finalized", "refunded", "failed"]);
  });

  it("names the thing and the states in the error", () => {
    try {
      assertTransition("finalized", "pending", "deposit");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect((err as InvalidTransitionError).code).toBe("INVALID_TRANSITION");
      expect((err as Error).message).toContain("deposit");
      expect((err as Error).message).toContain("finalized");
    }
  });
});
