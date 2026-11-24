import { describe, expect, it } from "vitest";
import {
  InsufficientBalanceError,
  InvalidAmountError,
  InvalidRouteError,
  NoteSpentError,
  RouteRun,
  UnsupportedAssetError,
  HYPE,
  USDC,
  feeScheduleOf,
  fundingShortfalls,
  planShieldOnArrival,
  planUnshieldToCore,
} from "../src/index.js";
import { ALICE, BOB, makeWorld } from "./helpers.js";

describe("fee schedule", () => {
  it("reads the fee schedule from the world components", () => {
    const w = makeWorld({ bridge: { inboxFee: 7n, outboxFee: 8n }, spot: { fee: 3n }, shieldFee: 4n, unshieldFee: 5n, fastPath: { relayerFee: 6n } });
    expect(feeScheduleOf(w)).toEqual({
      coreToEvm: 3n,
      evmToElysium: 7n,
      evmToElysiumFast: 13n,
      shield: 4n,
      unshield: 5n,
      elysiumToEvm: 8n,
      elysiumToEvmFast: 14n,
      evmToCore: 3n,
    });
  });
});

describe("funding checks", () => {
  it("lists the domains that lack HYPE", () => {
    const w = makeWorld();
    w.elysium.debit(ALICE, HYPE, 20n);
    const p = planShieldOnArrival({ account: ALICE, asset: USDC, amount: 10n, fees: feeScheduleOf(w) });
    expect(fundingShortfalls(w, p)).toEqual([{ domain: "elysium", required: 1n, available: 0n }]);
  });

  it("refuses to start a route that cannot pay its fees", () => {
    const w = makeWorld();
    w.hyperEvm.debit(ALICE, HYPE, 20n);
    const p = planShieldOnArrival({ account: ALICE, asset: USDC, amount: 10n, fees: feeScheduleOf(w) });
    expect(() => new RouteRun(w, p)).toThrow(InsufficientBalanceError);
    expect(w.core.get(ALICE, USDC)).toBe(1000n);
  });

  it("refuses an asset one of the legs does not support", () => {
    const w = makeWorld();
    const p = planShieldOnArrival({ account: ALICE, asset: "MEME", amount: 10n, fees: feeScheduleOf(w) });
    expect(() => new RouteRun(w, p)).toThrow(UnsupportedAssetError);
  });

  it("refuses an unshield route whose note does not match", () => {
    const w = makeWorld();
    w.elysium.credit(ALICE, USDC, 50n);
    const { noteId } = w.pool.shield({ owner: ALICE, asset: USDC, amount: 50n }, 0);
    const wrongAmount = planUnshieldToCore({ account: ALICE, asset: USDC, amount: 49n, noteId, fees: feeScheduleOf(w) });
    expect(() => new RouteRun(w, wrongAmount)).toThrow(InvalidRouteError);
    const wrongOwner = planUnshieldToCore({ account: BOB, asset: USDC, amount: 50n, noteId, fees: feeScheduleOf(w) });
    w.elysium.credit(BOB, HYPE, 10n);
    w.hyperEvm.credit(BOB, HYPE, 10n);
    w.core.credit(BOB, HYPE, 10n);
    expect(() => new RouteRun(w, wrongOwner)).toThrow(InvalidRouteError);
  });

  it("refuses an unshield route for a spent note", () => {
    const w = makeWorld();
    w.elysium.credit(ALICE, USDC, 50n);
    const { noteId } = w.pool.shield({ owner: ALICE, asset: USDC, amount: 50n }, 0);
    w.pool.unshield({ noteId, owner: ALICE, recipient: ALICE }, 1);
    const p = planUnshieldToCore({ account: ALICE, asset: USDC, amount: 50n, noteId, fees: feeScheduleOf(w) });
    expect(() => new RouteRun(w, p)).toThrow(InvalidRouteError);
  });
});

