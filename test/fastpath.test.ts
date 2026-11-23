import { describe, expect, it } from "vitest";
import {
  DeadlinePassedError,
  FASTPATH_ESCROW,
  FASTPATH_ROUTER,
  HYPE,
  InsufficientBalanceError,
  InsufficientLiquidityError,
  InvalidConfigError,
  InvalidTransitionError,
  LimitExceededError,
  NotYetDueError,
  UnknownRelayerError,
  UnknownTransferError,
  UnsupportedAssetError,
  USDC,
  type FastPath,
  type World,
} from "../src/index.js";
import { ALICE, BOB, RELAYER, addRelayer, makeWorld, thrown } from "./helpers.js";

function exitWorld(config = {}) {
  const w = makeWorld({ bridge: { challengeDelay: 30 }, ...config });
  // Alice holds 200 USDC on Elysium, backed in the bridge escrow.
  w.elysium.credit(ALICE, USDC, 200n);
  w.hyperEvm.credit("bridge-escrow", USDC, 200n);
  addRelayer(w);
  return w;
}

function entryWorld(config = {}) {
  const w = makeWorld(config);
  w.hyperEvm.credit(ALICE, USDC, 200n);
  addRelayer(w);
  return w;
}

const exit = (fp: FastPath, amount = 100n, recipient = BOB) => fp.open({ direction: "exit", user: ALICE, recipient, asset: USDC, amount }, 0);
const entry = (fp: FastPath, amount = 100n, recipient = BOB) => fp.open({ direction: "entry", user: ALICE, recipient, asset: USDC, amount }, 0);

describe("open", () => {
  it("moves the amount and both fees into the escrow and starts the canonical message", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    expect(t.status).toBe("pending");
    expect(t.fillDeadline).toBe(10);
    expect(w.elysium.get(ALICE, USDC)).toBe(100n);
    expect(w.elysium.get(ALICE, HYPE)).toBe(20n - 5n);
    expect(w.elysium.get(FASTPATH_ESCROW, HYPE)).toBe(2n);
    expect(w.bridge.getWithdrawal(t.canonicalId).to).toBe(FASTPATH_ROUTER);
    expect(w.fastPath.totalFee("exit")).toBe(5n);
    expect(w.fastPath.totalFee("entry")).toBe(4n);
  });

  it("rejects an unsupported asset and a user who cannot pay", () => {
    const w = exitWorld();
    expect(() => w.fastPath.open({ direction: "exit", user: ALICE, recipient: BOB, asset: "MEME", amount: 1n }, 0)).toThrow(UnsupportedAssetError);
    expect(() => exit(w.fastPath, 201n)).toThrow(InsufficientBalanceError);
    expect(w.elysium.get(ALICE, USDC)).toBe(200n);
  });

  it("rejects a zero amount", () => {
    const w = exitWorld();
    expect(thrown(() => exit(w.fastPath, 0n))).toMatchObject({ code: "INVALID_AMOUNT" });
  });
});

describe("fill and settle, exit", () => {
  it("pays the recipient on HyperEVM at once and leaves the canonical message in flight", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    const f = w.fastPath.fill(t.id, RELAYER, 1);
    expect(f.status).toBe("confirmed");
    expect(f.path).toBe("fast");
    expect(f.relayer).toBe(RELAYER);
    expect(w.hyperEvm.get(BOB, USDC)).toBe(100n);
    expect(w.hyperEvm.get(RELAYER, USDC)).toBe(4900n);
    expect(w.bridge.getWithdrawal(t.canonicalId).status).toBe("pending");
  });

  it("repays the relayer from the canonical message and pays its fee", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    expect(() => w.fastPath.settle(t.id, 2)).toThrow(NotYetDueError);
    w.fastPath.pump(t.id, 2);
    expect(() => w.fastPath.settle(t.id, 2)).toThrow(NotYetDueError);
    w.fastPath.pump(t.id, 32);
    const s = w.fastPath.settle(t.id, 32);
    expect(s.status).toBe("finalized");
    expect(w.hyperEvm.get(RELAYER, USDC)).toBe(5000n);
    expect(w.hyperEvm.get(BOB, USDC)).toBe(100n);
    expect(w.elysium.get(RELAYER, HYPE)).toBe(100n + 2n);
    expect(w.hyperEvm.get(FASTPATH_ROUTER, USDC)).toBe(0n);
    // The relayer seed on Elysium (5000) was credited directly, so it is not backed by escrow.
    expect(w.bridge.escrowed(USDC)).toBe(w.elysium.total(USDC) - 5000n);
  });

  it("falls back to the canonical path when nobody fills", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    w.fastPath.pump(t.id, 1);
    w.fastPath.pump(t.id, 31);
    const s = w.fastPath.settle(t.id, 31);
    expect(s.status).toBe("finalized");
    expect(s.path).toBe("canonical");
    expect(w.hyperEvm.get(BOB, USDC)).toBe(100n);
    expect(w.elysium.get(ALICE, HYPE)).toBe(20n - 5n + 2n);
    expect(w.elysium.get(FASTPATH_ESCROW, HYPE)).toBe(0n);
  });

  it("does not settle a second time", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    w.fastPath.pump(t.id, 1);
    w.fastPath.pump(t.id, 31);
    w.fastPath.settle(t.id, 31);
    expect(() => w.fastPath.settle(t.id, 32)).toThrow(InvalidTransitionError);
    expect(w.hyperEvm.get(RELAYER, USDC)).toBe(5000n);
  });

  it("does not fill a second time", () => {
    const w = exitWorld();
    addRelayer(w, 5000n, 100n, "relayer-2");
    const t = exit(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    expect(() => w.fastPath.fill(t.id, "relayer-2", 2)).toThrow(InvalidTransitionError);
    expect(w.hyperEvm.get(BOB, USDC)).toBe(100n);
  });
});

