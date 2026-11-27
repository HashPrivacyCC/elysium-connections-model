# Changelog

All notable changes to this repository are documented in this file.

Versions describe the state of the model, not a deployed protocol.

## [Unreleased]

## [0.1.0] - 2026-11-27

### Added

- Canonical path between HyperEVM and Elysium: inbox deposits, outbox withdrawals, a challenge delay parameter, deposit expiry with refund, a finality delay and a replay guard. HYPE and USDC are supported, and fees are charged in HYPE.
- HyperCore leg: a spot transfer adapter interface, a mock adapter with settle and finality delays, failure and refund, and the `HYPERCORE_UNSPECIFIED` list of details that are to be specified against the Hyperliquid docs.
- Shielded pool port with an in-memory mock, so routes can end in or start from a pool without proofs.
- Route planner for shield-on-arrival (Hyperliquid, HyperEVM, Elysium, shielded pool) and the reverse, with HYPE fees per hop and the HYPE required on each domain.
- Route runner with one status machine per hop (pending, confirmed, finalized, refunded, failed) and an event log.
- Fast path: a relayer fronts funds on the destination, with the canonical path as fallback and settlement, fill windows, refund when the canonical message fails and per-route limits.
- Typed errors with one class and one code per rejection.
- Vitest suites covering every status transition, replay rejection, timeout refunds, limit breaches and the round-trip routes.
- Examples `hyperliquid-to-shielded`, `shielded-to-hyperevm` and `fast-path-fallback`, with npm scripts.
- Docs: overview, routes, state machines, trust model, open questions, glossary and errors.
- CI workflow and an em dash check.
