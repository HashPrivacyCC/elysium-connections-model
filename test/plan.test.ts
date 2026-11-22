import { describe, expect, it } from "vitest";
import { HYPE, InvalidAmountError, InvalidRouteError, USDC, planShieldOnArrival, planUnshieldToCore, type FeeSchedule } from "../src/index.js";
import { ALICE } from "./helpers.js";

const FEES: FeeSchedule = {
  coreToEvm: 1n,
  evmToElysium: 2n,
  evmToElysiumFast: 4n,
  shield: 1n,
  unshield: 1n,
  elysiumToEvm: 3n,
  elysiumToEvmFast: 5n,
  evmToCore: 1n,
};

describe("route planner", () => {
  it("plans shield-on-arrival as three hops in order", () => {
    const p = planShieldOnArrival({ account: ALICE, asset: USDC, amount: 100n, fees: FEES });
    expect(p.kind).toBe("shield-on-arrival");
    expect(p.hops.map((h) => h.kind)).toEqual(["core-to-evm", "evm-to-elysium", "shield"]);
    expect(p.hops.map((h) => [h.from, h.to])).toEqual([
      ["hyperliquid", "hyperevm"],
      ["hyperevm", "elysium"],
      ["elysium", "elysium"],
    ]);
    expect(p.hops.map((h) => h.index)).toEqual([0, 1, 2]);
  });

  it("plans the reverse as unshield, exit, spot transfer back", () => {
    const p = planUnshieldToCore({ account: ALICE, asset: USDC, amount: 100n, noteId: "note-0", fees: FEES });
    expect(p.hops.map((h) => h.kind)).toEqual(["unshield", "elysium-to-evm", "evm-to-core"]);
    expect(p.noteId).toBe("note-0");
  });

  it("sums fees in HYPE and groups them by the domain that pays", () => {
    const p = planShieldOnArrival({ account: ALICE, asset: USDC, amount: 100n, fees: FEES });
    expect(p.totalFee).toBe(4n);
    expect(p.requiredHype).toEqual({ hyperliquid: 1n, hyperevm: 2n, elysium: 1n });
  });

  it("adds the amount to the start domain when the asset is HYPE", () => {
    const p = planShieldOnArrival({ account: ALICE, asset: HYPE, amount: 100n, fees: FEES });
    expect(p.requiredHype.hyperliquid).toBe(101n);
    expect(p.requiredHype.hyperevm).toBe(2n);
  });

  it("uses the fast fee for the bridge hop in fast mode", () => {
    const p = planShieldOnArrival({ account: ALICE, asset: USDC, amount: 1n, fees: FEES, mode: "fast" });
    expect(p.hops.map((h) => h.fee)).toEqual([1n, 4n, 1n]);
    expect(p.hops.map((h) => h.fast)).toEqual([false, true, false]);
    const q = planUnshieldToCore({ account: ALICE, asset: USDC, amount: 1n, noteId: "n", fees: FEES, mode: "fast" });
    expect(q.hops.map((h) => h.fee)).toEqual([1n, 5n, 1n]);
    expect(q.hops.map((h) => h.fast)).toEqual([false, true, false]);
  });

  it("can start from HyperEVM or end on HyperEVM", () => {
    const a = planShieldOnArrival({ account: ALICE, asset: USDC, amount: 1n, fees: FEES, from: "hyperevm" });
    expect(a.hops.map((h) => h.kind)).toEqual(["evm-to-elysium", "shield"]);
    const b = planUnshieldToCore({ account: ALICE, asset: USDC, amount: 1n, noteId: "n", fees: FEES, to: "hyperevm" });
    expect(b.hops.map((h) => h.kind)).toEqual(["unshield", "elysium-to-evm"]);
  });

  it("rejects a zero amount and empty names", () => {
    expect(() => planShieldOnArrival({ account: ALICE, asset: USDC, amount: 0n, fees: FEES })).toThrow(InvalidAmountError);
    expect(() => planShieldOnArrival({ account: "", asset: USDC, amount: 1n, fees: FEES })).toThrow(InvalidRouteError);
    expect(() => planShieldOnArrival({ account: ALICE, asset: "", amount: 1n, fees: FEES })).toThrow(InvalidRouteError);
  });

});
