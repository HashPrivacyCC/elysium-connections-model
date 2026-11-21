import { describe, expect, it } from "vitest";
import {
  Balances,
  HYPE,
  InsufficientBalanceError,
  InvalidConfigError,
  MockShieldedPool,
  NoteNotFoundError,
  NoteSpentError,
  NotNoteOwnerError,
  POOL_CUSTODY,
  USDC,
} from "../src/index.js";
import { ALICE, BOB } from "./helpers.js";

function setup() {
  const elysium = new Balances("elysium");
  elysium.credit(ALICE, USDC, 100n);
  elysium.credit(ALICE, HYPE, 5n);
  elysium.credit(BOB, HYPE, 5n);
  return { elysium, pool: new MockShieldedPool(elysium, 1n, 2n) };
}

describe("mock shielded pool port", () => {
  it("shield moves the amount to custody and charges the HYPE fee", () => {
    const { elysium, pool } = setup();
    const { noteId } = pool.shield({ owner: ALICE, asset: USDC, amount: 60n }, 0);
    expect(elysium.get(ALICE, USDC)).toBe(40n);
    expect(elysium.get(ALICE, HYPE)).toBe(4n);
    expect(elysium.get(POOL_CUSTODY, USDC)).toBe(60n);
    expect(pool.note(noteId)).toEqual({ owner: ALICE, asset: USDC, amount: 60n, spent: false });
    expect(pool.shieldedTotal(USDC)).toBe(60n);
  });

  it("unshield pays the recipient and charges the unshield fee in HYPE", () => {
    const { elysium, pool } = setup();
    const { noteId } = pool.shield({ owner: ALICE, asset: USDC, amount: 60n }, 0);
    const out = pool.unshield({ noteId, owner: ALICE, recipient: BOB }, 1);
    expect(out).toEqual({ asset: USDC, amount: 60n });
    expect(elysium.get(BOB, USDC)).toBe(60n);
    expect(elysium.get(BOB, HYPE)).toBe(3n);
    expect(pool.shieldedTotal(USDC)).toBe(0n);
  });

  it("rejects a double unshield", () => {
    const { pool } = setup();
    const { noteId } = pool.shield({ owner: ALICE, asset: USDC, amount: 10n }, 0);
    pool.unshield({ noteId, owner: ALICE, recipient: ALICE }, 1);
    expect(() => pool.unshield({ noteId, owner: ALICE, recipient: ALICE }, 2)).toThrow(NoteSpentError);
  });

  it("rejects an unshield by a non-owner and leaves the note spendable", () => {
    const { pool } = setup();
    const { noteId } = pool.shield({ owner: ALICE, asset: USDC, amount: 10n }, 0);
    expect(() => pool.unshield({ noteId, owner: BOB, recipient: BOB }, 1)).toThrow(NotNoteOwnerError);
    expect(pool.note(noteId).spent).toBe(false);
  });

  it("rejects an unknown note", () => {
    const { pool } = setup();
    expect(() => pool.unshield({ noteId: "x", owner: ALICE, recipient: ALICE }, 0)).toThrow(NoteNotFoundError);
    expect(() => pool.note("x")).toThrow(NoteNotFoundError);
  });

  it("rejects a shield the account cannot fund and creates no note", () => {
    const { pool } = setup();
    expect(() => pool.shield({ owner: ALICE, asset: USDC, amount: 101n }, 0)).toThrow(InsufficientBalanceError);
    expect(() => pool.note("note-0")).toThrow(NoteNotFoundError);
  });

  it("rejects an unshield when the recipient cannot pay the fee, leaving the note unspent", () => {
    const { elysium, pool } = setup();
    const { noteId } = pool.shield({ owner: ALICE, asset: USDC, amount: 10n }, 0);
    elysium.debit(BOB, HYPE, 5n);
    expect(() => pool.unshield({ noteId, owner: ALICE, recipient: BOB }, 1)).toThrow(InsufficientBalanceError);
    expect(pool.note(noteId).spent).toBe(false);
  });

  it("rejects negative fees", () => {
    expect(() => new MockShieldedPool(new Balances("elysium"), -1n, 0n)).toThrow(InvalidConfigError);
  });

  it("numbers notes in order", () => {
    const { pool } = setup();
    expect(pool.shield({ owner: ALICE, asset: USDC, amount: 1n }, 0).noteId).toBe("note-0");
    expect(pool.shield({ owner: ALICE, asset: USDC, amount: 1n }, 0).noteId).toBe("note-1");
  });
});
