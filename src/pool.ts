import { NoteNotFoundError, NoteSpentError, NotNoteOwnerError, InvalidConfigError } from "./errors.js";
import { assertPositive, HYPE, type AssetId, type Balances, type Tick } from "./types.js";

/**
 * The part of a shielded pool the routes need. The real pool rules live in the
 * shielded-pool-model repository. This port keeps the route model free of any proof or tree logic.
 */
export interface ShieldedPoolPort {
  /** Fee in HYPE for a shield, paid on Elysium by the depositor. */
  readonly shieldFee: bigint;
  /** Fee in HYPE for an unshield, paid on Elysium by the recipient. */
  readonly unshieldFee: bigint;
  /** Move a public Elysium balance into a new note owned by `owner`. */
  shield(req: { owner: string; asset: AssetId; amount: bigint }, now: Tick): { noteId: string };
  /** Spend a whole note into a public Elysium balance. */
  unshield(req: { noteId: string; owner: string; recipient: string }, now: Tick): { asset: AssetId; amount: bigint };
  note(noteId: string): { owner: string; asset: AssetId; amount: bigint; spent: boolean };
}

export const POOL_CUSTODY = "shielded-pool";
export const POOL_FEE_SINK = "pool-fee-sink";

/** In-memory stand-in with no proofs. Custody sits in one Elysium account. */
export class MockShieldedPool implements ShieldedPoolPort {
  private readonly notes = new Map<string, { owner: string; asset: AssetId; amount: bigint; spent: boolean }>();
  private counter = 0;

  constructor(
    readonly elysium: Balances,
    readonly shieldFee: bigint = 1n,
    readonly unshieldFee: bigint = 1n,
  ) {
    if (shieldFee < 0n || unshieldFee < 0n) throw new InvalidConfigError("fees must not be negative");
  }

  shield(req: { owner: string; asset: AssetId; amount: bigint }, _now: Tick): { noteId: string } {
    assertPositive(req.amount);
    this.elysium.charge(req.owner, [
      [req.asset, req.amount],
      [HYPE, this.shieldFee],
    ]);
    this.elysium.credit(POOL_CUSTODY, req.asset, req.amount);
    if (this.shieldFee > 0n) this.elysium.credit(POOL_FEE_SINK, HYPE, this.shieldFee);
    const noteId = `note-${this.counter++}`;
    this.notes.set(noteId, { owner: req.owner, asset: req.asset, amount: req.amount, spent: false });
    return { noteId };
  }

  note(noteId: string): { owner: string; asset: AssetId; amount: bigint; spent: boolean } {
    const n = this.notes.get(noteId);
    if (!n) throw new NoteNotFoundError(`no note ${noteId}`);
    return { ...n };
  }

  unshield(req: { noteId: string; owner: string; recipient: string }, _now: Tick): { asset: AssetId; amount: bigint } {
    const n = this.notes.get(req.noteId);
    if (!n) throw new NoteNotFoundError(`no note ${req.noteId}`);
    if (n.spent) throw new NoteSpentError(`note ${req.noteId} is already spent`);
    if (n.owner !== req.owner) throw new NotNoteOwnerError(`${req.owner} does not own ${req.noteId}`);
    if (this.unshieldFee > 0n) this.elysium.transfer(req.recipient, POOL_FEE_SINK, HYPE, this.unshieldFee);
    this.elysium.transfer(POOL_CUSTODY, req.recipient, n.asset, n.amount);
    n.spent = true;
    return { asset: n.asset, amount: n.amount };
  }

  /** Total value held in unspent notes of one asset. */
  shieldedTotal(asset: AssetId): bigint {
    let sum = 0n;
    for (const n of this.notes.values()) if (!n.spent && n.asset === asset) sum += n.amount;
    return sum;
  }
}
