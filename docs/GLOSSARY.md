# Glossary

> Research model. Not a working bridge. These are the terms the code and the other pages use, in the same words as the [spec](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/glossary.md) where the spec has them.

| Term | Meaning in this model |
| --- | --- |
| Elysium | The Kinetiq L2 for the Hyperliquid ecosystem. Built on Arbitrum Orbit, settles to HyperEVM, uses HYPE for gas |
| Hash Privacy | The privacy layer of Elysium. Its contracts on Elysium verify zero-knowledge proofs |
| HyperEVM | The EVM side of Hyperliquid. The parent of Elysium in the canonical path |
| HyperCore | The Hyperliquid side that holds spot balances. Reached through the spot transfer leg |
| HYPE | The gas asset. Every fee in the model is paid in HYPE |
| USDC | The example ERC-20 in the tests and examples |
| Domain | One of `hyperliquid`, `hyperevm`, `elysium`. A place where balances live |
| Tick | An abstract unit of time. The caller passes it in. The model never reads a clock |
| Hop | One leg of a route, such as `core-to-evm` or `shield` |
| Route | An ordered list of hops with a plan and a runner |
| Plan | The output of the planner: hops, fees and the HYPE required on each domain |
| Shield on arrival | An inbound route that ends with a deposit into the shielded pool |
| Unshield | Spending a note into a public Elysium balance. The first hop of an outbound route |
| Canonical path | The inbox and outbox between HyperEVM and Elysium. Slow but needs no relayer |
| Inbox | The deposit side of the canonical path. HyperEVM to Elysium |
| Outbox | The withdrawal side of the canonical path. Elysium to HyperEVM |
| Escrow | The HyperEVM account that holds the backing for what exists on Elysium |
| Inbox delay | Ticks before a deposit may be delivered. A parameter |
| Deposit expiry | Ticks after which an undelivered deposit can only be refunded. A parameter |
| Challenge delay | Ticks a posted withdrawal stays open to a challenge before it can execute. A parameter, no real value is claimed |
| Replay guard | A set of consumed message ids. A message can be consumed once |
| Spot transfer | The account-level move of one asset between a HyperCore spot balance and the same account on HyperEVM |
| Adapter | The interface behind the spot transfer. The model ships a mock |
| Hold account | Where a pending spot transfer keeps the amount until it confirms or fails |
| Fast path | A relayer fronts the funds on the destination. The canonical path settles and is the fallback |
| Relayer | A party with inventory on the destination side that pays the recipient early and is repaid later |
| Fill | The relayer paying the recipient |
| Router | The destination account that receives the canonical message and pays the relayer or the recipient |
| Fill window | Ticks after opening during which a relayer may still fill |
| Settle | Closing a fast transfer once the canonical message is final or has failed |
| Route limit | A minimum, a per-transfer maximum and an outstanding maximum for one direction and asset |
| Outstanding | The sum of fast transfers that are pending or confirmed |
| Note | A private unit of value in the shielded pool. See shielded-pool-model |
| Hop status | One of pending, confirmed, finalized, refunded, failed. See [STATE-MACHINES.md](STATE-MACHINES.md) |
| Gas bootstrap | Getting the first HYPE onto a domain so a user can pay fees there. Open |
