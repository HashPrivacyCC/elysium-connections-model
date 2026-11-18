import { createHash } from "node:crypto";
import {
  BridgePausedError,
  DeadlinePassedError,
  InvalidConfigError,
  NotYetDueError,
  UnknownMessageError,
  UnsupportedAssetError,
} from "./errors.js";
import { ReplayGuard } from "./replay.js";
import { assertTransition, type HopStatus } from "./state.js";
import { assertPositive, assertTick, HYPE, type AssetId, type Balances, type Tick } from "./types.js";

/**
 * Parameters of the canonical path. Every delay is an abstract tick count chosen by the caller.
 * The defaults are placeholders for tests and examples, not claims about any real network.
 */
export interface BridgeConfig {
  supportedAssets: readonly AssetId[];
  /** Ticks before an inbox deposit may be delivered on Elysium. */
  inboxDelay: Tick;
  /** Ticks after which an undelivered deposit can only be refunded. Must exceed `inboxDelay`. */
  depositExpiry: Tick;
  /** Ticks after delivery until the parent side treats the deposit as final. */
  parentFinalityDelay: Tick;
  /** Ticks a posted withdrawal can be challenged before it can be executed on HyperEVM. */
  challengeDelay: Tick;
  /** Fee for an inbox deposit, in HYPE, paid on HyperEVM. */
  inboxFee: bigint;
  /** Fee for an outbox withdrawal, in HYPE, paid on Elysium. */
  outboxFee: bigint;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  supportedAssets: [HYPE, "USDC"],
  inboxDelay: 2,
  depositExpiry: 20,
  parentFinalityDelay: 3,
  challengeDelay: 50,
  inboxFee: 2n,
  outboxFee: 3n,
};

export const BRIDGE_ESCROW = "bridge-escrow";
export const BRIDGE_OUTBOX = "bridge-outbox";
export const BRIDGE_FEE_SINK = "bridge-fee-sink";

export interface DepositRequest {
  from: string;
  to: string;
  /** Where the escrowed amount goes if the deposit expires. Defaults to `from`. */
  refundTo?: string;
  asset: AssetId;
  amount: bigint;
}

export interface WithdrawalRequest {
  from: string;
  to: string;
  asset: AssetId;
  amount: bigint;
}

export interface DepositMessage {
  readonly kind: "deposit";
  readonly id: string;
  readonly nonce: number;
  readonly from: string;
  readonly to: string;
  readonly refundTo: string;
  readonly asset: AssetId;
  readonly amount: bigint;
  readonly fee: bigint;
  readonly status: HopStatus;
  readonly createdAt: Tick;
  readonly deliveredAt?: Tick;
  readonly finalizedAt?: Tick;
}

export interface WithdrawalMessage {
  readonly kind: "withdrawal";
  readonly id: string;
  readonly nonce: number;
  readonly from: string;
  readonly to: string;
  readonly asset: AssetId;
  readonly amount: bigint;
  readonly fee: bigint;
  readonly status: HopStatus;
  readonly createdAt: Tick;
  readonly confirmedAt?: Tick;
  readonly executedAt?: Tick;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function messageId(kind: string, nonce: number, from: string, to: string, asset: AssetId, amount: bigint): string {
  return createHash("sha256")
    .update(`hashprivacy.model.bridge|${kind}|${nonce}|${from}|${to}|${asset}|${amount}`)
    .digest("hex");
}

export function validateBridgeConfig(c: BridgeConfig): void {
  if (!c.supportedAssets.includes(HYPE)) throw new InvalidConfigError("HYPE must be a supported asset");
  assertTick(c.inboxDelay, "inboxDelay");
  assertTick(c.depositExpiry, "depositExpiry");
  assertTick(c.parentFinalityDelay, "parentFinalityDelay");
  assertTick(c.challengeDelay, "challengeDelay");
  if (c.depositExpiry <= c.inboxDelay) throw new InvalidConfigError("depositExpiry must be greater than inboxDelay");
  if (c.inboxFee < 0n || c.outboxFee < 0n) throw new InvalidConfigError("fees must not be negative");
}

/**
 * Abstract Orbit-style canonical path between HyperEVM (the parent) and Elysium (the child).
 *
 * Deposits go through an inbox: funds are escrowed on HyperEVM and credited on Elysium after a delay.
 * Withdrawals go through an outbox: funds are locked on Elysium, the withdrawal is posted, and after the
 * challenge delay it can be executed on HyperEVM. Each message can be consumed once, which the replay
 * guard enforces. Fees are charged in HYPE on the side where the message starts.
 */
export class CanonicalBridge {
  readonly config: BridgeConfig;
  private readonly deposits = new Map<string, Mutable<DepositMessage>>();
  private readonly withdrawals = new Map<string, Mutable<WithdrawalMessage>>();
  private readonly guard = new ReplayGuard();
  private nonce = 0;
  private paused = false;

