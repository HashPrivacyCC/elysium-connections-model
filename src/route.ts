import { ConnectionError, InsufficientBalanceError, InvalidRouteError, UnsupportedAssetError } from "./errors.js";
import type { FastTransfer } from "./fastpath.js";
import type { Domain, Tick } from "./types.js";
import { HYPE } from "./types.js";
import type { FeeSchedule, Hop, HopKind, RoutePlan } from "./plan.js";
import type { HopStatus } from "./state.js";
import type { World } from "./world.js";

export function feeScheduleOf(world: World): FeeSchedule {
  return {
    coreToEvm: world.spot.fee,
    evmToElysium: world.bridge.config.inboxFee,
    evmToElysiumFast: world.fastPath.totalFee("entry"),
    shield: world.pool.shieldFee,
    unshield: world.pool.unshieldFee,
    elysiumToEvm: world.bridge.config.outboxFee,
    elysiumToEvmFast: world.fastPath.totalFee("exit"),
    evmToCore: world.spot.fee,
  };
}

export interface Shortfall {
  domain: Domain;
  required: bigint;
  available: bigint;
}

/** Compare the HYPE a plan needs on each domain with what the account holds. */
export function fundingShortfalls(world: World, plan: RoutePlan): Shortfall[] {
  const ledgers = { hyperliquid: world.core, hyperevm: world.hyperEvm, elysium: world.elysium };
  const out: Shortfall[] = [];
  for (const domain of ["hyperliquid", "hyperevm", "elysium"] as const) {
    const required = plan.requiredHype[domain];
    const available = ledgers[domain].get(plan.account, HYPE);
    if (required > 0n && available < required) out.push({ domain, required, available });
  }
  return out;
}

export type RouteStatus = "running" | "completed" | "failed" | "refunded";
export type HopRunStatus = HopStatus | "idle";

export interface HopRun {
  readonly hop: Hop;
  status: HopRunStatus;
  ref?: string;
}

export interface RouteEvent {
  readonly tick: Tick;
  readonly hop: number;
  readonly kind: HopKind;
  readonly status: HopRunStatus;
}

const SOFT = new Set(["NOT_YET_DUE", "BRIDGE_PAUSED", "DEADLINE_PASSED"]);

/** Drives one plan against a world, one action per `advance` call, and records every status change. */
export class RouteRun {
  readonly hops: HopRun[];
  readonly events: RouteEvent[] = [];
  private cursor = 0;
  private state: RouteStatus = "running";
  private noteId: string | undefined;
  private deliveredTick: Tick | undefined;

  constructor(
    readonly world: World,
    readonly plan: RoutePlan,
  ) {
    if (plan.hops.length === 0) throw new InvalidRouteError("a route needs at least one hop");
    if (!world.bridge.supports(plan.asset) || !world.spot.supports(plan.asset)) {
      throw new UnsupportedAssetError(`${plan.asset} is not supported on every leg`);
    }
    const short = fundingShortfalls(world, plan);
    if (short.length > 0) {
      const detail = short.map((s) => `${s.domain} needs ${s.required} HYPE, holds ${s.available}`).join("; ");
      throw new InsufficientBalanceError(`route cannot start: ${detail}`);
    }
    if (plan.kind === "unshield-to-core") {
      if (plan.noteId === undefined) throw new InvalidRouteError("an unshield route needs a note id");
      const n = world.pool.note(plan.noteId);
      if (n.owner !== plan.account || n.asset !== plan.asset || n.amount !== plan.amount || n.spent) {
        throw new InvalidRouteError("the note does not match the plan");
      }
      this.noteId = plan.noteId;
    }
    this.hops = plan.hops.map((hop) => ({ hop, status: "idle" as HopRunStatus }));
  }

  get status(): RouteStatus {
    return this.state;
  }

  /** The note a shield hop created, or the note an unshield route spends. */
  get note(): string | undefined {
    return this.noteId;
  }

  /** Tick at which the value reached the end of the route. Set when the last hop is confirmed or final. */
  get deliveredAt(): Tick | undefined {
    return this.deliveredTick;
  }

  /** Where the value sits now: the destination of the last completed hop, or the source of the hop that stopped. */
  position(): Domain {
    if (this.state === "completed") return this.plan.hops[this.plan.hops.length - 1]!.to;
    const run = this.hops[Math.min(this.cursor, this.hops.length - 1)]!;
    if (this.cursor >= this.hops.length) return run.hop.to;
    return run.hop.from;
  }

  private set(run: HopRun, status: HopRunStatus, now: Tick): void {
    run.status = status;
    this.events.push({ tick: now, hop: run.hop.index, kind: run.hop.kind, status });
  }

