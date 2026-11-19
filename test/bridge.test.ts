import { describe, expect, it } from "vitest";
import {
  BRIDGE_ESCROW,
  BRIDGE_FEE_SINK,
  BRIDGE_OUTBOX,
  BridgePausedError,
  CanonicalBridge,
  DEFAULT_BRIDGE_CONFIG,
  DeadlinePassedError,
  Balances,
  HYPE,
  InsufficientBalanceError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidTransitionError,
  NotYetDueError,
  ReplayError,
  UnknownMessageError,
  UnsupportedAssetError,
  USDC,
} from "../src/index.js";
import { ALICE, BOB, makeBridge } from "./helpers.js";

const fundedBridge = (overrides = {}) => {
  const t = makeBridge(overrides);
  t.hyperEvm.credit(ALICE, HYPE, 1000n);
  t.hyperEvm.credit(ALICE, USDC, 500n);
  return t;
};

describe("config", () => {
  const mk = (c: Partial<typeof DEFAULT_BRIDGE_CONFIG>) =>
    new CanonicalBridge({ ...DEFAULT_BRIDGE_CONFIG, ...c }, new Balances("hyperevm"), new Balances("elysium"));

  it("requires HYPE among the supported assets", () => {
    expect(() => mk({ supportedAssets: [USDC] })).toThrow(InvalidConfigError);
  });
  it("requires an expiry after the inbox delay", () => {
    expect(() => mk({ inboxDelay: 5, depositExpiry: 5 })).toThrow(InvalidConfigError);
  });
  it("rejects negative or fractional delays", () => {
    expect(() => mk({ challengeDelay: -1 })).toThrow(InvalidAmountError);
    expect(() => mk({ challengeDelay: 1.5 })).toThrow(InvalidAmountError);
  });
  it("rejects negative fees", () => {
    expect(() => mk({ inboxFee: -1n })).toThrow(InvalidConfigError);
  });
  it("accepts a zero challenge delay as a parameter", () => {
    expect(() => mk({ challengeDelay: 0 })).not.toThrow();
  });
  it("copies the supported asset list", () => {
    const list = [HYPE, USDC];
    const b = new CanonicalBridge({ ...DEFAULT_BRIDGE_CONFIG, supportedAssets: list }, new Balances("hyperevm"), new Balances("elysium"));
    list.push("OTHER");
    expect(b.supports("OTHER")).toBe(false);
  });
});

describe("inbox deposit", () => {
  it("escrows on HyperEVM and charges the fee in HYPE", () => {
    const { bridge, hyperEvm } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    expect(m.status).toBe("pending");
    expect(hyperEvm.get(ALICE, USDC)).toBe(400n);
    expect(hyperEvm.get(ALICE, HYPE)).toBe(998n);
    expect(hyperEvm.get(BRIDGE_ESCROW, USDC)).toBe(100n);
    expect(hyperEvm.get(BRIDGE_FEE_SINK, HYPE)).toBe(2n);
  });

  it("credits Elysium after the inbox delay", () => {
    const { bridge, elysium } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 10);
    const d = bridge.deliverDeposit(m.id, 12);
    expect(d.status).toBe("confirmed");
    expect(d.deliveredAt).toBe(12);
    expect(elysium.get(BOB, USDC)).toBe(100n);
  });

  it("does not deliver before the inbox delay", () => {
    const { bridge, elysium } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 10);
    expect(() => bridge.deliverDeposit(m.id, 11)).toThrow(NotYetDueError);
    expect(elysium.get(BOB, USDC)).toBe(0n);
    expect(bridge.getDeposit(m.id).status).toBe("pending");
  });

  it("supports HYPE as the deposited asset, with the fee on top", () => {
    const { bridge, hyperEvm, elysium } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: HYPE, amount: 100n }, 0);
    expect(hyperEvm.get(ALICE, HYPE)).toBe(898n);
    bridge.deliverDeposit(m.id, 2);
    expect(elysium.get(BOB, HYPE)).toBe(100n);
  });

  it("rejects an unsupported asset", () => {
    const { bridge, hyperEvm } = fundedBridge();
    hyperEvm.credit(ALICE, "MEME", 10n);
    expect(() => bridge.depositToElysium({ from: ALICE, to: BOB, asset: "MEME", amount: 1n }, 0)).toThrow(UnsupportedAssetError);
  });

  it("rejects a zero amount", () => {
    const { bridge } = fundedBridge();
    expect(() => bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 0n }, 0)).toThrow(InvalidAmountError);
  });

  it("rejects a deposit without HYPE for the fee and changes nothing", () => {
    const { bridge, hyperEvm } = makeBridge();
    hyperEvm.credit(ALICE, USDC, 100n);
    expect(() => bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0)).toThrow(InsufficientBalanceError);
    expect(hyperEvm.get(ALICE, USDC)).toBe(100n);
    expect(bridge.escrowed(USDC)).toBe(0n);
  });

  it("finalizes after the parent finality delay", () => {
    const { bridge } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 10n }, 0);
    bridge.deliverDeposit(m.id, 2);
    expect(() => bridge.finalizeDeposit(m.id, 4)).toThrow(NotYetDueError);
    const f = bridge.finalizeDeposit(m.id, 5);
    expect(f.status).toBe("finalized");
    expect(f.finalizedAt).toBe(5);
  });

  it("cannot finalize a deposit that was not delivered", () => {
    const { bridge } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 10n }, 0);
    expect(() => bridge.finalizeDeposit(m.id, 100)).toThrow(InvalidTransitionError);
  });

  it("gives each deposit a distinct id even for identical requests", () => {
    const { bridge } = fundedBridge();
    const a = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 10n }, 0);
    const b = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 10n }, 0);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports an unknown message", () => {
    const { bridge } = fundedBridge();
    expect(() => bridge.deliverDeposit("nope", 0)).toThrow(UnknownMessageError);
    expect(() => bridge.getWithdrawal("nope")).toThrow(UnknownMessageError);
  });
});