  constructor(
    config: BridgeConfig,
    readonly hyperEvm: Balances,
    readonly elysium: Balances,
  ) {
    validateBridgeConfig(config);
    this.config = { ...config, supportedAssets: [...config.supportedAssets] };
  }

  supports(asset: AssetId): boolean {
    return this.config.supportedAssets.includes(asset);
  }

  pause(): void {
    this.paused = true;
  }

  unpause(): void {
    this.paused = false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private assertSupported(asset: AssetId): void {
    if (!this.supports(asset)) throw new UnsupportedAssetError(`${asset} is not supported by the bridge`);
  }

  private assertRunning(): void {
    if (this.paused) throw new BridgePausedError("the bridge is paused");
  }

  // Deposits: HyperEVM -> Elysium

  depositToElysium(req: DepositRequest, now: Tick): DepositMessage {
    assertPositive(req.amount);
    assertTick(now, "now");
    this.assertSupported(req.asset);
    const fee = this.config.inboxFee;
    this.hyperEvm.charge(req.from, [
      [req.asset, req.amount],
      [HYPE, fee],
    ]);
    this.hyperEvm.credit(BRIDGE_ESCROW, req.asset, req.amount);
    if (fee > 0n) this.hyperEvm.credit(BRIDGE_FEE_SINK, HYPE, fee);
    const nonce = this.nonce++;
    const id = messageId("deposit", nonce, req.from, req.to, req.asset, req.amount);
    const msg: Mutable<DepositMessage> = {
      kind: "deposit",
      id,
      nonce,
      from: req.from,
      to: req.to,
      refundTo: req.refundTo ?? req.from,
      asset: req.asset,
      amount: req.amount,
      fee,
      status: "pending",
      createdAt: now,
    };
    this.deposits.set(id, msg);
    return { ...msg };
  }

  private deposit(id: string): Mutable<DepositMessage> {
    const m = this.deposits.get(id);
    if (!m) throw new UnknownMessageError(`no deposit ${id.slice(0, 12)}`);
    return m;
  }

  getDeposit(id: string): DepositMessage {
    return { ...this.deposit(id) };
  }

  /** Credit the recipient on Elysium. pending -> confirmed. */
  deliverDeposit(id: string, now: Tick): DepositMessage {
    const m = this.deposit(id);
    this.guard.assertFresh(id);
    this.assertRunning();
    assertTransition(m.status, "confirmed", "deposit");
    if (now < m.createdAt + this.config.inboxDelay) {
      throw new NotYetDueError(`deposit is deliverable at tick ${m.createdAt + this.config.inboxDelay}, now ${now}`);
    }
    if (now >= m.createdAt + this.config.depositExpiry) {
      throw new DeadlinePassedError("deposit expired, it can only be refunded");
    }
    this.guard.consume(id);
    this.elysium.credit(m.to, m.asset, m.amount);
    m.status = "confirmed";
    m.deliveredAt = now;
    return { ...m };
  }

  /** The parent side treats the deposit as final. confirmed -> finalized. */
  finalizeDeposit(id: string, now: Tick): DepositMessage {
    const m = this.deposit(id);
    assertTransition(m.status, "finalized", "deposit");
    const due = (m.deliveredAt ?? 0) + this.config.parentFinalityDelay;
    if (now < due) throw new NotYetDueError(`deposit is final at tick ${due}, now ${now}`);
    m.status = "finalized";
    m.finalizedAt = now;
    return { ...m };
  }

  /** Return an undelivered, expired deposit to its refund address. The inbox fee is not returned. pending -> refunded. */
  refundDeposit(id: string, now: Tick): DepositMessage {
    const m = this.deposit(id);
    this.guard.assertFresh(id);
    assertTransition(m.status, "refunded", "deposit");
    if (now < m.createdAt + this.config.depositExpiry) {
      throw new NotYetDueError(`deposit expires at tick ${m.createdAt + this.config.depositExpiry}, now ${now}`);
    }
    this.guard.consume(id);
    this.hyperEvm.transfer(BRIDGE_ESCROW, m.refundTo, m.asset, m.amount);
    m.status = "refunded";
    return { ...m };
  }

  // Withdrawals: Elysium -> HyperEVM

  initiateWithdrawal(req: WithdrawalRequest, now: Tick): WithdrawalMessage {
    assertPositive(req.amount);
    assertTick(now, "now");
    this.assertSupported(req.asset);
    const fee = this.config.outboxFee;
    this.elysium.charge(req.from, [
      [req.asset, req.amount],
      [HYPE, fee],
    ]);
    this.elysium.credit(BRIDGE_OUTBOX, req.asset, req.amount);
    if (fee > 0n) this.elysium.credit(BRIDGE_FEE_SINK, HYPE, fee);
    const nonce = this.nonce++;
    const id = messageId("withdrawal", nonce, req.from, req.to, req.asset, req.amount);
    const msg: Mutable<WithdrawalMessage> = {
      kind: "withdrawal",
      id,
      nonce,
      from: req.from,
      to: req.to,
      asset: req.asset,
      amount: req.amount,
      fee,
      status: "pending",
      createdAt: now,
    };
    this.withdrawals.set(id, msg);
    return { ...msg };
  }

  private withdrawal(id: string): Mutable<WithdrawalMessage> {
    const m = this.withdrawals.get(id);
    if (!m) throw new UnknownMessageError(`no withdrawal ${id.slice(0, 12)}`);
    return m;
  }

  getWithdrawal(id: string): WithdrawalMessage {
    return { ...this.withdrawal(id) };
  }

  /** The withdrawal is posted and the challenge window starts. pending -> confirmed. */
  confirmWithdrawal(id: string, now: Tick): WithdrawalMessage {
    const m = this.withdrawal(id);
    assertTransition(m.status, "confirmed", "withdrawal");
    m.status = "confirmed";
    m.confirmedAt = now;
    return { ...m };
  }

  /** A successful challenge inside the window. The amount returns to the sender on Elysium. confirmed -> failed. */
  challengeWithdrawal(id: string, now: Tick): WithdrawalMessage {
    const m = this.withdrawal(id);
    assertTransition(m.status, "failed", "withdrawal");
    const closes = (m.confirmedAt ?? 0) + this.config.challengeDelay;
    if (now >= closes) throw new DeadlinePassedError(`challenge window closed at tick ${closes}`);
    this.elysium.transfer(BRIDGE_OUTBOX, m.from, m.asset, m.amount);
    m.status = "failed";
    return { ...m };
  }

  /** Release the funds on HyperEVM after the challenge delay. confirmed -> finalized. */
  executeWithdrawal(id: string, now: Tick): WithdrawalMessage {
    const m = this.withdrawal(id);
    this.guard.assertFresh(id);
    this.assertRunning();
    assertTransition(m.status, "finalized", "withdrawal");
    const due = (m.confirmedAt ?? 0) + this.config.challengeDelay;
    if (now < due) throw new NotYetDueError(`challenge window is open until tick ${due}, now ${now}`);
    this.guard.consume(id);
    this.elysium.debit(BRIDGE_OUTBOX, m.asset, m.amount);
    this.hyperEvm.transfer(BRIDGE_ESCROW, m.to, m.asset, m.amount);
    m.status = "finalized";
    m.executedAt = now;
    return { ...m };
  }

  // Accounting views

  escrowed(asset: AssetId): bigint {
    return this.hyperEvm.get(BRIDGE_ESCROW, asset);
  }

  /** Escrow minus what Elysium holds. Zero when every unit on Elysium is backed and no deposit is in flight. */
  pendingDepositAmount(asset: AssetId): bigint {
    let sum = 0n;
    for (const m of this.deposits.values()) if (m.asset === asset && m.status === "pending") sum += m.amount;
    return sum;
  }

  /**
   * Conservation check for assets that only enter Elysium through this bridge:
   * escrow on HyperEVM equals the supply on Elysium plus deposits still in flight.
   */
  isBacked(asset: AssetId): boolean {
    return this.escrowed(asset) === this.elysium.total(asset) + this.pendingDepositAmount(asset);
  }
}