  /** Take at most one step in each place that can move. Returns whether anything changed. */
  advance(now: Tick): boolean {
    if (this.state !== "running") return false;
    let progressed = false;

    // Hops already passed through the fast path may still be settling.
    for (let i = 0; i < Math.min(this.cursor, this.hops.length); i++) {
      const run = this.hops[i]!;
      if (run.hop.fast && run.status === "confirmed") {
        if (this.pollFast(run, now)) progressed = true;
      }
    }

    if (this.cursor < this.hops.length) {
      const run = this.hops[this.cursor]!;
      try {
        progressed = this.step(run, now) || progressed;
      } catch (err) {
        if (!(err instanceof ConnectionError)) throw err;
        if (SOFT.has(err.code)) return progressed;
        this.set(run, "failed", now);
        this.state = "failed";
        return true;
      }
      if (run.status === "refunded") {
        this.state = "refunded";
        return true;
      }
      if (run.status === "failed") {
        this.state = "failed";
        return true;
      }
      if (run.status === "finalized" || (run.hop.fast && run.status === "confirmed")) {
        this.cursor++;
        progressed = true;
        if (this.cursor === this.hops.length) this.deliveredTick = now;
      }
    }

    if (this.cursor === this.hops.length && this.hops.every((h) => h.status === "finalized" || h.status === "failed")) {
      this.state = "completed";
      progressed = true;
    }
    return progressed;
  }

  /** Advance every tick from `start`, taking every step possible per tick, until the route ends or `maxTicks` pass. */
  run(start: Tick, opts: { step?: number; maxTicks?: number } = {}): RouteStatus {
    const step = opts.step ?? 1;
    const max = opts.maxTicks ?? 1000;
    for (let now = start; now <= start + max && this.state === "running"; now += step) {
      while (this.advance(now)) {
        /* keep going within the tick */
      }
    }
    return this.state;
  }

  private step(run: HopRun, now: Tick): boolean {
    const w = this.world;
    const h = run.hop;
    const account = this.plan.account;
    if (run.status === "idle") {
      switch (h.kind) {
        case "core-to-evm":
        case "evm-to-core":
          run.ref = w.spot.submit({ account, asset: h.asset, amount: h.amount, direction: h.kind }, now).id;
          break;
        case "evm-to-elysium":
          run.ref = h.fast
            ? w.fastPath.open({ direction: "entry", user: account, recipient: account, asset: h.asset, amount: h.amount }, now).id
            : w.bridge.depositToElysium({ from: account, to: account, refundTo: account, asset: h.asset, amount: h.amount }, now).id;
          break;
        case "elysium-to-evm":
          run.ref = h.fast
            ? w.fastPath.open({ direction: "exit", user: account, recipient: account, asset: h.asset, amount: h.amount }, now).id
            : w.bridge.initiateWithdrawal({ from: account, to: account, asset: h.asset, amount: h.amount }, now).id;
          break;
        case "shield":
        case "unshield":
          break;
      }
      this.set(run, "pending", now);
      return true;
    }
    if (h.fast) return this.pollFast(run, now);
    if (run.status === "pending") return this.confirm(run, now);
    if (run.status === "confirmed") return this.finalize(run, now);
    return false;
  }

  private confirm(run: HopRun, now: Tick): boolean {
    const w = this.world;
    const h = run.hop;
    const account = this.plan.account;
    switch (h.kind) {
      case "core-to-evm":
      case "evm-to-core":
        w.spot.confirm(run.ref!, now);
        break;
      case "evm-to-elysium": {
        const m = w.bridge.getDeposit(run.ref!);
        if (now >= m.createdAt + w.bridge.config.depositExpiry) {
          w.bridge.refundDeposit(m.id, now);
          this.set(run, "refunded", now);
          return true;
        }
        w.bridge.deliverDeposit(m.id, now);
        break;
      }
      case "elysium-to-evm":
        w.bridge.confirmWithdrawal(run.ref!, now);
        break;
      case "shield":
        this.noteId = w.pool.shield({ owner: account, asset: h.asset, amount: h.amount }, now).noteId;
        break;
      case "unshield":
        w.pool.unshield({ noteId: this.noteId!, owner: account, recipient: account }, now);
        break;
    }
    this.set(run, "confirmed", now);
    return true;
  }

  private finalize(run: HopRun, now: Tick): boolean {
    const w = this.world;
    switch (run.hop.kind) {
      case "core-to-evm":
      case "evm-to-core":
        w.spot.finalize(run.ref!, now);
        break;
      case "evm-to-elysium":
        w.bridge.finalizeDeposit(run.ref!, now);
        break;
      case "elysium-to-evm":
        w.bridge.executeWithdrawal(run.ref!, now);
        break;
      case "shield":
      case "unshield":
        break;
    }
    this.set(run, "finalized", now);
    return true;
  }

  /** One poll of a fast path hop. The fast path moves it through fill, settle and refund. */
  private pollFast(run: HopRun, now: Tick): boolean {
    const fp = this.world.fastPath;
    const id = run.ref!;
    fp.pump(id, now);
    let t: FastTransfer = fp.get(id);
    if (t.status === "pending") fp.autoFill(id, now);
    t = fp.get(id);
    if (t.status === "pending" || t.status === "confirmed") {
      try {
        fp.settle(id, now);
      } catch (err) {
        if (!(err instanceof ConnectionError) || err.code !== "NOT_YET_DUE") throw err;
      }
      t = fp.get(id);
    }
    if (t.status === run.status) return false;
    if (t.status === "failed" && t.path === "fast" && this.cursor > run.hop.index) {
      // The user already holds the funds. The relayer was repaid at the source. The route is unaffected.
      this.set(run, "failed", now);
      return true;
    }
    this.set(run, t.status, now);
    return true;
  }
}
