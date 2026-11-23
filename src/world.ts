import { CanonicalBridge, DEFAULT_BRIDGE_CONFIG, type BridgeConfig } from "./bridge.js";
import { DEFAULT_FASTPATH_CONFIG, FastPath, type FastPathConfig } from "./fastpath.js";
import { DEFAULT_SPOT_CONFIG, MockSpotAdapter, type MockSpotConfig } from "./hypercore.js";
import { MockShieldedPool } from "./pool.js";
import { Balances } from "./types.js";

export interface WorldConfig {
  bridge?: Partial<BridgeConfig>;
  spot?: Partial<MockSpotConfig>;
  fastPath?: Partial<FastPathConfig>;
  shieldFee?: bigint;
  unshieldFee?: bigint;
}

/** Everything the routes run against: three ledgers, the canonical bridge, the spot leg, the pool and the fast path. */
export class World {
  readonly core = new Balances("hyperliquid");
  readonly hyperEvm = new Balances("hyperevm");
  readonly elysium = new Balances("elysium");
  readonly bridge: CanonicalBridge;
  readonly spot: MockSpotAdapter;
  readonly pool: MockShieldedPool;
  readonly fastPath: FastPath;

  constructor(config: WorldConfig = {}) {
    this.bridge = new CanonicalBridge({ ...DEFAULT_BRIDGE_CONFIG, ...config.bridge }, this.hyperEvm, this.elysium);
    this.spot = new MockSpotAdapter({ ...DEFAULT_SPOT_CONFIG, ...config.spot }, this.core, this.hyperEvm);
    this.pool = new MockShieldedPool(this.elysium, config.shieldFee ?? 1n, config.unshieldFee ?? 1n);
    this.fastPath = new FastPath({ ...DEFAULT_FASTPATH_CONFIG, ...config.fastPath }, this.bridge);
  }
}
