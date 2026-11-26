# Open questions

> Research model. Not a working bridge. These are the decisions this model does not make.

## To be specified against the Hyperliquid docs

The spot transfer leg is an interface with a mock adapter. These details are not in the model and are not guessed:

- The precompile interface, if any, used to read or move balances.
- The system addresses involved in a transfer between HyperCore and HyperEVM.
- How an asset on HyperCore maps to an asset on HyperEVM, including identifiers, decimals and minimum amounts.
- Settlement timing and ordering between the two sides, and what happens to a transfer that cannot be credited.
- Whether a smart contract account can take part, or only an externally owned account.

These are collected in the `HYPERCORE_UNSPECIFIED` constant, so they are visible in code as well as here.

## Canonical path

- Challenge delay. It is a parameter here. The real value is to be specified by the Elysium design.
- Whether a withdrawal can be forced into the outbox if the operator does not post it.
- What happens to funds held in the parent escrow if Elysium halts for a long time. The spec lists this too.
- Whether deposits can fail on the child side, and what the refund address is.
- How HYPE as the gas asset interacts with the escrow when HYPE is also the bridged asset. The model charges the fee on top of the amount.

## Routes

- **Gas bootstrap.** A new user arrives on Elysium with no HYPE. The model requires HYPE on each domain up front. Options are a gas drip, a fee taken from the bridged amount, or a bundled HYPE top-up. See also the gas drip in [xmr-swap-model](https://github.com/HashPrivacyCC/xmr-swap-model).
- **One account across three domains.** The model uses one account name everywhere. Whether the same address works on HyperCore, HyperEVM and Elysium is to be specified.
- **Route privacy.** Shield-on-arrival has public legs before the shield. What an observer can link, and whether to add delays or batching, is not analyzed.
- **Partial failure.** A route that fails mid-way leaves the value on an intermediate domain. Whether a route should offer an automatic unwind is open.

## Fast path

- Relayer selection, collateral and fee setting. The spec lists these as open.
- Whether the relayer risk after a fill is covered by the escrow, as modeled, by a bond, or by something else.
- Fill windows and limits. The values here are placeholders.
- How the destination router learns that the canonical message is final, without trusting the relayer.
- Whether the relayer learns anything about the user, since the recipient is visible on the destination.

## Spec links

- [10 Connections](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/10-connections.md)
- [12 Fees](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/12-fees.md)
- [14 Threat model](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/14-threat-model.md)
