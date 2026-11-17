# Security Policy

## Status

This repository is a research model. It holds no real keys, makes no network calls, moves no funds and contains no zero-knowledge proofs, so there is no deployed system to attack. Review of the model is still valuable, because a wrong rule here may point at a wrong rule in the spec.

## What to report

- A sequence of calls in which the model creates value, loses value or pays one transfer twice.
- A message the replay guard accepts a second time.
- A fast path state where a relayer or a user is paid twice, or neither is paid.
- A limit or a timeout the model lets a caller bypass.
- A rule that disagrees with the spec in a way that matters.
- Anything in the docs that could mislead a reader into treating this code as a usable bridge.

## How to report

Please report privately. Open a **private security advisory** on this repository using the "Report a vulnerability" option under the Security tab. Do not open a public issue or pull request for a vulnerability.

Include, as far as you can:

- A description of the problem and the affected file or rule.
- A sequence of calls that shows it.
- The impact you expect.
- Any suggested fix.

## What to expect

- We will acknowledge the report in the advisory thread.
- We will work with you to confirm the issue.
- We will fix the model, and the spec if needed, and credit you if you wish.

## Safe harbor

Good-faith research and responsible disclosure under this policy will not be met with legal action.

## Bounties

There is no bounty program at this stage.
