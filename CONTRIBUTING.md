# Contributing

Thanks for reading the model closely. This repository is a research reference for how value moves between Hash Privacy on Elysium and the rest of the Hyperliquid ecosystem, so the most useful contributions are corrections and counterexamples.

Issues and discussion are welcome. Code contributions (pull requests) are not accepted for now. The source is all rights reserved, so any code contribution would need a written agreement with Hash Privacy first. Please open an issue instead and describe the change you have in mind.

## Ways to contribute

- **Report a mismatch** between the model and the [spec](https://github.com/HashPrivacyCC/protocol-spec), especially [10 Connections](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/10-connections.md). Say which document and rule.
- **Add a failing test** that shows a transfer the model completes and should reject, or a state the model reaches and should not.
- **Correct a Hyperliquid detail.** Every place marked "to be specified against the Hyperliquid docs" is open. A pointer to the real documentation is welcome.
- **Point out small things** such as typos and unclear wording in an issue.
- **Report a security problem** privately. See [SECURITY.md](SECURITY.md).

## If a change has been agreed

This applies only after a written agreement.

1. Create a branch.
2. Change one topic per pull request.
3. Run `npm run typecheck`, `npm test` and `npm run check:dashes`. All must pass.
4. If you change a rule, update the relevant page in `docs/` and add or change tests, including the rejection cases.
5. Explain in the description what changed and why, and link the spec section it follows.

## Style

- TypeScript strict, ESM, no `any`, no runtime dependencies.
- The model stays deterministic: no clocks, I/O or network. Time is an integer tick that the caller passes in.
- Do not invent chain identifiers, contract addresses, precompile addresses, system addresses or timing numbers. Mark them "to be specified" instead.
- Do not describe the model as audited, deployed or safe for funds.
- Use commas, colons and periods. Do not use em dashes.
- Comments only where the logic is not obvious.

## Code of Conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

The repository is all rights reserved, see [LICENSE](LICENSE). Nothing you submit in an issue or discussion grants anyone a license to the code, and a code contribution is only considered under a written agreement.
