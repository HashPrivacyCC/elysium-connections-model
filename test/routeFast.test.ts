import { describe, expect, it } from "vitest";
import { RouteRun, USDC, feeScheduleOf, planShieldOnArrival, planUnshieldToCore } from "../src/index.js";
import { ALICE, RELAYER, addRelayer, makeWorld } from "./helpers.js";

function exitWorld(config = {}) {
  const w = makeWorld({ bridge: { challengeDelay: 30 }, ...config });
  w.elysium.credit(ALICE, USDC, 200n);
  w.hyperEvm.credit("bridge-escrow", USDC, 200n);
  addRelayer(w);
  return w;
}

describe("routes with the fast path", () => {
  it("unshield route lets the next hop start before the challenge delay has passed", () => {
    const w = exitWorld();
    const { noteId } = w.pool.shield({ owner: ALICE, asset: USDC, amount: 100n }, 0);
    const plan = planUnshieldToCore({ account: ALICE, asset: USDC, amount: 100n, noteId, fees: feeScheduleOf(w), mode: "fast" });
    const run = new RouteRun(w, plan);
    expect(run.run(0)).toBe("completed");
    const delivered = run.deliveredAt!;
    const settled = run.events.filter((e) => e.hop === 1 && e.status === "finalized")[0]!;
    expect(delivered).toBeLessThan(settled.tick);
    expect(settled.tick).toBeGreaterThanOrEqual(30);
    expect(w.core.get(ALICE, USDC)).toBe(1100n);
  });

  it("the same route without a relayer waits for the canonical path and still completes", () => {
    const w = makeWorld({ bridge: { challengeDelay: 30 } });
    w.elysium.credit(ALICE, USDC, 200n);
    w.hyperEvm.credit("bridge-escrow", USDC, 200n);
    w.fastPath.registerRelayer(RELAYER);
    const { noteId } = w.pool.shield({ owner: ALICE, asset: USDC, amount: 100n }, 0);
    const plan = planUnshieldToCore({ account: ALICE, asset: USDC, amount: 100n, noteId, fees: feeScheduleOf(w), mode: "fast" });
    const run = new RouteRun(w, plan);
    expect(run.run(0)).toBe("completed");
    expect(run.deliveredAt!).toBeGreaterThanOrEqual(30);
    expect(w.core.get(ALICE, USDC)).toBe(1100n);
    expect(w.fastPath.get(run.hops[1]!.ref!).path).toBe("canonical");
  });

  it("falls back to the canonical path when the relayer lacks inventory", () => {
    const w = exitWorld();
    w.hyperEvm.debit(RELAYER, USDC, 5000n);
    const { noteId } = w.pool.shield({ owner: ALICE, asset: USDC, amount: 100n }, 0);
    const run = new RouteRun(w, planUnshieldToCore({ account: ALICE, asset: USDC, amount: 100n, noteId, fees: feeScheduleOf(w), mode: "fast" }));
    expect(run.run(0)).toBe("completed");
    expect(w.fastPath.get(run.hops[1]!.ref!).path).toBe("canonical");
    expect(w.hyperEvm.get(RELAYER, USDC)).toBe(0n);
  });

  it("shield-on-arrival with a relayer pays the shield hop before the deposit is final", () => {
    const w = makeWorld({ bridge: { inboxDelay: 8, depositExpiry: 40 } });
    addRelayer(w);
    const run = new RouteRun(w, planShieldOnArrival({ account: ALICE, asset: USDC, amount: 100n, fees: feeScheduleOf(w), mode: "fast" }));
    expect(run.run(0)).toBe("completed");
    const shield = run.events.find((e) => e.hop === 2 && e.status === "confirmed")!;
    const depositFinal = run.events.find((e) => e.hop === 1 && e.status === "finalized")!;
    expect(shield.tick).toBeLessThan(depositFinal.tick);
    expect(w.pool.shieldedTotal(USDC)).toBe(100n);
    expect(w.elysium.get(RELAYER, USDC)).toBe(5000n);
  });

  it("a challenged exit after a relayer fill does not fail the route", () => {
    const w = exitWorld();
    const { noteId } = w.pool.shield({ owner: ALICE, asset: USDC, amount: 100n }, 0);
    const run = new RouteRun(w, planUnshieldToCore({ account: ALICE, asset: USDC, amount: 100n, noteId, fees: feeScheduleOf(w), mode: "fast" }));
    run.run(0, { maxTicks: 6 });
    expect(run.hops[1]!.status).toBe("confirmed");
    const canonicalId = w.fastPath.get(run.hops[1]!.ref!).canonicalId;
    w.bridge.challengeWithdrawal(canonicalId, 7);
    expect(run.run(7)).toBe("completed");
    expect(run.hops[1]!.status).toBe("failed");
    expect(w.core.get(ALICE, USDC)).toBe(1100n);
    expect(w.elysium.get(RELAYER, USDC)).toBe(5000n + 100n);
  });
});
