import { createHash } from "node:crypto";
import {
  ConnectionError,
  DeadlinePassedError,
  InsufficientLiquidityError,
  InvalidConfigError,
  InvalidTransitionError,
  LimitExceededError,
  NotYetDueError,
  UnknownRelayerError,
  UnknownTransferError,
  UnsupportedAssetError,
} from "./errors.js";
import type { CanonicalBridge, DepositMessage, WithdrawalMessage } from "./bridge.js";
import { assertTransition, type HopStatus } from "./state.js";
import { assertPositive, assertTick, HYPE, type AssetId, type Balances, type Tick } from "./types.js";

/** entry: HyperEVM to Elysium. exit: Elysium to HyperEVM. */
export type FastDirection = "entry" | "exit";

export interface RouteLimit {
  /** Smallest transfer accepted. */
  min: bigint;
  /** Largest single transfer. */
  maxPerTransfer: bigint;
  /** Largest sum of transfers that are pending or confirmed (not yet settled). */
  maxOutstanding: bigint;
}

export interface FastPathConfig {
  /** Ticks after opening during which a relayer may still front the funds. */
  fillWindow: Tick;
  /** Fee in HYPE the user pays the relayer. Refunded to the user if no relayer fills. */
  relayerFee: bigint;
}

export const DEFAULT_FASTPATH_CONFIG: FastPathConfig = { fillWindow: 10, relayerFee: 2n };

export const FASTPATH_ESCROW = "fast-path-escrow";
export const FASTPATH_ROUTER = "fast-path-router";

export interface OpenRequest {
  direction: FastDirection;
  user: string;
  recipient: string;
  asset: AssetId;
  amount: bigint;
}

/**
 * pending:   opened, canonical message in flight, nobody has fronted yet
 * confirmed: the recipient has the funds, by a relayer fill or by the canonical path
 * finalized: the canonical message settled, and the relayer (if any) was repaid
 * refunded:  no relayer filled and the canonical message failed, the user got the funds back at the source
 * failed:    a relayer filled and the canonical message failed, the relayer was repaid at the source instead
 */
export interface FastTransfer extends OpenRequest {
  readonly id: string;
  readonly status: HopStatus;
  readonly canonicalId: string;
  readonly relayerFee: bigint;
  readonly openedAt: Tick;
  readonly fillDeadline: Tick;
  readonly relayer?: string;
  /** "fast" when a relayer filled, "canonical" when the canonical path delivered. Known once confirmed. */
  readonly path?: "fast" | "canonical";
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const SOFT_CODES = new Set(["NOT_YET_DUE", "BRIDGE_PAUSED", "DEADLINE_PASSED"]);

/** Run a step that may legitimately not be possible yet. Returns whether it ran. */
function attempt(step: () => unknown): boolean {
  try {
    step();
    return true;
  } catch (err) {
    if (err instanceof ConnectionError && SOFT_CODES.has(err.code)) return false;
    throw err;
  }
}

/**
 * A relayer fronts the funds on the destination side. The canonical path is the fallback and the
 * settlement. The user funds an escrow on the source side. The escrow starts the canonical message
 * with a router account on the destination as the recipient. At settlement the router pays the
 * relayer if one filled, or the recipient if none did.
 */
export class FastPath {
  readonly config: FastPathConfig;
  private readonly transfers = new Map<string, Mutable<FastTransfer>>();
  private readonly limits = new Map<string, RouteLimit>();
  private readonly relayers: string[] = [];
  private nonce = 0;

  constructor(
    config: FastPathConfig,
    readonly bridge: CanonicalBridge,
  ) {
    assertTick(config.fillWindow, "fillWindow");
    if (config.relayerFee < 0n) throw new InvalidConfigError("relayerFee must not be negative");
    this.config = { ...config };
  }

  private domains(direction: FastDirection): { source: Balances; dest: Balances } {
    return direction === "entry"
      ? { source: this.bridge.hyperEvm, dest: this.bridge.elysium }
      : { source: this.bridge.elysium, dest: this.bridge.hyperEvm };
  }

  private static limitKey(direction: FastDirection, asset: AssetId): string {
    return `${direction}\u0000${asset}`;
  }

