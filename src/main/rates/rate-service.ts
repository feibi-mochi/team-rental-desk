import type { RateRefreshResult } from "../../shared/contracts.js";
import type { TeamRentalDatabase } from "../database/database.js";

type StoredRate = { code: string; unitsPerUsd: string; provider: string; quotedAt: string };
type FrankfurterRate = { date: string; base: string; quote: string; rate: number };
type CoinbasePayload = { data?: { currency?: string; rates?: Record<string, string> } };

export class RateService {
  private inFlight: Promise<RateRefreshResult> | null = null;

  constructor(private readonly database: TeamRentalDatabase) {}

  refresh(): Promise<RateRefreshResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async fetchCoinbase(codes: string[], now: string): Promise<StoredRate[]> {
    if (!codes.length) return [];
    const response = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD", {
      headers: { accept: "application/json", "user-agent": "Team-Rental-Desk/1.0.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Coinbase 汇率服务返回 ${response.status}`);
    const payload = await response.json() as CoinbasePayload;
    if (payload.data?.currency !== "USD" || !payload.data.rates) throw new Error("Coinbase 汇率格式异常");
    return codes.flatMap((code) => {
      const value = Number(payload.data?.rates?.[code]);
      return Number.isFinite(value) && value > 0
        ? [{ code, unitsPerUsd: String(value), provider: "Coinbase 即时汇率", quotedAt: now }]
        : [];
    });
  }

  private async fetchFrankfurter(codes: string[]): Promise<StoredRate[]> {
    const requested = codes.filter((code) => code !== "USDT");
    const result: StoredRate[] = [];
    for (let index = 0; index < requested.length; index += 40) {
      const batch = requested.slice(index, index + 40);
      if (!batch.length) continue;
      const url = new URL("https://api.frankfurter.dev/v2/rates");
      url.searchParams.set("base", "USD");
      url.searchParams.set("quotes", batch.join(","));
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "Team-Rental-Desk/1.0.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Frankfurter 汇率服务返回 ${response.status}`);
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) throw new Error("Frankfurter 汇率格式异常");
      for (const item of payload) {
        const rate = item as Partial<FrankfurterRate>;
        if (rate.base === "USD" && typeof rate.quote === "string" && typeof rate.rate === "number" && Number.isFinite(rate.rate) && rate.rate > 0 && typeof rate.date === "string") {
          result.push({
            code: rate.quote,
            unitsPerUsd: String(rate.rate),
            provider: "Frankfurter 央行参考汇率",
            quotedAt: `${rate.date}T00:00:00.000Z`,
          });
        }
      }
    }
    return result;
  }

  private async performRefresh(): Promise<RateRefreshResult> {
    const rows = this.database.db.prepare(`
      SELECT code FROM money_unit
      WHERE enabled = 1 AND deleted_at IS NULL
      ORDER BY code
    `).all() as Array<{ code: string }>;
    const requested = rows.map((row) => row.code).filter((code) => code !== "USD");
    const now = new Date().toISOString();
    this.database.setSetting("rates.lastAttemptAt", now);

    const rates = new Map<string, StoredRate>();
    const errors: string[] = [];
    try {
      for (const rate of await this.fetchCoinbase(requested, now)) rates.set(rate.code, rate);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const missing = requested.filter((code) => !rates.has(code));
    if (missing.length) {
      try {
        for (const rate of await this.fetchFrankfurter(missing)) rates.set(rate.code, rate);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (requested.length > 0 && rates.size === 0) {
      const cached = this.database.db.prepare(`
        SELECT code, quoted_at FROM exchange_quote
        WHERE code IN (${requested.map(() => "?").join(",")})
      `).all(...requested) as Array<{ code: string; quoted_at: string }>;
      if (cached.length === 0) {
        this.database.db.transaction(() => {
          this.database.db.prepare(`
            INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
            VALUES ('USD', '1', '固定基准', ?)
            ON CONFLICT(code) DO UPDATE SET
              units_per_usd = excluded.units_per_usd,
              provider = excluded.provider,
              quoted_at = excluded.quoted_at
          `).run(now);
          this.database.setSetting("rates.lastSuccessAt", now);
        })();
        return {
          updated: 1,
          skipped: requested,
          provider: errors.length ? `仅固定 USD（${errors.join("；")}）` : "仅固定 USD",
          quotedAt: now,
        };
      }
      const cachedCodes = new Set(cached.map((row) => row.code));
      return {
        updated: 0,
        skipped: requested.filter((code) => !cachedCodes.has(code)),
        provider: "本地缓存（网络不可用）",
        quotedAt: cached.map((row) => row.quoted_at).sort().at(-1) ?? now,
      };
    }

    const insert = this.database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        units_per_usd = excluded.units_per_usd,
        provider = excluded.provider,
        quoted_at = excluded.quoted_at
    `);
    this.database.db.transaction(() => {
      insert.run("USD", "1", "固定基准", now);
      for (const rate of rates.values()) insert.run(rate.code, rate.unitsPerUsd, rate.provider, rate.quotedAt);
      this.database.setSetting("rates.lastSuccessAt", now);
    })();
    const updated = new Set(["USD", ...rates.keys()]);
    const providers = [...new Set([...rates.values()].map((rate) => rate.provider))];
    return {
      updated: updated.size,
      skipped: rows.map((row) => row.code).filter((code) => !updated.has(code)),
      provider: providers.join(" + ") || "固定基准",
      quotedAt: now,
    };
  }
}
