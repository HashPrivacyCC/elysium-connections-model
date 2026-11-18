import { InvalidTransitionError } from "./errors.js";

/**
 * The status every hop, message and transfer in the model moves through.
 *
 * pending:   submitted, value is held at the source
 * confirmed: delivered at the destination, not yet final
 * finalized: final, nothing can undo it
 * refunded:  value went back to the sender
 * failed:    the attempt did not complete, value was returned or reassigned by the rules of that leg
 */
export type HopStatus = "pending" | "confirmed" | "finalized" | "refunded" | "failed";

export const HOP_STATUSES: readonly HopStatus[] = ["pending", "confirmed", "finalized", "refunded", "failed"];

const ALLOWED: Record<HopStatus, readonly HopStatus[]> = {
  pending: ["confirmed", "failed", "refunded"],
  confirmed: ["finalized", "failed"],
  finalized: [],
  refunded: [],
  failed: [],
};

export function canTransition(from: HopStatus, to: HopStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function isTerminal(status: HopStatus): boolean {
  return ALLOWED[status].length === 0;
}

export function assertTransition(from: HopStatus, to: HopStatus, what: string): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(`${what}: cannot move from ${from} to ${to}`);
  }
}
