import { InvalidRouteError } from "./errors.js";
import { assertPositive, HYPE, type AssetId, type Domain } from "./types.js";

export type HopKind = "core-to-evm" | "evm-to-elysium" | "shield" | "unshield" | "elysium-to-evm" | "evm-to-core";
export type RouteKind = "shield-on-arrival" | "unshield-to-core";
export type BridgeMode = "canonical" | "fast";

/** Fees in HYPE per hop. Each is a parameter, read from the components or set by hand. */
export interface FeeSchedule {
  coreToEvm: bigint;
  evmToElysium: bigint;
  /** The same hop through the fast path: canonical fee plus relayer fee. */
  evmToElysiumFast: bigint;
  shield: bigint;
  unshield: bigint;
  elysiumToEvm: bigint;
  elysiumToEvmFast: bigint;
  evmToCore: bigint;
}

export interface Hop {
  readonly index: number;
  readonly kind: HopKind;
  readonly from: Domain;
  readonly to: Domain;
  readonly asset: AssetId;
  readonly amount: bigint;
  /** Fee in HYPE, charged on `from`. */
  readonly fee: bigint;
  /** True when this hop goes through the fast path. */
  readonly fast: boolean;
}

export interface RoutePlan {
  readonly kind: RouteKind;
  readonly account: string;
  readonly asset: AssetId;
  readonly amount: bigint;
  readonly mode: BridgeMode;
  readonly hops: readonly Hop[];
  /** Sum of the hop fees, in HYPE. */
  readonly totalFee: bigint;
  /** HYPE that must already be held on each domain, on top of any HYPE that arrives, to pay that domain's hop fees. */
  readonly requiredHype: Readonly<Record<Domain, bigint>>;
  readonly noteId?: string;
}

interface HopSpec {
  kind: HopKind;
  from: Domain;
  to: Domain;
}

function build(
  kind: RouteKind,
  input: { account: string; asset: AssetId; amount: bigint; fees: FeeSchedule; mode?: BridgeMode },
  specs: HopSpec[],
  noteId?: string,
): RoutePlan {
  assertPositive(input.amount);
  if (input.account.length === 0) throw new InvalidRouteError("account must not be empty");
  if (input.asset.length === 0) throw new InvalidRouteError("asset must not be empty");
  const mode = input.mode ?? "canonical";
  const f = input.fees;
  const feeFor = (k: HopKind): bigint => {
    switch (k) {
      case "core-to-evm":
        return f.coreToEvm;
      case "evm-to-elysium":
        return mode === "fast" ? f.evmToElysiumFast : f.evmToElysium;
      case "shield":
        return f.shield;
      case "unshield":
        return f.unshield;
      case "elysium-to-evm":
        return mode === "fast" ? f.elysiumToEvmFast : f.elysiumToEvm;
      case "evm-to-core":
        return f.evmToCore;
    }
  };
  const hops: Hop[] = specs.map((s, index) => ({
    index,
    kind: s.kind,
    from: s.from,
    to: s.to,
    asset: input.asset,
    amount: input.amount,
    fee: feeFor(s.kind),
    fast: mode === "fast" && (s.kind === "evm-to-elysium" || s.kind === "elysium-to-evm"),
  }));
  const required: Record<Domain, bigint> = { hyperliquid: 0n, hyperevm: 0n, elysium: 0n };
  let totalFee = 0n;
  for (const h of hops) {
    required[h.from] += h.fee;
    totalFee += h.fee;
  }
  const first = hops[0];
  if (kind === "shield-on-arrival" && input.asset === HYPE && first) required[first.from] += input.amount;
  const plan: RoutePlan = { kind, account: input.account, asset: input.asset, amount: input.amount, mode, hops, totalFee, requiredHype: required };
  return noteId === undefined ? plan : { ...plan, noteId };
}

/**
 * Hyperliquid -> HyperEVM -> Elysium -> shielded pool. `from: "hyperevm"` skips the first hop for
 * a user whose funds are already on HyperEVM.
 */
export function planShieldOnArrival(input: {
  account: string;
  asset: AssetId;
  amount: bigint;
  fees: FeeSchedule;
  mode?: BridgeMode;
  from?: "hyperliquid" | "hyperevm";
}): RoutePlan {
  const specs: HopSpec[] = [
    { kind: "core-to-evm", from: "hyperliquid", to: "hyperevm" },
    { kind: "evm-to-elysium", from: "hyperevm", to: "elysium" },
    { kind: "shield", from: "elysium", to: "elysium" },
  ];
  return build("shield-on-arrival", input, input.from === "hyperevm" ? specs.slice(1) : specs);
}

/**
 * Shielded pool -> Elysium -> HyperEVM -> Hyperliquid. `to: "hyperevm"` stops before the last hop.
 * The note must already exist, so its id is part of the plan.
 */
export function planUnshieldToCore(input: {
  account: string;
  asset: AssetId;
  amount: bigint;
  noteId: string;
  fees: FeeSchedule;
  mode?: BridgeMode;
  to?: "hyperliquid" | "hyperevm";
}): RoutePlan {
  const specs: HopSpec[] = [
    { kind: "unshield", from: "elysium", to: "elysium" },
    { kind: "elysium-to-evm", from: "elysium", to: "hyperevm" },
    { kind: "evm-to-core", from: "hyperevm", to: "hyperliquid" },
  ];
  return build("unshield-to-core", input, input.to === "hyperevm" ? specs.slice(0, 2) : specs, input.noteId);
}

