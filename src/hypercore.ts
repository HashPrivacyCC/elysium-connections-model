import { createHash } from "node:crypto";
import {
  InvalidConfigError,
  NotYetDueError,
  SpotTransferFailedError,
  UnknownTransferError,
  UnsupportedAssetError,
} from "./errors.js";
import { assertTransition, type HopStatus } from "./state.js";
import { assertPositive, assertTick, HYPE, type AssetId, type Balances, type Tick } from "./types.js";

/**
 * What is not specified here. The real mechanism for moving a spot balance between HyperCore and
 * HyperEVM, including any precompile, system address, token index mapping, decimals handling and
 * minimum amounts, is to be specified against the Hyperliquid docs. The model invents none of it.
 */
export const HYPERCORE_UNSPECIFIED = {
  precompileInterface: "to be specified against the Hyperliquid docs",
  systemAddresses: "to be specified against the Hyperliquid docs",
  tokenIdMapping: "to be specified against the Hyperliquid docs",
  decimalsAndMinimums: "to be specified against the Hyperliquid docs",
  settlementTiming: "to be specified against the Hyperliquid docs",
} as const;

export type SpotDirection = "core-to-evm" | "evm-to-core";

/** An account-level move of one asset between a HyperCore spot balance and the same account's HyperEVM balance. */
export interface SpotTransferRequest {
  account: string;
  asset: AssetId;
  amount: bigint;
  direction: SpotDirection;
}

export interface SpotTransfer extends SpotTransferRequest {
  readonly id: string;
  readonly fee: bigint;
  readonly status: HopStatus;
  readonly createdAt: Tick;
  readonly confirmedAt?: Tick;
}

/** The leg between HyperCore and HyperEVM, as an interface. The mock below stands in for the real mechanism. */
export interface SpotTransferAdapter {
  /** Fee in HYPE, charged on the source side. */
  readonly fee: bigint;
  supports(asset: AssetId): boolean;
  /** Hold the amount and the fee at the source. Status pending. */
  submit(req: SpotTransferRequest, now: Tick): SpotTransfer;
  /** Credit the destination. pending -> confirmed. */
  confirm(id: string, now: Tick): SpotTransfer;
  /** confirmed -> finalized. */
  finalize(id: string, now: Tick): SpotTransfer;
  /** The transfer was rejected. The amount returns to the source, the fee is kept. pending -> failed. */
  fail(id: string): SpotTransfer;
  get(id: string): SpotTransfer;
}

export interface MockSpotConfig {
  supportedAssets: readonly AssetId[];
  /** Ticks between submit and confirm. */
  settleDelay: Tick;
  /** Ticks between confirm and finalize. */
  finalityDelay: Tick;
  /** Fee in HYPE, charged on the source side. */
  fee: bigint;
}

export const DEFAULT_SPOT_CONFIG: MockSpotConfig = {
  supportedAssets: [HYPE, "USDC"],
  settleDelay: 1,
  finalityDelay: 1,
  fee: 1n,
};

export const SPOT_HOLD = "spot-transfer-hold";
export const SPOT_FEE_SINK = "spot-fee-sink";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** In-memory adapter. `core` is the HyperCore spot ledger, `evm` is the HyperEVM ledger. */
export class MockSpotAdapter implements SpotTransferAdapter {
  readonly config: MockSpotConfig;
  private readonly transfers = new Map<string, Mutable<SpotTransfer>>();
  private nonce = 0;
  private rejectNext = false;

  constructor(
    config: MockSpotConfig,
    readonly core: Balances,
    readonly evm: Balances,
  ) {
    if (!config.supportedAssets.includes(HYPE)) throw new InvalidConfigError("HYPE must be a supported asset");
    assertTick(config.settleDelay, "settleDelay");
    assertTick(config.finalityDelay, "finalityDelay");
    if (config.fee < 0n) throw new InvalidConfigError("fee must not be negative");
    this.config = { ...config, supportedAssets: [...config.supportedAssets] };
  }

  get fee(): bigint {
    return this.config.fee;
  }

  supports(asset: AssetId): boolean {
    return this.config.supportedAssets.includes(asset);
  }

  /** Make the next `confirm` call fail the transfer instead, to model a rejection by the other side. */
  rejectNextConfirm(): void {
    this.rejectNext = true;
  }

  private source(direction: SpotDirection): Balances {
    return direction === "core-to-evm" ? this.core : this.evm;
  }

  private destination(direction: SpotDirection): Balances {
    return direction === "core-to-evm" ? this.evm : this.core;
  }

  submit(req: SpotTransferRequest, now: Tick): SpotTransfer {
    assertPositive(req.amount);
    assertTick(now, "now");
    if (!this.supports(req.asset)) throw new UnsupportedAssetError(`${req.asset} is not supported by the spot adapter`);
    const src = this.source(req.direction);
    src.charge(req.account, [
      [req.asset, req.amount],
      [HYPE, this.config.fee],
    ]);
    src.credit(SPOT_HOLD, req.asset, req.amount);
    if (this.config.fee > 0n) src.credit(SPOT_FEE_SINK, HYPE, this.config.fee);
    const nonce = this.nonce++;
    const id = createHash("sha256")
      .update(`hashprivacy.model.spot|${nonce}|${req.direction}|${req.account}|${req.asset}|${req.amount}`)
      .digest("hex");
    const t: Mutable<SpotTransfer> = { ...req, id, fee: this.config.fee, status: "pending", createdAt: now };
    this.transfers.set(id, t);
    return { ...t };
  }

  private transfer(id: string): Mutable<SpotTransfer> {
    const t = this.transfers.get(id);
    if (!t) throw new UnknownTransferError(`no spot transfer ${id.slice(0, 12)}`);
    return t;
  }

  get(id: string): SpotTransfer {
    return { ...this.transfer(id) };
  }

  confirm(id: string, now: Tick): SpotTransfer {
    const t = this.transfer(id);
    assertTransition(t.status, "confirmed", "spot transfer");
    const due = t.createdAt + this.config.settleDelay;
    if (now < due) throw new NotYetDueError(`spot transfer settles at tick ${due}, now ${now}`);
    if (this.rejectNext) {
      this.rejectNext = false;
      this.fail(id);
      throw new SpotTransferFailedError("the destination side rejected the transfer");
    }
    this.source(t.direction).debit(SPOT_HOLD, t.asset, t.amount);
    this.destination(t.direction).credit(t.account, t.asset, t.amount);
    t.status = "confirmed";
    t.confirmedAt = now;
    return { ...t };
  }

  finalize(id: string, now: Tick): SpotTransfer {
    const t = this.transfer(id);
    assertTransition(t.status, "finalized", "spot transfer");
    const due = (t.confirmedAt ?? 0) + this.config.finalityDelay;
    if (now < due) throw new NotYetDueError(`spot transfer is final at tick ${due}, now ${now}`);
    t.status = "finalized";
    return { ...t };
  }

  fail(id: string): SpotTransfer {
    const t = this.transfer(id);
    assertTransition(t.status, "failed", "spot transfer");
    this.source(t.direction).transfer(SPOT_HOLD, t.account, t.asset, t.amount);
    t.status = "failed";
    return { ...t };
  }
}
