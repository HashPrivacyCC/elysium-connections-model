# Overview

> Research model. Not a working bridge. Every delay, fee and limit is an illustrative placeholder.

## What this models

Hash Privacy is the privacy layer of Elysium, the Kinetiq L2 for the Hyperliquid ecosystem. Elysium is built on Arbitrum Orbit, settles to HyperEVM and uses HYPE for gas. The [spec](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/10-connections.md) says Hash Privacy connects to HyperEVM and Hyperliquid through doors that Elysium settles, plus a liquidity network for fast transfers. This repository turns that prose into small executable parts, so the corner cases can be run and argued about.

There are four parts.

| Part | Module | What it models |
| --- | --- | --- |
| Canonical path | `src/bridge.ts` | HyperEVM and Elysium as an Orbit-style parent and child: inbox deposits, outbox withdrawals, a challenge delay, a replay guard |
| HyperCore leg | `src/hypercore.ts` | The account-level spot transfer between HyperCore and HyperEVM, as an interface with a mock adapter |
| Routes | `src/route.ts`, `src/pool.ts` | A planner and a runner that compose the legs with a shielded pool, in both directions |
| Fast path | `src/fastpath.ts` | A relayer that fronts funds on the destination, with the canonical path as fallback and settlement |

Supporting files: `src/state.ts` (the one status machine every leg uses), `src/replay.ts`, `src/types.ts` (balances and time), `src/errors.ts`, `src/world.ts` (wires everything together for tests and examples).

## Ground rules of the model

- **Deterministic.** Time is an integer tick that the caller passes in. There are no clocks, no network, no randomness.
- **Abstract.** HYPE is the gas asset. USDC is the example ERC-20. Balances are `bigint`. There are no chain identifiers, no contract addresses and no throughput or latency figures.
- **Atomic calls.** A call either changes state or throws a typed error and changes nothing.
- **One status machine.** Every hop, message and transfer moves through `pending`, `confirmed`, `finalized`, `refunded` and `failed`. See [STATE-MACHINES.md](STATE-MACHINES.md).
- **Fees are HYPE.** Each leg charges a fee in HYPE on the side where the leg starts. A fee is a parameter. There is no native token and no tokenomics.
- **No proofs.** The shielded pool is a port with a mock. The real pool rules are in [shielded-pool-model](https://github.com/HashPrivacyCC/shielded-pool-model).

## What it does not model

- Real Orbit contracts, fraud or validity proofs, sequencer behavior or data availability.
- The real HyperCore to HyperEVM mechanism. Every precompile and system address detail is "to be specified against the Hyperliquid docs". See [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).
- Privacy of the routes. A route has public legs, and what an observer can link across them is not analyzed here.
- Monero. That connection is a separate atomic swap, modeled in [xmr-swap-model](https://github.com/HashPrivacyCC/xmr-swap-model).

## Reading order

1. [ROUTES.md](ROUTES.md) for the diagrams.
2. [STATE-MACHINES.md](STATE-MACHINES.md) for the statuses and what moves them.
3. [TRUST-MODEL.md](TRUST-MODEL.md) for who you are trusting at each hop.
4. [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) for what is not decided.
5. [GLOSSARY.md](GLOSSARY.md) for the terms.
