import { RouteRun, USDC, World, HYPE, feeScheduleOf, planUnshieldToCore } from "../src/index.js";

// Unshield and leave: shielded pool -> Elysium -> HyperEVM (-> Hyperliquid).
// The exit waits for the challenge delay, which is a parameter of the model.
const world = new World({ bridge: { challengeDelay: 40 } });
world.elysium.credit("alice", USDC, 300n);
world.elysium.credit("alice", HYPE, 10n);
world.hyperEvm.credit("alice", HYPE, 10n);
world.hyperEvm.credit("bridge-escrow", USDC, 300n); // backs the wrapped balance on Elysium

const { noteId } = world.pool.shield({ owner: "alice", asset: USDC, amount: 300n }, 0);

const plan = planUnshieldToCore({ account: "alice", asset: USDC, amount: 300n, noteId, fees: feeScheduleOf(world), to: "hyperevm" });
console.log(`plan: ${plan.hops.map((h) => h.kind).join(" -> ")}`);

const run = new RouteRun(world, plan);
console.log(`route: ${run.run(0)}`);
for (const e of run.events) console.log(`tick ${String(e.tick).padStart(3)}  hop ${e.hop} ${e.kind.padEnd(15)} ${e.status}`);
console.log(`HyperEVM USDC: ${world.hyperEvm.get("alice", USDC)}`);
console.log(`bridge escrow USDC: ${world.bridge.escrowed(USDC)}`);
