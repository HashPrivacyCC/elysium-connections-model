import { describe, expect, it } from "vitest";
import {
  Balances,
  DEFAULT_SPOT_CONFIG,
  HYPE,
  HYPERCORE_UNSPECIFIED,
  InsufficientBalanceError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidTransitionError,
  MockSpotAdapter,
  NotYetDueError,
  SPOT_HOLD,
  SpotTransferFailedError,
  UnknownTransferError,
  UnsupportedAssetError,
  USDC,
  type SpotTransferAdapter,
} from "../src/index.js";
import { ALICE } from "./helpers.js";

function setup(config = {}) {
  const core = new Balances("hyperliquid");
  const evm = new Balances("hyperevm");
  const spot = new MockSpotAdapter({ ...DEFAULT_SPOT_CONFIG, ...config }, core, evm);
  core.credit(ALICE, USDC, 100n);
  core.credit(ALICE, HYPE, 10n);
  evm.credit(ALICE, HYPE, 10n);
  return { core, evm, spot };
}

describe("unspecified details", () => {
  it("marks every precompile and address detail as to be specified", () => {
    for (const value of Object.values(HYPERCORE_UNSPECIFIED)) {
      expect(value).toBe("to be specified against the Hyperliquid docs");
    }
    expect(Object.keys(HYPERCORE_UNSPECIFIED)).toContain("systemAddresses");
    expect(Object.keys(HYPERCORE_UNSPECIFIED)).toContain("precompileInterface");
  });
});

describe("mock spot adapter, core to evm", () => {
  it("holds the amount and the HYPE fee at the source on submit", () => {
    const { core, evm, spot } = setup();
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 40n, direction: "core-to-evm" }, 0);
    expect(t.status).toBe("pending");
    expect(t.fee).toBe(1n);
    expect(core.get(ALICE, USDC)).toBe(60n);
    expect(core.get(ALICE, HYPE)).toBe(9n);
    expect(core.get(SPOT_HOLD, USDC)).toBe(40n);
    expect(evm.get(ALICE, USDC)).toBe(0n);
  });

  it("credits the same account on HyperEVM at confirm", () => {
    const { core, evm, spot } = setup();
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 40n, direction: "core-to-evm" }, 0);
    const c = spot.confirm(t.id, 1);
    expect(c.status).toBe("confirmed");
    expect(evm.get(ALICE, USDC)).toBe(40n);
    expect(core.get(SPOT_HOLD, USDC)).toBe(0n);
  });

  it("does not confirm before the settle delay", () => {
    const { spot } = setup({ settleDelay: 5 });
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 1n, direction: "core-to-evm" }, 2);
    expect(() => spot.confirm(t.id, 6)).toThrow(NotYetDueError);
    expect(spot.confirm(t.id, 7).status).toBe("confirmed");
  });

  it("finalizes after the finality delay", () => {
    const { spot } = setup({ finalityDelay: 3 });
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 1n, direction: "core-to-evm" }, 0);
    spot.confirm(t.id, 1);
    expect(() => spot.finalize(t.id, 3)).toThrow(NotYetDueError);
    expect(spot.finalize(t.id, 4).status).toBe("finalized");
  });

  it("cannot finalize before confirming", () => {
    const { spot } = setup();
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 1n, direction: "core-to-evm" }, 0);
    expect(() => spot.finalize(t.id, 9)).toThrow(InvalidTransitionError);
  });

  it("cannot confirm twice", () => {
    const { spot, evm } = setup();
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 5n, direction: "core-to-evm" }, 0);
    spot.confirm(t.id, 1);
    expect(() => spot.confirm(t.id, 2)).toThrow(InvalidTransitionError);
    expect(evm.get(ALICE, USDC)).toBe(5n);
  });
});

describe("mock spot adapter, evm to core", () => {
  it("moves HYPE with its fee on top", () => {
    const { core, evm, spot } = setup();
    const t = spot.submit({ account: ALICE, asset: HYPE, amount: 6n, direction: "evm-to-core" }, 0);
    expect(evm.get(ALICE, HYPE)).toBe(3n);
    spot.confirm(t.id, 1);
    expect(core.get(ALICE, HYPE)).toBe(16n);
  });

  it("moves USDC from the EVM side to the core spot balance", () => {
    const { core, evm, spot } = setup();
    evm.credit(ALICE, USDC, 20n);
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 20n, direction: "evm-to-core" }, 0);
    spot.confirm(t.id, 1);
    expect(evm.get(ALICE, USDC)).toBe(0n);
    expect(core.get(ALICE, USDC)).toBe(120n);
  });
});