  setLimit(direction: FastDirection, asset: AssetId, limit: RouteLimit): void {
    if (limit.min < 0n || limit.maxPerTransfer <= 0n || limit.maxOutstanding <= 0n) {
      throw new InvalidConfigError("limits must be positive, and min must not be negative");
    }
    if (limit.min > limit.maxPerTransfer) throw new InvalidConfigError("min must not exceed maxPerTransfer");
    if (limit.maxPerTransfer > limit.maxOutstanding) throw new InvalidConfigError("maxPerTransfer must not exceed maxOutstanding");
    this.limits.set(FastPath.limitKey(direction, asset), { ...limit });
  }

  getLimit(direction: FastDirection, asset: AssetId): RouteLimit | undefined {
    const l = this.limits.get(FastPath.limitKey(direction, asset));
    return l ? { ...l } : undefined;
  }

  registerRelayer(account: string): void {
    if (!this.relayers.includes(account)) this.relayers.push(account);
  }

  /** Sum of amounts that are pending or confirmed on one route. */
  outstanding(direction: FastDirection, asset: AssetId): bigint {
    let sum = 0n;
    for (const t of this.transfers.values()) {
      if (t.direction === direction && t.asset === asset && (t.status === "pending" || t.status === "confirmed")) sum += t.amount;
    }
    return sum;
  }

  private transfer(id: string): Mutable<FastTransfer> {
    const t = this.transfers.get(id);
    if (!t) throw new UnknownTransferError(`no fast transfer ${id.slice(0, 12)}`);
    return t;
  }

  get(id: string): FastTransfer {
    return { ...this.transfer(id) };
  }

  /** Fee in HYPE the user pays in total at the source: canonical fee plus relayer fee. */
  totalFee(direction: FastDirection): bigint {
    const canonical = direction === "entry" ? this.bridge.config.inboxFee : this.bridge.config.outboxFee;
    return canonical + this.config.relayerFee;
  }

  open(req: OpenRequest, now: Tick): FastTransfer {
    assertPositive(req.amount);
    assertTick(now, "now");
    if (!this.bridge.supports(req.asset)) throw new UnsupportedAssetError(`${req.asset} is not supported`);
    const limit = this.limits.get(FastPath.limitKey(req.direction, req.asset));
    if (limit) {
      if (req.amount < limit.min) throw new LimitExceededError("min", `amount ${req.amount} is below the minimum ${limit.min}`);
      if (req.amount > limit.maxPerTransfer) {
        throw new LimitExceededError("per-transfer", `amount ${req.amount} exceeds the per-transfer limit ${limit.maxPerTransfer}`);
      }
      if (this.outstanding(req.direction, req.asset) + req.amount > limit.maxOutstanding) {
        throw new LimitExceededError("outstanding", `outstanding would exceed ${limit.maxOutstanding}`);
      }
    }
    const { source } = this.domains(req.direction);
    const fee = this.totalFee(req.direction);
    source.charge(req.user, [
      [req.asset, req.amount],
      [HYPE, fee],
    ]);
    source.credit(FASTPATH_ESCROW, req.asset, req.amount);
    if (fee > 0n) source.credit(FASTPATH_ESCROW, HYPE, fee);
    const canonicalId =
      req.direction === "entry"
        ? this.bridge.depositToElysium({ from: FASTPATH_ESCROW, to: FASTPATH_ROUTER, refundTo: FASTPATH_ESCROW, asset: req.asset, amount: req.amount }, now).id
        : this.bridge.initiateWithdrawal({ from: FASTPATH_ESCROW, to: FASTPATH_ROUTER, asset: req.asset, amount: req.amount }, now).id;
    const nonce = this.nonce++;
    const id = createHash("sha256")
      .update(`hashprivacy.model.fastpath|${nonce}|${req.direction}|${req.user}|${req.recipient}|${req.asset}|${req.amount}`)
      .digest("hex");
    const t: Mutable<FastTransfer> = {
      ...req,
      id,
      status: "pending",
      canonicalId,
      relayerFee: this.config.relayerFee,
      openedAt: now,
      fillDeadline: now + this.config.fillWindow,
    };
    this.transfers.set(id, t);
    return { ...t };
  }

  private canonicalStatus(t: FastTransfer): HopStatus {
    return t.direction === "entry" ? this.bridge.getDeposit(t.canonicalId).status : this.bridge.getWithdrawal(t.canonicalId).status;
  }

