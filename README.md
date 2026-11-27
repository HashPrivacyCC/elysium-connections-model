# elysium-connections-model

![CI](https://github.com/HashPrivacyCC/elysium-connections-model/actions/workflows/ci.yml/badge.svg)

A small reference model of how value moves between Hash Privacy on Elysium and the rest of the Hyperliquid ecosystem, following the connections described in the [Hash Privacy protocol spec](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/10-connections.md). Hash Privacy is the privacy layer of Elysium, the Kinetiq L2 for the Hyperliquid ecosystem. Elysium is built on Arbitrum Orbit, settles to HyperEVM and uses HYPE for gas, and the Hash Privacy contracts on Elysium verify zero-knowledge proofs. It has an Orbit-style canonical path between HyperEVM and Elysium, an interface for the HyperCore spot transfer leg, route planning for shield-on-arrival and for leaving the pool, and a relayer fast path with the canonical path as fallback, so the rules in the spec can be run, tested and argued about.

> **Research model. Not a working bridge. Do not use with funds.** This code holds no keys, runs no proofs, and touches no network, RPC or wallet. It models states, messages, delays and fees only. Nothing here is audited or deployed. Every delay, fee and limit is a placeholder, and the HyperCore details are marked "to be specified against the Hyperliquid docs".

## Status

Version 0.1.0, a first model. The parts are in place and tested, and the gaps are listed in [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md). The spec is a draft, so the model will move with it.

## What's in 0.1.0

- **Canonical path.** Deposits through an inbox and withdrawals through an outbox between HyperEVM and Elysium. The withdrawal challenge delay is a parameter. A replay guard lets each message be consumed once. HYPE and an ERC-20 (USDC as the example) are both supported. An expired deposit is refunded and a challenged withdrawal returns to the sender.
- **HyperCore leg.** The account-level spot transfer between HyperCore and HyperEVM, as an interface with a mock adapter. The precompile and system address details are not invented and are marked as to be specified.
- **Routes.** A planner and a runner for Hyperliquid to HyperEVM to Elysium to a shielded pool, and for the reverse. Each hop has the same state machine (pending, confirmed, finalized, refunded, failed). Fees are in HYPE and are parameters.
- **Fast path.** A relayer fronts the funds on the destination side. The canonical path settles it and is the fallback. There are fill windows, refund on failure and per-route limits.
- **Typed errors.** One class and one code per rejection. See [docs/ERRORS.md](docs/ERRORS.md).

## What this is not

- Not Orbit. There is no fraud or validity proof, no sequencer and no data availability here.
- Not a statement about how Hyperliquid moves a spot balance to HyperEVM. That is to be specified.
- Not a privacy analysis of the routes. Public legs are visible, and linkage is out of scope.
- Not a Monero connection. That is a separate atomic swap, see [xmr-swap-model](https://github.com/HashPrivacyCC/xmr-swap-model).

## Why

The connections page in the spec is prose and diagrams. Prose hides gaps, such as what a relayer is owed if the canonical message fails after a fill, or what a route should do when the bridge pauses. A small executable model makes those cases concrete and gives reviewers something to break.

## Quickstart

Node 22 or newer.

```sh
npm install
npm run typecheck
npm test
npm run build

npm run example:hyperliquid-to-shielded
npm run example:shielded-to-hyperevm
npm run example:fast-path-fallback
```

Examples compile to `dist/` with `tsc` and run with plain `node`. There are no runtime dependencies.

```ts
import { RouteRun, USDC, World, feeScheduleOf, planShieldOnArrival } from "./src/index.js";

const world = new World();
world.core.credit("alice", USDC, 1000n); // HyperCore spot balance
for (const ledger of [world.core, world.hyperEvm, world.elysium]) ledger.credit("alice", "HYPE", 10n); // fees

const plan = planShieldOnArrival({ account: "alice", asset: USDC, amount: 250n, fees: feeScheduleOf(world) });
const run = new RouteRun(world, plan);
run.run(0); // "completed", the 250 USDC is now a note in the shielded pool
```

## Terms

Taken from the spec: Elysium, HyperEVM, connection, shielded pool, note. The model adds the words **hop**, **route**, **canonical path**, **fast path**, **relayer**, **fill** and **tick**. See [docs/GLOSSARY.md](docs/GLOSSARY.md).

## Layout

| Path | Contents |
| --- | --- |
| `src/types.ts` | Asset and domain labels, abstract time, per-domain balances |
| `src/state.ts` | The hop status machine used by every leg |
| `src/replay.ts` | The replay guard |
| `src/bridge.ts` | Canonical inbox and outbox between HyperEVM and Elysium |
| `src/hypercore.ts` | Spot transfer interface, mock adapter, the unspecified details |
| `src/pool.ts` | Shielded pool port and a mock |
| `src/plan.ts` | Route planner and the fee schedule |
| `src/fastpath.ts` | Relayer fast path, fill windows, limits |
| `src/route.ts` | Route runner |
| `src/world.ts` | Wiring of all parts for tests and examples |
| `src/errors.ts` | One error class per rejection |
| `examples/` | Runnable traces |
| `test/` | Vitest suites |
| `docs/OVERVIEW.md` | What is modeled and what is not |
| `docs/ROUTES.md` | Route diagrams |
| `docs/STATE-MACHINES.md` | Statuses and what moves them |
| `docs/TRUST-MODEL.md` | Who is trusted at each hop |
| `docs/OPEN-QUESTIONS.md` | What is not decided |
| `docs/GLOSSARY.md` | The terms used in the code and the docs |
| `docs/ERRORS.md` | Every rejection code and class |

## Spec

- [10 Connections](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/10-connections.md)
- [12 Fees](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/12-fees.md)
- [Glossary](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/glossary.md)

## Open questions

- The HyperCore to HyperEVM mechanism: precompiles, system addresses, asset mapping and timing are all to be specified against the Hyperliquid docs.
- The challenge delay, deposit expiry and fill window are placeholders.
- How a new user gets the first HYPE on Elysium to pay fees, the gas bootstrap.
- Relayer selection, collateral and who bears the risk of a canonical failure after a fill.

The full list is in [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md).

## Contributing

Issues and discussion are welcome, especially ones that find a transfer the model gets wrong. Code contributions are not accepted for now. See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](SECURITY.md). Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Links

- Website: https://hashprivacy.cc
- GitHub: https://github.com/HashPrivacyCC
- Spec: https://github.com/HashPrivacyCC/protocol-spec
- Shielded pool model: https://github.com/HashPrivacyCC/shielded-pool-model
- XMR swap model: https://github.com/HashPrivacyCC/xmr-swap-model

## License

Copyright (c) 2026 Hash Privacy. All rights reserved. The source is published for reference and review only, and no permission is granted to copy, modify, distribute, sublicense or use it without prior written permission. See [LICENSE](LICENSE). The protocol spec it follows is licensed separately under CC BY 4.0. The Hash Privacy name and logo are covered separately in the brand kit.
