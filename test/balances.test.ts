import { describe, expect, it } from "vitest";
import { Balances, InsufficientBalanceError, InvalidAmountError, ReplayError, ReplayGuard } from "../src/index.js";

describe("Balances", () => {
  it("credits, debits and transfers per account and asset", () => {
    const b = new Balances("hyperevm");
    b.credit("a", "HYPE", 10n);
    b.transfer("a", "b", "HYPE", 4n);
    expect(b.get("a", "HYPE")).toBe(6n);
    expect(b.get("b", "HYPE")).toBe(4n);
    expect(b.get("b", "USDC")).toBe(0n);
    expect(b.total("HYPE")).toBe(10n);
  });

  it("rejects a debit below zero and leaves the balance alone", () => {
    const b = new Balances("elysium");
    b.credit("a", "USDC", 5n);
    expect(() => b.debit("a", "USDC", 6n)).toThrow(InsufficientBalanceError);
    expect(b.get("a", "USDC")).toBe(5n);
  });

  it("charge is all or nothing", () => {
    const b = new Balances("elysium");
    b.credit("a", "USDC", 50n);
    b.credit("a", "HYPE", 1n);
    expect(() => b.charge("a", [["USDC", 10n], ["HYPE", 2n]])).toThrow(InsufficientBalanceError);
    expect(b.get("a", "USDC")).toBe(50n);
    expect(b.get("a", "HYPE")).toBe(1n);
  });

  it("charge sums repeated assets before checking", () => {
    const b = new Balances("elysium");
    b.credit("a", "HYPE", 10n);
    expect(() => b.charge("a", [["HYPE", 6n], ["HYPE", 6n]])).toThrow(InsufficientBalanceError);
    b.charge("a", [["HYPE", 5n], ["HYPE", 5n]]);
    expect(b.get("a", "HYPE")).toBe(0n);
  });

  it("rejects zero and negative credits", () => {
    const b = new Balances("hyperliquid");
    expect(() => b.credit("a", "HYPE", 0n)).toThrow(InvalidAmountError);
    expect(() => b.credit("a", "HYPE", -1n)).toThrow(InvalidAmountError);
  });

  it("total does not mix assets whose names share a suffix", () => {
    const b = new Balances("hyperevm");
    b.credit("a", "HYPE", 1n);
    b.credit("a", "XHYPE", 7n);
    expect(b.total("HYPE")).toBe(1n);
  });
});

describe("ReplayGuard", () => {
  it("consumes an id once", () => {
    const g = new ReplayGuard();
    expect(g.has("m1")).toBe(false);
    g.consume("m1");
    expect(g.has("m1")).toBe(true);
    expect(g.size).toBe(1);
    expect(() => g.consume("m1")).toThrow(ReplayError);
  });

  it("assertFresh does not record the id", () => {
    const g = new ReplayGuard();
    g.assertFresh("m1");
    expect(g.has("m1")).toBe(false);
  });

  it("tracks ids independently", () => {
    const g = new ReplayGuard();
    g.consume("a");
    expect(() => g.consume("b")).not.toThrow();
    expect(g.size).toBe(2);
  });
});
