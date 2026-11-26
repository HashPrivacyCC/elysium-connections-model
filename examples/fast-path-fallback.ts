import { RouteRun, USDC, World, HYPE, feeScheduleOf, planUnshieldToCore } from "../src/index.js";

// The same exit twice. With a relayer inventory the user is paid on HyperEVM within a few ticks.
// Without one the canonical path delivers after the challenge delay. Either way the user is paid once.
function exitRoute(withRelayer: boolean): void {
  const world = new World({ bridge: { challengeDelay: 40 } });
  world.elysium.credit("alice", USDC, 100n);
  world.elysium.credit("alice", HYPE, 10n);
  world.hyperEvm.credit("alice", HYPE, 10n);
  world.core.credit("alice", HYPE, 10n);
  world.hyperEvm.credit("bridge-escrow", USDC, 100n);
  world.fastPath.setLimit("exit", USDC, { min: 1n, maxPerTransfer: 500n, maxOutstanding: 1000n });
  world.fastPath.registerRelayer("relayer-1");
  if (withRelayer) world.hyperEvm.credit("relayer-1", USDC, 1000n);

  const { noteId } = world.pool.shield({ owner: "alice", asset: USDC, amount: 100n }, 0);
  const plan = planUnshieldToCore({ account: "alice", asset: USDC, amount: 100n, noteId, fees: feeScheduleOf(world), mode: "fast" });
  const run = new RouteRun(world, plan);
  run.run(0);

  const exitHop = run.hops[1]!;
  const transfer = world.fastPath.get(exitHop.ref!);
  console.log(`${withRelayer ? "relayer present" : "no relayer"}:`);
  console.log(`  path: ${transfer.path}, route ${run.status}, value delivered at tick ${run.deliveredAt}`);
  console.log(`  HyperCore USDC: ${world.core.get("alice", USDC)}`);
}

exitRoute(true);
exitRoute(false);