describe("shield on arrival, canonical", () => {
  function start(asset = USDC, amount = 100n) {
    const w = makeWorld();
    const plan = planShieldOnArrival({ account: ALICE, asset, amount, fees: feeScheduleOf(w) });
    return { w, plan, run: new RouteRun(w, plan) };
  }

  it("starts idle and submits the first hop on the first step", () => {
    const { run, w } = start();
    expect(run.status).toBe("running");
    expect(run.hops.map((h) => h.status)).toEqual(["idle", "idle", "idle"]);
    expect(run.advance(0)).toBe(true);
    expect(run.hops[0]!.status).toBe("pending");
    expect(w.core.get(ALICE, USDC)).toBe(900n);
  });

  it("walks each hop through pending, confirmed and finalized", () => {
    const { run } = start();
    run.run(0);
    const byHop = (i: number) => run.events.filter((e) => e.hop === i).map((e) => e.status);
    expect(byHop(0)).toEqual(["pending", "confirmed", "finalized"]);
    expect(byHop(1)).toEqual(["pending", "confirmed", "finalized"]);
    expect(byHop(2)).toEqual(["pending", "confirmed", "finalized"]);
  });

  it("completes with the value in the shielded pool", () => {
    const { run, w } = start();
    expect(run.run(0)).toBe("completed");
    expect(run.note).toBe("note-0");
    expect(w.pool.note("note-0")).toEqual({ owner: ALICE, asset: USDC, amount: 100n, spent: false });
    expect(w.core.get(ALICE, USDC)).toBe(900n);
    expect(w.hyperEvm.get(ALICE, USDC)).toBe(0n);
    expect(w.elysium.get(ALICE, USDC)).toBe(0n);
    expect(run.position()).toBe("elysium");
  });

  it("charges every hop fee in HYPE on the domain that starts the hop", () => {
    const { run, w } = start();
    run.run(0);
    expect(w.core.get(ALICE, HYPE)).toBe(19n);
    expect(w.hyperEvm.get(ALICE, HYPE)).toBe(18n);
    expect(w.elysium.get(ALICE, HYPE)).toBe(19n);
  });

  it("keeps the bridge backed after the route", () => {
    const { run, w } = start();
    run.run(0);
    expect(w.bridge.escrowed(USDC)).toBe(100n);
    expect(w.pool.shieldedTotal(USDC)).toBe(100n);
  });

  it("waits for the inbox delay before crediting Elysium", () => {
    const w = makeWorld({ bridge: { inboxDelay: 10, depositExpiry: 40 } });
    const run = new RouteRun(w, planShieldOnArrival({ account: ALICE, asset: USDC, amount: 5n, fees: feeScheduleOf(w) }));
    run.run(0);
    const submit = run.events.find((e) => e.hop === 1 && e.status === "pending")!;
    const confirm = run.events.find((e) => e.hop === 1 && e.status === "confirmed")!;
    expect(confirm.tick - submit.tick).toBe(10);
  });

  it("moves HYPE itself through the route", () => {
    const { run, w } = start(HYPE, 10n);
    expect(run.run(0)).toBe("completed");
    expect(w.pool.note("note-0").asset).toBe(HYPE);
    expect(w.pool.shieldedTotal(HYPE)).toBe(10n);
  });

  it("can start from HyperEVM", () => {
    const w = makeWorld();
    w.hyperEvm.credit(ALICE, USDC, 30n);
    const plan = planShieldOnArrival({ account: ALICE, asset: USDC, amount: 30n, fees: feeScheduleOf(w), from: "hyperevm" });
    const run = new RouteRun(w, plan);
    expect(run.run(0)).toBe("completed");
    expect(w.pool.shieldedTotal(USDC)).toBe(30n);
  });

  it("does nothing once the route has ended", () => {
    const { run } = start();
    run.run(0);
    const n = run.events.length;
    expect(run.advance(500)).toBe(false);
    expect(run.events).toHaveLength(n);
  });

  it("is deterministic: two runs give the same event log", () => {
    const a = start().run;
    const b = start().run;
    a.run(0);
    b.run(0);
    expect(a.events).toEqual(b.events);
  });

  it("stays running when the tick budget is too small", () => {
    const { run } = start();
    expect(run.run(0, { maxTicks: 1 })).toBe("running");
  });
});

