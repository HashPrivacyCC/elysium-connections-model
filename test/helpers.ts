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
