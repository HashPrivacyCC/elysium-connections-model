import { RouteRun, USDC, World, HYPE, feeScheduleOf, planShieldOnArrival } from "../src/index.js";

// Shield on arrival: Hyperliquid -> HyperEVM -> Elysium -> shielded pool.
// Every delay and fee here is a placeholder parameter, not a claim about a real network.
const world = new World();
world.core.credit("alice", USDC, 1000n);
world.core.credit("alice", HYPE, 10n);
world.hyperEvm.credit("alice", HYPE, 10n);
world.elysium.credit("alice", HYPE, 10n);

const plan = planShieldOnArrival({ account: "alice", asset: USDC, amount: 250n, fees: feeScheduleOf(world) });
console.log(`plan: ${plan.hops.map((h) => h.kind).join(" -> ")}`);
console.log(`total fee: ${plan.totalFee} HYPE, required HYPE:`, plan.requiredHype);

const run = new RouteRun(world, plan);
const status = run.run(0);

for (const e of run.events) console.log(`tick ${String(e.tick).padStart(3)}  hop ${e.hop} ${e.kind.padEnd(15)} ${e.status}`);
console.log(`route: ${status}`);
console.log(`note ${run.note}:`, world.pool.note(run.note!));
console.log(`HyperCore USDC left: ${world.core.get("alice", USDC)}`);
