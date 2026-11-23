import { Balances, CanonicalBridge, DEFAULT_BRIDGE_CONFIG, type BridgeConfig } from "../src/index.js";

export const ALICE = "alice";
export const BOB = "bob";

export function makeBridge(overrides: Partial<BridgeConfig> = {}) {
  const hyperEvm = new Balances("hyperevm");
  const elysium = new Balances("elysium");
  const bridge = new CanonicalBridge({ ...DEFAULT_BRIDGE_CONFIG, ...overrides }, hyperEvm, elysium);
  return { bridge, hyperEvm, elysium };
}

/** Run a call and return the error it throws, or fail the test. */
export function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to throw");
}

import { HYPE, USDC, World, type WorldConfig } from "../src/index.js";

export const RELAYER = "relayer-1";

/** A world with one user holding USDC and HYPE on HyperCore, and HYPE gas on the other two domains. */
export function makeWorld(config: WorldConfig = {}) {
  const world = new World(config);
  world.core.credit(ALICE, USDC, 1000n);
  world.core.credit(ALICE, HYPE, 20n);
  world.hyperEvm.credit(ALICE, HYPE, 20n);
  world.elysium.credit(ALICE, HYPE, 20n);
  return world;
}

/** Give a relayer inventory on both destination sides. */
export function addRelayer(world: World, usdc = 5000n, hype = 100n, account = RELAYER) {
  world.fastPath.registerRelayer(account);
  for (const ledger of [world.hyperEvm, world.elysium]) {
    ledger.credit(account, USDC, usdc);
    ledger.credit(account, HYPE, hype);
  }
}
