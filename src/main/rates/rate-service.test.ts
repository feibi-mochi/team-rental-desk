import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamRentalDatabase } from "../database/database.js";
import { RateService } from "./rate-service.js";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "team-rental-rates-"));
  directories.push(directory);
  const database = new TeamRentalDatabase(join(directory, "app.db"));
  return { database, service: new RateService(database) };
}

describe("RateService", () => {
  it("uses current public exchange rates, including a moving USDT quote", async () => {
    const { database, service } = setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { currency: "USD", rates: { AUD: "1.5", CNY: "7.1", GBP: "0.8", THB: "34", USDT: "1.002" } },
    }), { status: 200 })));

    const result = await service.refresh();

    expect(result.skipped).toEqual([]);
    const usdt = database.db.prepare("SELECT units_per_usd, provider FROM exchange_quote WHERE code = 'USDT'").get() as { units_per_usd: string; provider: string };
    expect(usdt.units_per_usd).toBe("1.002");
    expect(usdt.provider).toContain("Coinbase");
    database.close();
  });

  it("uses central-bank references without inventing a 1:1 USDT quote", async () => {
    const { database, service } = setup();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { date: "2026-08-04", base: "USD", quote: "AUD", rate: 1.5 },
        { date: "2026-08-04", base: "USD", quote: "CNY", rate: 7.1 },
        { date: "2026-08-04", base: "USD", quote: "GBP", rate: 0.8 },
        { date: "2026-08-04", base: "USD", quote: "THB", rate: 34 },
      ]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.refresh();

    expect(result.skipped).toEqual(["USDT"]);
    expect(database.db.prepare("SELECT 1 FROM exchange_quote WHERE code = 'USDT'").get()).toBeUndefined();
    database.close();
  });

  it("keeps a previous market USDT quote when the current providers have no USDT data", async () => {
    const { database, service } = setup();
    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('USDT', '1.0015', 'previous-market-quote', '2026-08-08T00:00:00.000Z')
    `).run();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { date: "2026-08-09", base: "USD", quote: "AUD", rate: 1.5 },
        { date: "2026-08-09", base: "USD", quote: "CNY", rate: 7.1 },
        { date: "2026-08-09", base: "USD", quote: "GBP", rate: 0.8 },
        { date: "2026-08-09", base: "USD", quote: "THB", rate: 34 },
      ]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.refresh();

    expect(result.skipped).toEqual(["USDT"]);
    expect(database.db.prepare("SELECT units_per_usd, provider, quoted_at FROM exchange_quote WHERE code = 'USDT'").get())
      .toEqual({
        units_per_usd: "1.0015",
        provider: "previous-market-quote",
        quoted_at: "2026-08-08T00:00:00.000Z",
      });
    database.close();
  });

  it("keeps using cached rates when the computer is offline", async () => {
    const { database, service } = setup();
    database.db.prepare("UPDATE money_unit SET enabled = 0 WHERE code IN ('USDT', 'AUD', 'GBP', 'THB')").run();
    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('CNY', '7.2', 'saved-cache', '2026-08-09T00:00:00.000Z')
    `).run();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await service.refresh();

    expect(result.updated).toBe(0);
    expect(result.provider).toContain("本地缓存");
    expect(result.skipped).toEqual([]);
    database.close();
  });

  it("reports USDT as skipped instead of failing or fabricating a quote when no cache exists", async () => {
    const { database, service } = setup();
    database.db.prepare("UPDATE money_unit SET enabled = 0 WHERE code NOT IN ('USD', 'USDT')").run();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await service.refresh();

    expect(result).toMatchObject({ updated: 1, skipped: ["USDT"] });
    expect(database.db.prepare("SELECT 1 FROM exchange_quote WHERE code = 'USDT'").get()).toBeUndefined();
    database.close();
  });

  it("never refreshes a soft-deleted currency even if an old row is still enabled", async () => {
    const { database, service } = setup();
    database.db.prepare("UPDATE money_unit SET enabled = 0 WHERE code NOT IN ('USD', 'USDT')").run();
    database.db.prepare("UPDATE money_unit SET enabled = 1, deleted_at = ? WHERE code = 'USDT'")
      .run("2026-08-09T00:00:00.000Z");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { currency: "USD", rates: { USDT: "1.002" } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.refresh();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ updated: 1, skipped: [] });
    expect(database.db.prepare("SELECT 1 FROM exchange_quote WHERE code = 'USDT'").get()).toBeUndefined();
    database.close();
  });
});
