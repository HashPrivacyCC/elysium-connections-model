# elysium-connections-model

![CI](https://github.com/HashPrivacyCC/elysium-connections-model/actions/workflows/ci.yml/badge.svg)

A small reference model of how value moves between Hash Privacy on Elysium and the rest of the Hyperliquid ecosystem, following the connections described in the [Hash Privacy protocol spec](https://github.com/HashPrivacyCC/protocol-spec). Hash Privacy is the privacy layer of Elysium, the Kinetiq L2 for the Hyperliquid ecosystem. Elysium is built on Arbitrum Orbit, settles to HyperEVM and uses HYPE for gas.

> **Research model. Not a working bridge. Do not use with funds.** This code holds no keys, runs no proofs, and touches no network, RPC or wallet. It models states, messages, delays and fees only. Nothing here is audited or deployed. Every parameter is a placeholder.

## Status

Work in progress. The package scaffold is in place and the model is being added in pieces: the canonical HyperEVM and Elysium path, the HyperCore spot transfer leg, shield-on-arrival routes and a relayer fast path.

## Quickstart

Node 22 or newer.

```sh
npm install
npm run typecheck
npm test
```

There are no runtime dependencies.

## Links

- Website: https://hashprivacy.cc
- GitHub: https://github.com/HashPrivacyCC
- Spec: https://github.com/HashPrivacyCC/protocol-spec
- Shielded pool model: https://github.com/HashPrivacyCC/shielded-pool-model
- XMR swap model: https://github.com/HashPrivacyCC/xmr-swap-model

## License

Copyright (c) 2026 Hash Privacy. All rights reserved. The source is published for reference and review only, and no permission is granted to copy, modify, distribute, sublicense or use it without prior written permission. See [LICENSE](LICENSE). The protocol spec it follows is licensed separately under CC BY 4.0. The Hash Privacy name and logo are covered separately in the brand kit.
