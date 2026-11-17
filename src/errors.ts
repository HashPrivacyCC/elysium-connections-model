/** Typed rejections. Every rule the model enforces maps to one class. */

export type ConnectionErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_CONFIG"
  | "INSUFFICIENT_BALANCE"
  | "UNSUPPORTED_ASSET"
  | "INVALID_TRANSITION"
  | "UNKNOWN_MESSAGE"
  | "REPLAY"
  | "NOT_YET_DUE"
  | "DEADLINE_PASSED"
  | "BRIDGE_PAUSED"
  | "LIMIT_EXCEEDED"
  | "INSUFFICIENT_LIQUIDITY"
  | "UNKNOWN_RELAYER"
  | "SPOT_TRANSFER_FAILED"
  | "UNKNOWN_TRANSFER"
  | "INVALID_ROUTE"
  | "NOTE_NOT_FOUND"
  | "NOTE_SPENT"
  | "NOT_NOTE_OWNER";

export class ConnectionError extends Error {
  readonly code: ConnectionErrorCode;
  constructor(code: ConnectionErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidAmountError extends ConnectionError {
  constructor(message: string) {
    super("INVALID_AMOUNT", message);
  }
}

export class InvalidConfigError extends ConnectionError {
  constructor(message: string) {
    super("INVALID_CONFIG", message);
  }
}

export class InsufficientBalanceError extends ConnectionError {
  constructor(message: string) {
    super("INSUFFICIENT_BALANCE", message);
  }
}

export class UnsupportedAssetError extends ConnectionError {
  constructor(message: string) {
    super("UNSUPPORTED_ASSET", message);
  }
}

export class InvalidTransitionError extends ConnectionError {
  constructor(message: string) {
    super("INVALID_TRANSITION", message);
  }
}

export class UnknownMessageError extends ConnectionError {
  constructor(message: string) {
    super("UNKNOWN_MESSAGE", message);
  }
}

export class ReplayError extends ConnectionError {
  constructor(message: string) {
    super("REPLAY", message);
  }
}

/** A delay has not elapsed yet, for example the challenge window or the inbox delay. */
export class NotYetDueError extends ConnectionError {
  constructor(message: string) {
    super("NOT_YET_DUE", message);
  }
}

/** A deadline has passed, for example a deposit expiry or a fill window. */
export class DeadlinePassedError extends ConnectionError {
  constructor(message: string) {
    super("DEADLINE_PASSED", message);
  }
}

export class BridgePausedError extends ConnectionError {
  constructor(message: string) {
    super("BRIDGE_PAUSED", message);
  }
}

export type LimitKind = "min" | "per-transfer" | "outstanding";

export class LimitExceededError extends ConnectionError {
  readonly limit: LimitKind;
  constructor(limit: LimitKind, message: string) {
    super("LIMIT_EXCEEDED", message);
    this.limit = limit;
  }
}

export class InsufficientLiquidityError extends ConnectionError {
  constructor(message: string) {
    super("INSUFFICIENT_LIQUIDITY", message);
  }
}

export class UnknownRelayerError extends ConnectionError {
  constructor(message: string) {
    super("UNKNOWN_RELAYER", message);
  }
}

export class SpotTransferFailedError extends ConnectionError {
  constructor(message: string) {
    super("SPOT_TRANSFER_FAILED", message);
  }
}

export class UnknownTransferError extends ConnectionError {
  constructor(message: string) {
    super("UNKNOWN_TRANSFER", message);
  }
}

export class InvalidRouteError extends ConnectionError {
  constructor(message: string) {
    super("INVALID_ROUTE", message);
  }
}

export class NoteNotFoundError extends ConnectionError {
  constructor(message: string) {
    super("NOTE_NOT_FOUND", message);
  }
}

export class NoteSpentError extends ConnectionError {
  constructor(message: string) {
    super("NOTE_SPENT", message);
  }
}

export class NotNoteOwnerError extends ConnectionError {
  constructor(message: string) {
    super("NOT_NOTE_OWNER", message);
  }
}
