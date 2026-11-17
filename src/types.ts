import { InsufficientBalanceError, InvalidAmountError } from "./errors.js";

/** An asset label. The model treats HYPE as the gas asset and USDC as an example ERC-20. */
export type AssetId = string;
export const HYPE: AssetId = "HYPE";
export const USDC: AssetId = "USDC";

/** The three places value can sit. */
export type Domain = "hyperliquid" | "hyperevm" | "elysium";

/** Abstract time. One tick is whatever unit the caller chooses. The model never reads a clock. */
export type Tick = number;

export function assertPositive(amount: bigint, what = "amount"): void {
  if (typeof amount !== "bigint" || amount <= 0n) throw new InvalidAmountError(`${what} must be a positive bigint`);
}

export function assertTick(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new InvalidAmountError(`${what} must be a non-negative integer`);
}

/** Per-domain balances keyed by account and asset. Debits never go below zero. */
export class Balances {
  private readonly map = new Map<string, bigint>();
  constructor(readonly domain: Domain) {}

  private key(account: string, asset: AssetId): string {
    return `${account}\u0000${asset}`;
  }

  get(account: string, asset: AssetId): bigint {
    return this.map.get(this.key(account, asset)) ?? 0n;
  }

  credit(account: string, asset: AssetId, amount: bigint): void {
    assertPositive(amount);
    this.map.set(this.key(account, asset), this.get(account, asset) + amount);
  }

  debit(account: string, asset: AssetId, amount: bigint): void {
    this.charge(account, [[asset, amount]]);
  }

  /** Debit several items at once. Nothing changes unless every asset total is covered. */
  charge(account: string, items: ReadonlyArray<readonly [AssetId, bigint]>): void {
    const totals = new Map<AssetId, bigint>();
    for (const [asset, amount] of items) {
      if (amount === 0n) continue;
      assertPositive(amount);
      totals.set(asset, (totals.get(asset) ?? 0n) + amount);
    }
    for (const [asset, need] of totals) {
      if (this.get(account, asset) < need) {
        throw new InsufficientBalanceError(
          `${account} holds ${this.get(account, asset)} ${asset} on ${this.domain}, needs ${need}`,
        );
      }
    }
    for (const [asset, need] of totals) this.map.set(this.key(account, asset), this.get(account, asset) - need);
  }

  transfer(from: string, to: string, asset: AssetId, amount: bigint): void {
    this.debit(from, asset, amount);
    this.credit(to, asset, amount);
  }

  /** Sum of one asset over every account. Used for conservation checks. */
  total(asset: AssetId): bigint {
    let sum = 0n;
    for (const [k, v] of this.map) if (k.endsWith(`\u0000${asset}`)) sum += v;
    return sum;
  }
}