  /** The relayer pays the recipient on the destination from its own balance. pending -> confirmed. */
  fill(id: string, relayer: string, now: Tick): FastTransfer {
    const t = this.transfer(id);
    if (!this.relayers.includes(relayer)) throw new UnknownRelayerError(`${relayer} is not a registered relayer`);
    assertTransition(t.status, "confirmed", "fast transfer");
    const canonical = this.canonicalStatus(t);
    if (canonical === "failed" || canonical === "refunded") {
      throw new InvalidTransitionError("the canonical message has already failed, nothing to front");
    }
    if (now > t.fillDeadline) throw new DeadlinePassedError(`fill window closed at tick ${t.fillDeadline}`);
    const { dest } = this.domains(t.direction);
    if (dest.get(relayer, t.asset) < t.amount) {
      throw new InsufficientLiquidityError(`${relayer} holds ${dest.get(relayer, t.asset)} ${t.asset} on ${dest.domain}, needs ${t.amount}`);
    }
    dest.transfer(relayer, t.recipient, t.asset, t.amount);
    t.status = "confirmed";
    t.relayer = relayer;
    t.path = "fast";
    return { ...t };
  }

  /** Try each registered relayer in order. Returns whether one filled. */
  autoFill(id: string, now: Tick): boolean {
    for (const relayer of this.relayers) {
      try {
        this.fill(id, relayer, now);
        return true;
      } catch (err) {
        if (err instanceof InsufficientLiquidityError) continue;
        if (err instanceof DeadlinePassedError || err instanceof InvalidTransitionError) return false;
        throw err;
      }
    }
    return false;
  }

  /**
   * Advance the canonical message as far as the delays allow. In a real system anyone can relay
   * these steps. Steps that are not due yet are skipped.
   */
  pump(id: string, now: Tick): void {
    const t = this.transfer(id);
    const b = this.bridge;
    if (t.direction === "exit") {
      const m: WithdrawalMessage = b.getWithdrawal(t.canonicalId);
      if (m.status === "pending") b.confirmWithdrawal(m.id, now);
      if (b.getWithdrawal(m.id).status === "confirmed") attempt(() => b.executeWithdrawal(m.id, now));
      return;
    }
    const m: DepositMessage = b.getDeposit(t.canonicalId);
    const expired = now >= m.createdAt + b.config.depositExpiry;
    if (m.status === "pending") {
      if (expired) attempt(() => b.refundDeposit(m.id, now));
      else attempt(() => b.deliverDeposit(m.id, now));
    }
    if (b.getDeposit(m.id).status === "confirmed") attempt(() => b.finalizeDeposit(m.id, now));
  }

  /**
   * Close the books once the canonical message is final or has failed.
   * Canonical finalized: the router pays the relayer, or the recipient if nobody filled.
   * Canonical failed or refunded: the escrow pays the relayer, or refunds the user if nobody filled.
   */
  settle(id: string, now: Tick): FastTransfer {
    const t = this.transfer(id);
    void now;
    const { source, dest } = this.domains(t.direction);
    const canonical = this.canonicalStatus(t);
    if (canonical === "pending" || canonical === "confirmed") {
      throw new NotYetDueError("the canonical message has not settled yet");
    }
    if (canonical === "finalized") {
      assertTransition(t.status, t.status === "pending" ? "confirmed" : "finalized", "fast transfer");
      if (t.status === "confirmed" && t.relayer) {
        dest.transfer(FASTPATH_ROUTER, t.relayer, t.asset, t.amount);
        if (t.relayerFee > 0n) source.transfer(FASTPATH_ESCROW, t.relayer, HYPE, t.relayerFee);
      } else {
        dest.transfer(FASTPATH_ROUTER, t.recipient, t.asset, t.amount);
        t.status = "confirmed";
        t.path = "canonical";
        if (t.relayerFee > 0n) source.transfer(FASTPATH_ESCROW, t.user, HYPE, t.relayerFee);
      }
      assertTransition(t.status, "finalized", "fast transfer");
      t.status = "finalized";
      return { ...t };
    }
    // The canonical message failed or was refunded, and the amount is back in the escrow on the source side.
    if (t.status === "confirmed" && t.relayer) {
      assertTransition(t.status, "failed", "fast transfer");
      source.transfer(FASTPATH_ESCROW, t.relayer, t.asset, t.amount);
      if (t.relayerFee > 0n) source.transfer(FASTPATH_ESCROW, t.relayer, HYPE, t.relayerFee);
      t.status = "failed";
    } else {
      assertTransition(t.status, "refunded", "fast transfer");
      source.transfer(FASTPATH_ESCROW, t.user, t.asset, t.amount);
      if (t.relayerFee > 0n) source.transfer(FASTPATH_ESCROW, t.user, HYPE, t.relayerFee);
      t.status = "refunded";
    }
    return { ...t };
  }
}
