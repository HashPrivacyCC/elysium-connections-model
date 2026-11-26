# Errors

> Research model. Not a working bridge.

Every rule the model enforces maps to one error class and one `code`. All classes extend `ConnectionError`, defined in `src/errors.ts`. A rejected call does not change state.

| Code | Class | Raised when |
| --- | --- | --- |
| `INVALID_AMOUNT` | `InvalidAmountError` | An amount is not a positive bigint, or a time value is not a non-negative integer |
| `INVALID_CONFIG` | `InvalidConfigError` | A configuration or limit is inconsistent, such as an expiry not after the inbox delay |
| `INSUFFICIENT_BALANCE` | `InsufficientBalanceError` | An account cannot cover an amount plus its HYPE fee |
| `UNSUPPORTED_ASSET` | `UnsupportedAssetError` | An asset is not supported by the leg |
| `INVALID_TRANSITION` | `InvalidTransitionError` | A status change is not allowed by the machine |
| `UNKNOWN_MESSAGE` | `UnknownMessageError` | A canonical message id does not exist |
| `REPLAY` | `ReplayError` | A message id is consumed a second time |
| `NOT_YET_DUE` | `NotYetDueError` | A delay has not elapsed, for example the challenge window or the inbox delay |
| `DEADLINE_PASSED` | `DeadlinePassedError` | A deadline has passed, for example a deposit expiry, a closed challenge window or a fill window |
| `BRIDGE_PAUSED` | `BridgePausedError` | Delivery or execution is attempted while the bridge is paused |
| `LIMIT_EXCEEDED` | `LimitExceededError` | A fast path limit is breached. `limit` is `min`, `per-transfer` or `outstanding` |
| `INSUFFICIENT_LIQUIDITY` | `InsufficientLiquidityError` | A relayer cannot cover a fill |
| `UNKNOWN_RELAYER` | `UnknownRelayerError` | A fill is attempted by an account that is not registered |
| `SPOT_TRANSFER_FAILED` | `SpotTransferFailedError` | The other side rejected a spot transfer |
| `UNKNOWN_TRANSFER` | `UnknownTransferError` | A spot or fast transfer id does not exist |
| `INVALID_ROUTE` | `InvalidRouteError` | A route plan is empty, malformed or does not match its note |
| `NOTE_NOT_FOUND` | `NoteNotFoundError` | The pool has no such note |
| `NOTE_SPENT` | `NoteSpentError` | The note was already spent |
| `NOT_NOTE_OWNER` | `NotNoteOwnerError` | The caller does not own the note |

## Handling

Check `err.code` rather than the class name or the message. Codes are part of the public API. Messages may change.

`NOT_YET_DUE`, `BRIDGE_PAUSED` and `DEADLINE_PASSED` are the expected "try later or take the other branch" outcomes. The route runner treats them as "not yet" and keeps waiting, except where it handles an expired deposit by refunding it. Any other error from a hop fails that hop.
