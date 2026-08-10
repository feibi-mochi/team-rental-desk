import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const transactionsPage = readFileSync(new URL("../renderer/src/pages/TransactionsPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../renderer/src/styles.css", import.meta.url), "utf8");

describe("transaction history layout", () => {
  it("uses dedicated full-width tables instead of the grouped space table", () => {
    expect(transactionsPage).toContain('className="transaction-table receipt-table"');
    expect(transactionsPage).toContain('className="transaction-table renewal-table"');
    expect(transactionsPage).not.toContain('className="space-table"');
    expect(styles).toMatch(/\.transaction-table\s*\{[^}]*display:\s*table;/s);
    expect(styles).toMatch(/\.transaction-table\s*\{[^}]*width:\s*100%;/s);
    expect(styles).toMatch(/\.transaction-table tbody\s*\{[^}]*display:\s*table-row-group;/s);
  });

  it("scrolls receipt history after five rows and renewal history after three rows", () => {
    expect(transactionsPage).toContain("transaction-scroll-shell receipt-scroll-shell");
    expect(transactionsPage).toContain("transaction-scroll-shell renewal-scroll-shell");
    expect(styles).toMatch(/\.receipt-scroll-shell\s*\{[^}]*max-height:\s*370px;/s);
    expect(styles).toMatch(/\.renewal-scroll-shell\s*\{[^}]*max-height:\s*242px;/s);
    expect(styles).toMatch(/\.transaction-scroll-shell\s*\{[^}]*overflow:\s*auto;/s);
    expect(styles).toMatch(/\.transaction-scroll-shell \.transaction-table th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  });
});