describe("shield on arrival, failures", () => {
  it("fails and leaves the value on HyperCore when the spot leg rejects", () => {
    const w = makeWorld();
    w.spot.rejectNextConfirm();
    const run = new RouteRun(w, planShieldOnArrival({ account: ALICE, asset: USDC, amount: 100n, fees: feeScheduleOf(w) }));
    expect(run.run(0)).toBe("failed");
    expect(run.hops[0]!.status).toBe("failed");
    expect(run.position()).toBe("hyperliquid");
    expect(w.core.get(ALICE, USDC)).toBe(1000n);
  });

  it("fails at the shield hop when Elysium HYPE is spent mid route, stranding the value on Elysium", () => {
    const w = makeWorld();
    const run = new RouteRun(w, planShieldOnArrival({ account: ALICE, asset: USDC, amount: 100n, fees: feeScheduleOf(w) }));
    run.advance(0);
    w.elysium.debit(ALICE, HYPE, 20n);
    expect(run.run(1)).toBe("failed");
    expect(run.hops[2]!.status).toBe("failed");
    expect(run.position()).toBe("elysium");
    expect(w.elysium.get(ALICE, USDC)).toBe(100n);
  });

  it("refunds the deposit hop when the bridge is paused past the expiry", () => {
    const w = makeWorld({ bridge: { inboxDelay: 2, depositExpiry: 6 } });
    const run = new RouteRun(w, planShieldOnArrival({ account: ALICE, asset: USDC, amount: 100n, fees: feeScheduleOf(w) }));
    w.bridge.pause();
    expect(run.run(0)).toBe("refunded");
    expect(run.hops[1]!.status).toBe("refunded");
    expect(run.position()).toBe("hyperevm");
    expect(w.hyperEvm.get(ALICE, USDC)).toBe(100n);
    expect(w.bridge.escrowed(USDC)).toBe(0n);
  });

  it("resumes after an unpause inside the expiry", () => {
    const w = makeWorld({ bridge: { inboxDelay: 2, depositExpiry: 30 } });
    const run = new RouteRun(w, planShieldOnArrival({ account: ALICE, asset: USDC, amount: 100n, fees: feeScheduleOf(w) }));
    w.bridge.pause();
    run.run(0, { maxTicks: 8 });
    expect(run.status).toBe("running");
    w.bridge.unpause();
    expect(run.run(9)).toBe("completed");
  });
});

