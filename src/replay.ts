import { ReplayError } from "./errors.js";

/** Remembers which message ids have been consumed. A message id can be consumed once. */
export class ReplayGuard {
  private readonly seen = new Set<string>();

  has(id: string): boolean {
    return this.seen.has(id);
  }

  /** Throws `ReplayError` if the id was already consumed. Does not record anything. */
  assertFresh(id: string): void {
    if (this.seen.has(id)) throw new ReplayError(`message ${id.slice(0, 12)} was already consumed`);
  }

  /** Throws `ReplayError` if the id was already consumed, otherwise records it. */
  consume(id: string): void {
    this.assertFresh(id);
    this.seen.add(id);
  }

  get size(): number {
    return this.seen.size;
  }
}