describe("deposit replay and refund", () => {
  it("rejects a second delivery as a replay and credits once", () => {
    const { bridge, elysium } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    bridge.deliverDeposit(m.id, 2);
    expect(() => bridge.deliverDeposit(m.id, 3)).toThrow(ReplayError);
    expect(elysium.get(BOB, USDC)).toBe(100n);
  });

  it("refunds an expired deposit to the refund address and keeps the fee", () => {
    const { bridge, hyperEvm } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, refundTo: "carol", asset: USDC, amount: 100n }, 0);
    const r = bridge.refundDeposit(m.id, 20);
    expect(r.status).toBe("refunded");
    expect(hyperEvm.get("carol", USDC)).toBe(100n);
    expect(hyperEvm.get(BRIDGE_FEE_SINK, HYPE)).toBe(2n);
    expect(bridge.escrowed(USDC)).toBe(0n);
  });

  it("refunds to the sender by default", () => {
    const { bridge, hyperEvm } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    bridge.refundDeposit(m.id, 25);
    expect(hyperEvm.get(ALICE, USDC)).toBe(500n);
  });

  it("does not refund before the expiry", () => {
    const { bridge } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    expect(() => bridge.refundDeposit(m.id, 19)).toThrow(NotYetDueError);
  });

  it("does not deliver an expired deposit", () => {
    const { bridge } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    expect(() => bridge.deliverDeposit(m.id, 20)).toThrow(DeadlinePassedError);
  });

  it("does not refund a deposit that was delivered", () => {
    const { bridge } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    bridge.deliverDeposit(m.id, 2);
    expect(() => bridge.refundDeposit(m.id, 30)).toThrow(ReplayError);
  });

  it("does not deliver a refunded deposit", () => {
    const { bridge, elysium } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    bridge.refundDeposit(m.id, 20);
    expect(() => bridge.deliverDeposit(m.id, 21)).toThrow(ReplayError);
    expect(elysium.get(BOB, USDC)).toBe(0n);
  });

  it("does not refund twice", () => {
    const { bridge, hyperEvm } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    bridge.refundDeposit(m.id, 20);
    expect(() => bridge.refundDeposit(m.id, 21)).toThrow(ReplayError);
    expect(hyperEvm.get(ALICE, USDC)).toBe(500n);
  });

  it("blocks delivery while paused and allows it after unpausing", () => {
    const { bridge } = fundedBridge();
    const m = bridge.depositToElysium({ from: ALICE, to: BOB, asset: USDC, amount: 1n }, 0);
    bridge.pause();
    expect(bridge.isPaused).toBe(true);
    expect(() => bridge.deliverDeposit(m.id, 2)).toThrow(BridgePausedError);
    bridge.unpause();
    expect(bridge.deliverDeposit(m.id, 2).status).toBe("confirmed");
  });
});

