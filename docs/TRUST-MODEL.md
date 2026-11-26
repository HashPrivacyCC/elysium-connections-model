# Trust model

> Research model. Not a working bridge. This page says what the model assumes at each hop, not what a real system guarantees.

## Per hop

| Hop | Who you trust | What goes wrong | What the model shows |
| --- | --- | --- | --- |
| HyperCore to HyperEVM, and back | The mechanism that credits the other side. To be specified against the Hyperliquid docs | The transfer is rejected or delayed | A failed spot transfer returns the amount to the source and keeps the fee |
| HyperEVM to Elysium (inbox) | The parent escrow and the party that delivers inbox messages | Delivery is slow or paused | After the expiry the deposit can only be refunded, to the refund address |
| Elysium to HyperEVM (outbox) | The challenge process, and the escrow on HyperEVM | A bad withdrawal is posted, or a good one is challenged wrongly | A challenge inside the window returns the amount. After the window, execution is final and consumed once |
| Shield, unshield | The pool contracts and proofs on Elysium | A rejected pool call | The hop fails and the value stays on Elysium. The real rules are in shielded-pool-model |
| Fast path | The relayer, for speed only | The relayer does not fill, or the canonical message fails after a fill | No fill means the canonical path pays the recipient. A failed canonical message after a fill costs the relayer, not the user |

## What a relayer can and cannot do

- A relayer can refuse to fill, or be slow. The user then gets the canonical path.
- A relayer cannot redirect funds. The recipient is fixed when the transfer is opened, and the router pays the recipient or the relayer, nobody else.
- A relayer carries the risk that the canonical message fails after a fill. In the model the escrow repays the relayer at the source in that case. How a real system prices that risk is open.
- A relayer earns the relayer fee only when it filled and the transfer settled.

## What an operator of the canonical path can do

- Pause delivery. The model blocks `deliverDeposit` and `executeWithdrawal` while paused. Funds are not lost: a deposit refunds after the expiry, and a withdrawal executes after an unpause.
- Delay posting a withdrawal. In the model a withdrawal is only `pending` until `confirmWithdrawal`. Whether a user can force inclusion is an open question.

## Limits

Per-route limits bound how much can be in flight through the fast path: a minimum, a maximum per transfer and a maximum outstanding. They limit the loss from a bug or a bad relayer. They are not a security proof.

## Not covered

- Privacy. A route has public legs. The amounts and timing on the public hops are visible, and the model does not analyze linkage.
- Soundness of proofs, the Orbit fraud or validity mechanism, and Elysium liveness.
- Key custody and any signing.

See the [spec security and trust page](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/09-security-and-trust.md) and the [threat model](https://github.com/HashPrivacyCC/protocol-spec/blob/main/docs/14-threat-model.md).