describe("fill rejections and refund timeouts", () => {
  it("rejects a fill after the fill window", () => {
    const w = exitWorld({ fastPath: { fillWindow: 5 } });
    const t = exit(w.fastPath);
    expect(() => w.fastPath.fill(t.id, RELAYER, 6)).toThrow(DeadlinePassedError);
    expect(w.fastPath.fill(t.id, RELAYER, 5).status).toBe("confirmed");
  });

  it("rejects an unknown relayer", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    expect(() => w.fastPath.fill(t.id, "mallory", 1)).toThrow(UnknownRelayerError);
  });

  it("rejects a fill larger than the relayer inventory", () => {
    const w = exitWorld();
    w.hyperEvm.debit(RELAYER, USDC, 4950n);
    const t = exit(w.fastPath);
    expect(() => w.fastPath.fill(t.id, RELAYER, 1)).toThrow(InsufficientLiquidityError);
    expect(w.fastPath.autoFill(t.id, 1)).toBe(false);
    expect(w.fastPath.get(t.id).status).toBe("pending");
  });

  it("autoFill uses the next relayer when the first is short", () => {
    const w = exitWorld();
    addRelayer(w, 1000n, 10n, "relayer-2");
    w.hyperEvm.debit(RELAYER, USDC, 4950n);
    const t = exit(w.fastPath);
    expect(w.fastPath.autoFill(t.id, 1)).toBe(true);
    expect(w.fastPath.get(t.id).relayer).toBe("relayer-2");
  });

  it("autoFill returns false once the window has closed", () => {
    const w = exitWorld({ fastPath: { fillWindow: 2 } });
    const t = exit(w.fastPath);
    expect(w.fastPath.autoFill(t.id, 3)).toBe(false);
  });

  it("reports an unknown transfer", () => {
    const w = exitWorld();
    expect(() => w.fastPath.get("nope")).toThrow(UnknownTransferError);
    expect(() => w.fastPath.settle("nope", 0)).toThrow(UnknownTransferError);
  });

  it("refunds the user when no relayer filled and the canonical withdrawal is challenged", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    w.fastPath.pump(t.id, 1);
    w.bridge.challengeWithdrawal(t.canonicalId, 5);
    const s = w.fastPath.settle(t.id, 5);
    expect(s.status).toBe("refunded");
    expect(w.elysium.get(ALICE, USDC)).toBe(200n);
    expect(w.elysium.get(ALICE, HYPE)).toBe(20n - 3n);
    expect(w.elysium.get(FASTPATH_ESCROW, USDC)).toBe(0n);
  });

  it("repays the relayer at the source when a filled withdrawal is challenged", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    w.fastPath.pump(t.id, 1);
    w.bridge.challengeWithdrawal(t.canonicalId, 5);
    const s = w.fastPath.settle(t.id, 5);
    expect(s.status).toBe("failed");
    expect(w.elysium.get(RELAYER, USDC)).toBe(5000n + 100n);
    expect(w.hyperEvm.get(BOB, USDC)).toBe(100n);
    expect(w.elysium.get(ALICE, USDC)).toBe(100n);
  });

  it("cannot fill a transfer whose canonical message already failed", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    w.fastPath.pump(t.id, 1);
    w.bridge.challengeWithdrawal(t.canonicalId, 5);
    expect(() => w.fastPath.fill(t.id, RELAYER, 6)).toThrow(InvalidTransitionError);
  });

  it("refunds an entry whose deposit expired because the bridge was paused", () => {
    const w = entryWorld({ bridge: { inboxDelay: 2, depositExpiry: 8 } });
    const t = entry(w.fastPath);
    w.bridge.pause();
    w.fastPath.pump(t.id, 3);
    expect(() => w.fastPath.settle(t.id, 3)).toThrow(NotYetDueError);
    w.fastPath.pump(t.id, 8);
    const s = w.fastPath.settle(t.id, 8);
    expect(s.status).toBe("refunded");
    expect(w.hyperEvm.get(ALICE, USDC)).toBe(200n);
    expect(w.hyperEvm.get(ALICE, HYPE)).toBe(20n - 2n);
  });

  it("repays the relayer on HyperEVM when a filled entry expires", () => {
    const w = entryWorld({ bridge: { inboxDelay: 2, depositExpiry: 8 } });
    const t = entry(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    expect(w.elysium.get(BOB, USDC)).toBe(100n);
    w.bridge.pause();
    w.fastPath.pump(t.id, 9);
    const s = w.fastPath.settle(t.id, 9);
    expect(s.status).toBe("failed");
    expect(w.hyperEvm.get(RELAYER, USDC)).toBe(5100n);
    expect(w.hyperEvm.get(RELAYER, HYPE)).toBe(102n);
  });
});