describe("mock spot adapter, rejections", () => {
  it("rejects an unsupported asset", () => {
    const { spot } = setup();
    expect(() => spot.submit({ account: ALICE, asset: "MEME", amount: 1n, direction: "core-to-evm" }, 0)).toThrow(UnsupportedAssetError);
    expect(spot.supports("MEME")).toBe(false);
  });

  it("rejects a zero amount", () => {
    const { spot } = setup();
    expect(() => spot.submit({ account: ALICE, asset: USDC, amount: 0n, direction: "core-to-evm" }, 0)).toThrow(InvalidAmountError);
  });

  it("rejects a transfer the account cannot fund and changes nothing", () => {
    const { spot, core } = setup();
    expect(() => spot.submit({ account: ALICE, asset: USDC, amount: 101n, direction: "core-to-evm" }, 0)).toThrow(InsufficientBalanceError);
    expect(core.get(ALICE, USDC)).toBe(100n);
    expect(core.get(ALICE, HYPE)).toBe(10n);
  });

  it("rejects a transfer when there is no HYPE for the fee", () => {
    const { spot, core } = setup();
    core.debit(ALICE, HYPE, 10n);
    expect(() => spot.submit({ account: ALICE, asset: USDC, amount: 1n, direction: "core-to-evm" }, 0)).toThrow(InsufficientBalanceError);
  });

  it("reports an unknown transfer", () => {
    const { spot } = setup();
    expect(() => spot.get("nope")).toThrow(UnknownTransferError);
    expect(() => spot.confirm("nope", 0)).toThrow(UnknownTransferError);
  });

  it("fail returns the amount to the source and keeps the fee", () => {
    const { spot, core } = setup();
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 40n, direction: "core-to-evm" }, 0);
    const f = spot.fail(t.id);
    expect(f.status).toBe("failed");
    expect(core.get(ALICE, USDC)).toBe(100n);
    expect(core.get(ALICE, HYPE)).toBe(9n);
    expect(core.get(SPOT_HOLD, USDC)).toBe(0n);
  });

  it("cannot fail a confirmed transfer through the pending path twice", () => {
    const { spot } = setup();
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 1n, direction: "core-to-evm" }, 0);
    spot.fail(t.id);
    expect(() => spot.fail(t.id)).toThrow(InvalidTransitionError);
    expect(() => spot.confirm(t.id, 5)).toThrow(InvalidTransitionError);
  });

  it("a rejection at confirm fails the transfer and returns the funds", () => {
    const { spot, core, evm } = setup();
    const t = spot.submit({ account: ALICE, asset: USDC, amount: 40n, direction: "core-to-evm" }, 0);
    spot.rejectNextConfirm();
    expect(() => spot.confirm(t.id, 1)).toThrow(SpotTransferFailedError);
    expect(spot.get(t.id).status).toBe("failed");
    expect(core.get(ALICE, USDC)).toBe(100n);
    expect(evm.get(ALICE, USDC)).toBe(0n);
  });

  it("validates its config", () => {
    const core = new Balances("hyperliquid");
    const evm = new Balances("hyperevm");
    expect(() => new MockSpotAdapter({ ...DEFAULT_SPOT_CONFIG, supportedAssets: [USDC] }, core, evm)).toThrow(InvalidConfigError);
    expect(() => new MockSpotAdapter({ ...DEFAULT_SPOT_CONFIG, fee: -1n }, core, evm)).toThrow(InvalidConfigError);
  });

  it("is usable through the interface", () => {
    const { spot } = setup();
    const adapter: SpotTransferAdapter = spot;
    expect(adapter.fee).toBe(1n);
    const t = adapter.submit({ account: ALICE, asset: USDC, amount: 3n, direction: "core-to-evm" }, 0);
    expect(adapter.get(t.id).amount).toBe(3n);
  });
});
