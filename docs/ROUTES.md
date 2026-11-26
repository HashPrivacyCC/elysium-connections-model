# Routes

> Research model. Not a working bridge. Delays and fees are parameters.

Value moves between three places: HyperCore (Hyperliquid), HyperEVM and Elysium. Hash Privacy lives on Elysium. Only the first and last hops of a route touch public networks that are not Elysium, and the shielded pool sits at the end of the inbound route and the start of the outbound one.

## The map

```mermaid
flowchart LR
    HC["HyperCore<br/>spot balance"] <-->|"spot transfer leg<br/>(adapter, mock)"| HE["HyperEVM"]
    HE <-->|"canonical path<br/>inbox / outbox"| EL["Elysium<br/>public balance"]
    EL <-->|"shield / unshield"| SP[("Shielded pool")]
```

## Shield on arrival

```
Hyperliquid          HyperEVM             Elysium              Shielded pool
(spot balance)       (EVM balance)        (public balance)
     |                    |                    |                    |
     | 1 core-to-evm      |                    |                    |
     |------------------->|                    |                    |
     |   fee: HYPE        | 2 evm-to-elysium   |                    |
     |                    |  inbox deposit     |                    |
     |                    |------------------->|                    |
     |                    |   fee: HYPE        | 3 shield           |
     |                    |                    |------------------->|
     |                    |                    |   fee: HYPE        |
     |                    |                    |           note created
```

```mermaid
sequenceDiagram
    participant C as HyperCore
    participant H as HyperEVM
    participant E as Elysium
    participant P as Shielded pool
    C->>H: 1 spot transfer (fee in HYPE)
    H->>E: 2 inbox deposit (fee in HYPE)
    E->>P: 3 shield (fee in HYPE)
    P-->>E: note created
```

`planShieldOnArrival` produces these three hops. `from: "hyperevm"` drops hop 1 for a user who already holds funds on HyperEVM.

## Unshield and leave

```
Shielded pool        Elysium              HyperEVM             Hyperliquid
     |                    |                    |                    |
     | 1 unshield         |                    |                    |
     |------------------->|                    |                    |
     |   fee: HYPE        | 2 elysium-to-evm   |                    |
     |                    |  outbox withdrawal |                    |
     |                    |  (challenge delay) |                    |
     |                    |------------------->|                    |
     |                    |   fee: HYPE        | 3 evm-to-core      |
     |                    |                    |------------------->|
     |                    |                    |   fee: HYPE        |
```

```mermaid
sequenceDiagram
    participant P as Shielded pool
    participant E as Elysium
    participant H as HyperEVM
    participant C as HyperCore
    P->>E: 1 unshield (fee in HYPE)
    E->>H: 2 outbox withdrawal, after the challenge delay (fee in HYPE)
    H->>C: 3 spot transfer (fee in HYPE)
```

`planUnshieldToCore` produces these three hops and needs the id of the note to spend. `to: "hyperevm"` drops hop 3.

## Fees and funding

Each hop charges its fee in HYPE on the domain where the hop starts. The plan lists `requiredHype` per domain: the HYPE the account must already hold there, on top of anything that arrives. A route that cannot pay its fees does not start. How a new user gets the first HYPE on Elysium is an open question, see [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

## The canonical path

```mermaid
sequenceDiagram
    participant U as User on HyperEVM
    participant I as Inbox and escrow
    participant E as Elysium
    U->>I: deposit (amount escrowed, HYPE fee)
    Note over I,E: inbox delay
    I->>E: credit recipient (confirmed)
    Note over I,E: parent finality delay
    I->>I: finalized
```

```mermaid
sequenceDiagram
    participant U as User on Elysium
    participant O as Outbox
    participant H as HyperEVM
    U->>O: withdraw (amount locked, HYPE fee)
    O->>O: posted (confirmed), challenge window opens
    Note over O,H: challenge delay, parameter
    O->>H: execute, replay guard consumes the id (finalized)
```

A deposit that is not delivered before its expiry can only be refunded. A withdrawal that is challenged inside the window returns to the sender on Elysium. Each message id can be consumed once.

## The fast path

```mermaid
sequenceDiagram
    participant U as User
    participant F as Escrow (source side)
    participant R as Relayer
    participant D as Recipient (destination side)
    participant X as Router (destination side)
    U->>F: amount + canonical fee + relayer fee
    F->>X: canonical message, recipient is the router
    R->>D: fronts the amount from its own balance (fill)
    Note over F,X: canonical delay
    X->>R: router repays the relayer (settle)
    F->>R: relayer fee
```

If nobody fills, the router pays the recipient when the canonical message finalizes, and the relayer fee goes back to the user. If the canonical message fails, the escrow pays the relayer when it filled, or returns the amount to the user when it did not.

In a route, a fast hop counts as done once the relayer has filled, so the next hop starts early. Settlement of the earlier hop continues in the background.