describe("entry", () => {
  it("pays the recipient on Elysium at once and repays the relayer after the deposit is final", () => {
    const w = entryWorld();
    const t = entry(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    expect(w.elysium.get(BOB, USDC)).toBe(100n);
    expect(() => w.fastPath.settle(t.id, 1)).toThrow(NotYetDueError);
    w.fastPath.pump(t.id, 2);
    expect(() => w.fastPath.settle(t.id, 2)).toThrow(NotYetDueError);
    w.fastPath.pump(t.id, 5);
    expect(w.fastPath.settle(t.id, 5).status).toBe("finalized");
    expect(w.elysium.get(RELAYER, USDC)).toBe(5000n);
    expect(w.hyperEvm.get(RELAYER, HYPE)).toBe(102n);
    expect(w.bridge.escrowed(USDC)).toBe(w.elysium.total(USDC) - 5000n);
  });

  it("delivers canonically when nobody fills", () => {
    const w = entryWorld();
    const t = entry(w.fastPath);
    w.fastPath.pump(t.id, 2);
    w.fastPath.pump(t.id, 5);
    const s = w.fastPath.settle(t.id, 5);
    expect(s.path).toBe("canonical");
    expect(w.elysium.get(BOB, USDC)).toBe(100n);
  });
});

describe("limits", () => {
  const limit = { min: 10n, maxPerTransfer: 100n, maxOutstanding: 150n };

  it("rejects an amount below the minimum", () => {
    const w = exitWorld();
    w.fastPath.setLimit("exit", USDC, limit);
    const err = thrown(() => exit(w.fastPath, 9n)) as LimitExceededError;
    expect(err).toBeInstanceOf(LimitExceededError);
    expect(err.limit).toBe("min");
    expect(err.code).toBe("LIMIT_EXCEEDED");
  });

  it("rejects an amount above the per-transfer limit and changes nothing", () => {
    const w = exitWorld();
    w.fastPath.setLimit("exit", USDC, limit);
    const err = thrown(() => exit(w.fastPath, 101n)) as LimitExceededError;
    expect(err.limit).toBe("per-transfer");
    expect(w.elysium.get(ALICE, USDC)).toBe(200n);
  });

  it("accepts exactly the per-transfer limit", () => {
    const w = exitWorld();
    w.fastPath.setLimit("exit", USDC, limit);
    expect(exit(w.fastPath, 100n).status).toBe("pending");
  });

  it("rejects a transfer that would push outstanding value past the limit", () => {
    const w = exitWorld();
    w.fastPath.setLimit("exit", USDC, limit);
    exit(w.fastPath, 100n);
    const err = thrown(() => exit(w.fastPath, 51n)) as LimitExceededError;
    expect(err.limit).toBe("outstanding");
    expect(w.fastPath.outstanding("exit", USDC)).toBe(100n);
    expect(exit(w.fastPath, 50n).status).toBe("pending");
  });

  it("frees outstanding capacity when a transfer settles", () => {
    const w = exitWorld();
    w.fastPath.setLimit("exit", USDC, limit);
    const t = exit(w.fastPath, 100n);
    w.fastPath.pump(t.id, 1);
    w.fastPath.pump(t.id, 31);
    w.fastPath.settle(t.id, 31);
    expect(w.fastPath.outstanding("exit", USDC)).toBe(0n);
    expect(exit(w.fastPath, 100n).status).toBe("pending");
  });

  it("frees outstanding capacity when a transfer is refunded", () => {
    const w = exitWorld();
    w.fastPath.setLimit("exit", USDC, limit);
    const t = exit(w.fastPath, 100n);
    w.fastPath.pump(t.id, 1);
    w.bridge.challengeWithdrawal(t.canonicalId, 2);
    w.fastPath.settle(t.id, 2);
    expect(w.fastPath.outstanding("exit", USDC)).toBe(0n);
  });

  it("keeps limits per direction and per asset", () => {
    const w = exitWorld();
    w.fastPath.setLimit("exit", USDC, limit);
    w.hyperEvm.credit(ALICE, USDC, 500n);
    expect(entry(w.fastPath, 500n).status).toBe("pending");
    w.elysium.credit(ALICE, HYPE, 500n);
    w.hyperEvm.credit("bridge-escrow", HYPE, 500n);
    expect(w.fastPath.open({ direction: "exit", user: ALICE, recipient: BOB, asset: HYPE, amount: 400n }, 0).status).toBe("pending");
    expect(w.fastPath.getLimit("entry", USDC)).toBeUndefined();
    expect(w.fastPath.getLimit("exit", USDC)).toEqual(limit);
  });

  it("validates a limit when it is set", () => {
    const w = exitWorld();
    expect(() => w.fastPath.setLimit("exit", USDC, { min: 0n, maxPerTransfer: 0n, maxOutstanding: 5n })).toThrow(InvalidConfigError);
    expect(() => w.fastPath.setLimit("exit", USDC, { min: 10n, maxPerTransfer: 5n, maxOutstanding: 50n })).toThrow(InvalidConfigError);
    expect(() => w.fastPath.setLimit("exit", USDC, { min: 1n, maxPerTransfer: 60n, maxOutstanding: 50n })).toThrow(InvalidConfigError);
  });
});

describe("conservation", () => {
  const holds = (w: World, account: string, asset: string) => w.hyperEvm.get(account, asset) + w.elysium.get(account, asset);

  it("leaves the relayer with the same USDC after a filled exit and gives the recipient the amount", () => {
    const w = exitWorld();
    const before = holds(w, RELAYER, USDC);
    const t = exit(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    w.fastPath.pump(t.id, 1);
    w.fastPath.pump(t.id, 31);
    w.fastPath.settle(t.id, 31);
    expect(holds(w, RELAYER, USDC)).toBe(before);
    expect(w.hyperEvm.get(BOB, USDC)).toBe(100n);
    expect(w.bridge.escrowed(USDC)).toBe(100n);
  });

  it("earns the relayer exactly the relayer fee", () => {
    const w = exitWorld();
    const before = holds(w, RELAYER, HYPE);
    const t = exit(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    w.fastPath.pump(t.id, 1);
    w.fastPath.pump(t.id, 31);
    w.fastPath.settle(t.id, 31);
    expect(holds(w, RELAYER, HYPE) - before).toBe(w.fastPath.config.relayerFee);
  });

  it("keeps HYPE constant across a fallback exit, since fees only move to sinks", () => {
    const w = exitWorld();
    const total = () => w.hyperEvm.total(HYPE) + w.elysium.total(HYPE);
    const before = total();
    const t = exit(w.fastPath);
    w.fastPath.pump(t.id, 1);
    w.fastPath.pump(t.id, 31);
    w.fastPath.settle(t.id, 31);
    expect(total()).toBe(before);
  });

  it("leaves nothing in the escrow or the router after a settled transfer", () => {
    const w = exitWorld();
    const t = exit(w.fastPath);
    w.fastPath.fill(t.id, RELAYER, 1);
    w.fastPath.pump(t.id, 1);
    w.fastPath.pump(t.id, 31);
    w.fastPath.settle(t.id, 31);
    for (const ledger of [w.hyperEvm, w.elysium]) {
      for (const asset of [USDC, HYPE]) {
        expect(ledger.get(FASTPATH_ESCROW, asset)).toBe(0n);
        expect(ledger.get(FASTPATH_ROUTER, asset)).toBe(0n);
      }
    }
  });
});