describe("unshield to HyperCore, canonical", () => {
  function setup(asset = USDC, challengeDelay = 50) {
    const w = makeWorld({ bridge: { challengeDelay } });
    w.elysium.credit(ALICE, asset, 200n);
    const { noteId } = w.pool.shield({ owner: ALICE, asset, amount: 150n }, 0);
    const plan = planUnshieldToCore({ account: ALICE, asset, amount: 150n, noteId, fees: feeScheduleOf(w) });
    return { w, plan, run: new RouteRun(w, plan) };
  }

  it("needs HYPE on Elysium and HyperEVM for fees, and none for the note amount", () => {
    const { plan } = setup();
    expect(plan.requiredHype).toEqual({ hyperliquid: 0n, hyperevm: 1n, elysium: 4n });
  });

  it("completes with the funds back in the HyperCore spot balance", () => {
    const { run, w } = setup();
    // The escrow for HyperEVM must hold backing for the withdrawal. Back the Elysium supply first.
    w.hyperEvm.credit("bridge-escrow", USDC, 200n);
    expect(run.run(0)).toBe("completed");
    expect(w.core.get(ALICE, USDC)).toBe(1150n);
    expect(w.pool.shieldedTotal(USDC)).toBe(0n);
    expect(run.position()).toBe("hyperliquid");
  });

  it("takes at least the challenge delay on the exit hop", () => {
    const { run, w } = setup(USDC, 40);
    w.hyperEvm.credit("bridge-escrow", USDC, 200n);
    run.run(0);
    const confirm = run.events.find((e) => e.hop === 1 && e.status === "confirmed")!;
    const done = run.events.find((e) => e.hop === 1 && e.status === "finalized")!;
    expect(done.tick - confirm.tick).toBe(40);
  });

  it("walks every hop through the same statuses", () => {
    const { run, w } = setup();
    w.hyperEvm.credit("bridge-escrow", USDC, 200n);
    run.run(0);
    for (const i of [0, 1, 2]) {
      expect(run.events.filter((e) => e.hop === i).map((e) => e.status)).toEqual(["pending", "confirmed", "finalized"]);
    }
  });

  it("spends the note exactly once", () => {
    const { run, w } = setup();
    w.hyperEvm.credit("bridge-escrow", USDC, 200n);
    run.run(0);
    expect(() => w.pool.unshield({ noteId: run.note!, owner: ALICE, recipient: ALICE }, 99)).toThrow(NoteSpentError);
  });

  it("stops on HyperEVM when the plan ends there", () => {
    const w = makeWorld({ bridge: { challengeDelay: 5 } });
    w.elysium.credit(ALICE, USDC, 20n);
    w.hyperEvm.credit("bridge-escrow", USDC, 20n);
    const { noteId } = w.pool.shield({ owner: ALICE, asset: USDC, amount: 20n }, 0);
    const run = new RouteRun(w, planUnshieldToCore({ account: ALICE, asset: USDC, amount: 20n, noteId, fees: feeScheduleOf(w), to: "hyperevm" }));
    expect(run.run(0)).toBe("completed");
    expect(w.hyperEvm.get(ALICE, USDC)).toBe(20n);
    expect(run.position()).toBe("hyperevm");
  });

  it("fails and strands the value on Elysium when the withdrawal is challenged", () => {
    const { run, w } = setup();
    w.hyperEvm.credit("bridge-escrow", USDC, 200n);
    run.run(0, { maxTicks: 10 });
    const id = run.hops[1]!.ref!;
    w.bridge.challengeWithdrawal(id, 11);
    expect(w.elysium.get(ALICE, USDC)).toBe(200n);
    expect(run.run(11, { maxTicks: 100 })).toBe("failed");
    expect(run.hops[1]!.status).toBe("failed");
    expect(run.position()).toBe("elysium");
    expect(w.hyperEvm.get(ALICE, USDC)).toBe(0n);
  });
});

describe("full round trip", () => {
  it("goes Hyperliquid to the shielded pool and back with only HYPE fees lost", () => {
    const w = makeWorld({ bridge: { challengeDelay: 30 } });
    const fees = feeScheduleOf(w);
    const inRun = new RouteRun(w, planShieldOnArrival({ account: ALICE, asset: USDC, amount: 250n, fees }));
    expect(inRun.run(0)).toBe("completed");
    const noteId = inRun.note!;
    const outRun = new RouteRun(w, planUnshieldToCore({ account: ALICE, asset: USDC, amount: 250n, noteId, fees }));
    expect(outRun.run(100)).toBe("completed");
    expect(w.core.get(ALICE, USDC)).toBe(1000n);
    expect(w.hyperEvm.get(ALICE, USDC)).toBe(0n);
    expect(w.elysium.get(ALICE, USDC)).toBe(0n);
    expect(w.bridge.escrowed(USDC)).toBe(0n);
    expect(w.bridge.isBacked(USDC)).toBe(true);
    const spent = inRun.plan.totalFee + outRun.plan.totalFee;
    const hype = w.core.get(ALICE, HYPE) + w.hyperEvm.get(ALICE, HYPE) + w.elysium.get(ALICE, HYPE);
    expect(hype).toBe(60n - spent);
  });

  it("round trips HYPE and conserves HYPE except for fees", () => {
    const w = makeWorld({ bridge: { challengeDelay: 10 } });
    const fees = feeScheduleOf(w);
    const inRun = new RouteRun(w, planShieldOnArrival({ account: ALICE, asset: HYPE, amount: 10n, fees }));
    expect(inRun.run(0)).toBe("completed");
    const outRun = new RouteRun(w, planUnshieldToCore({ account: ALICE, asset: HYPE, amount: 10n, noteId: inRun.note!, fees }));
    expect(outRun.run(100)).toBe("completed");
    const hype = w.core.get(ALICE, HYPE) + w.hyperEvm.get(ALICE, HYPE) + w.elysium.get(ALICE, HYPE);
    expect(hype).toBe(60n - inRun.plan.totalFee - outRun.plan.totalFee);
  });
});