describe("outbox withdrawal", () => {
  const withBalance = (overrides = {}) => {
    const t = fundedBridge(overrides);
    const dep = t.bridge.depositToElysium({ from: ALICE, to: ALICE, asset: USDC, amount: 300n }, 0);
    t.bridge.deliverDeposit(dep.id, 2);
    const depH = t.bridge.depositToElysium({ from: ALICE, to: ALICE, asset: HYPE, amount: 100n }, 0);
    t.bridge.deliverDeposit(depH.id, 2);
    return t;
  };

  it("locks the amount in the outbox and charges the fee in HYPE on Elysium", () => {
    const { bridge, elysium } = withBalance();
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 120n }, 5);
    expect(w.status).toBe("pending");
    expect(elysium.get(ALICE, USDC)).toBe(180n);
    expect(elysium.get(ALICE, HYPE)).toBe(97n);
    expect(elysium.get(BRIDGE_OUTBOX, USDC)).toBe(120n);
    expect(elysium.get(BRIDGE_FEE_SINK, HYPE)).toBe(3n);
  });

  it("starts the challenge window at confirmation", () => {
    const { bridge } = withBalance();
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 120n }, 5);
    const c = bridge.confirmWithdrawal(w.id, 8);
    expect(c.status).toBe("confirmed");
    expect(c.confirmedAt).toBe(8);
  });

  it("cannot execute an unconfirmed withdrawal", () => {
    const { bridge } = withBalance();
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 120n }, 5);
    expect(() => bridge.executeWithdrawal(w.id, 500)).toThrow(InvalidTransitionError);
  });

  it("holds the funds while the challenge window is open", () => {
    const { bridge, hyperEvm } = withBalance();
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 120n }, 5);
    bridge.confirmWithdrawal(w.id, 8);
    expect(() => bridge.executeWithdrawal(w.id, 57)).toThrow(NotYetDueError);
    expect(hyperEvm.get(BOB, USDC)).toBe(0n);
  });

  it("releases on HyperEVM exactly when the challenge delay has elapsed", () => {
    const { bridge, hyperEvm, elysium } = withBalance();
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 120n }, 5);
    bridge.confirmWithdrawal(w.id, 8);
    const e = bridge.executeWithdrawal(w.id, 58);
    expect(e.status).toBe("finalized");
    expect(hyperEvm.get(BOB, USDC)).toBe(120n);
    expect(elysium.get(BRIDGE_OUTBOX, USDC)).toBe(0n);
  });

  it("uses the challenge delay parameter", () => {
    const { bridge } = withBalance({ challengeDelay: 4 });
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 1n }, 0);
    bridge.confirmWithdrawal(w.id, 0);
    expect(() => bridge.executeWithdrawal(w.id, 3)).toThrow(NotYetDueError);
    expect(bridge.executeWithdrawal(w.id, 4).status).toBe("finalized");
  });

  it("supports HYPE withdrawals", () => {
    const { bridge, hyperEvm } = withBalance({ challengeDelay: 1 });
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: HYPE, amount: 50n }, 0);
    bridge.confirmWithdrawal(w.id, 0);
    bridge.executeWithdrawal(w.id, 1);
    expect(hyperEvm.get(BOB, HYPE)).toBe(50n);
  });

  it("rejects a second execution as a replay and pays once", () => {
    const { bridge, hyperEvm } = withBalance({ challengeDelay: 1 });
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 100n }, 0);
    bridge.confirmWithdrawal(w.id, 0);
    bridge.executeWithdrawal(w.id, 1);
    expect(() => bridge.executeWithdrawal(w.id, 2)).toThrow(ReplayError);
    expect(hyperEvm.get(BOB, USDC)).toBe(100n);
  });

  it("blocks execution while paused", () => {
    const { bridge } = withBalance({ challengeDelay: 1 });
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 1n }, 0);
    bridge.confirmWithdrawal(w.id, 0);
    bridge.pause();
    expect(() => bridge.executeWithdrawal(w.id, 5)).toThrow(BridgePausedError);
  });

  it("returns a challenged withdrawal to the sender on Elysium", () => {
    const { bridge, elysium } = withBalance();
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 120n }, 5);
    bridge.confirmWithdrawal(w.id, 8);
    const c = bridge.challengeWithdrawal(w.id, 30);
    expect(c.status).toBe("failed");
    expect(elysium.get(ALICE, USDC)).toBe(300n);
    expect(elysium.get(BRIDGE_OUTBOX, USDC)).toBe(0n);
    expect(() => bridge.executeWithdrawal(w.id, 100)).toThrow(InvalidTransitionError);
  });

  it("rejects a challenge once the window has closed", () => {
    const { bridge } = withBalance();
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 1n }, 0);
    bridge.confirmWithdrawal(w.id, 0);
    expect(() => bridge.challengeWithdrawal(w.id, 50)).toThrow(DeadlinePassedError);
  });

  it("rejects a withdrawal larger than the balance and changes nothing", () => {
    const { bridge, elysium } = withBalance();
    expect(() => bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 301n }, 0)).toThrow(InsufficientBalanceError);
    expect(elysium.get(ALICE, USDC)).toBe(300n);
  });

  it("rejects an unsupported asset", () => {
    const { bridge } = withBalance();
    expect(() => bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: "MEME", amount: 1n }, 0)).toThrow(UnsupportedAssetError);
  });

  it("cannot confirm the same withdrawal twice", () => {
    const { bridge } = withBalance();
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 1n }, 0);
    bridge.confirmWithdrawal(w.id, 0);
    expect(() => bridge.confirmWithdrawal(w.id, 1)).toThrow(InvalidTransitionError);
  });

  it("keeps the replay guard separate per message id", () => {
    const { bridge, hyperEvm } = withBalance({ challengeDelay: 1 });
    const a = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 10n }, 0);
    const b = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 10n }, 0);
    bridge.confirmWithdrawal(a.id, 0);
    bridge.confirmWithdrawal(b.id, 0);
    bridge.executeWithdrawal(a.id, 1);
    bridge.executeWithdrawal(b.id, 1);
    expect(hyperEvm.get(BOB, USDC)).toBe(20n);
  });
});

describe("conservation", () => {
  it("keeps escrow equal to Elysium supply plus deposits in flight", () => {
    const { bridge, elysium } = fundedBridge({ challengeDelay: 1 });
    expect(bridge.isBacked(USDC)).toBe(true);
    const d1 = bridge.depositToElysium({ from: ALICE, to: ALICE, asset: USDC, amount: 200n }, 0);
    expect(bridge.isBacked(USDC)).toBe(true);
    expect(bridge.pendingDepositAmount(USDC)).toBe(200n);
    bridge.deliverDeposit(d1.id, 2);
    expect(bridge.isBacked(USDC)).toBe(true);
    const d2 = bridge.depositToElysium({ from: ALICE, to: ALICE, asset: HYPE, amount: 20n }, 0);
    bridge.deliverDeposit(d2.id, 2);
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 50n }, 3);
    expect(bridge.isBacked(USDC)).toBe(true);
    bridge.confirmWithdrawal(w.id, 3);
    bridge.executeWithdrawal(w.id, 4);
    expect(bridge.isBacked(USDC)).toBe(true);
    expect(bridge.escrowed(USDC)).toBe(150n);
    expect(elysium.total(USDC)).toBe(150n);
  });

  it("stays backed after a refund and after a challenge", () => {
    const { bridge } = fundedBridge();
    const d = bridge.depositToElysium({ from: ALICE, to: ALICE, asset: USDC, amount: 40n }, 0);
    bridge.refundDeposit(d.id, 20);
    expect(bridge.isBacked(USDC)).toBe(true);
    const d2 = bridge.depositToElysium({ from: ALICE, to: ALICE, asset: USDC, amount: 40n }, 30);
    bridge.deliverDeposit(d2.id, 32);
    const h = bridge.depositToElysium({ from: ALICE, to: ALICE, asset: HYPE, amount: 10n }, 30);
    bridge.deliverDeposit(h.id, 32);
    const w = bridge.initiateWithdrawal({ from: ALICE, to: BOB, asset: USDC, amount: 40n }, 33);
    bridge.confirmWithdrawal(w.id, 33);
    bridge.challengeWithdrawal(w.id, 34);
    expect(bridge.isBacked(USDC)).toBe(true);
  });
});
