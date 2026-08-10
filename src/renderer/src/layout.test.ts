/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SpaceListItem } from "../../shared/contracts";
import { availableSpaces } from "./pages/ArchivedChildrenPage";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const spacesPage = readFileSync(new URL("./pages/SpacesPage.tsx", import.meta.url), "utf8");
const archivedSpacesPage = readFileSync(new URL("./pages/ArchivedSpacesPage.tsx", import.meta.url), "utf8");
const archivedChildrenPage = readFileSync(new URL("./pages/ArchivedChildrenPage.tsx", import.meta.url), "utf8");
const currenciesPage = readFileSync(new URL("./pages/CurrenciesPage.tsx", import.meta.url), "utf8");
const paymentMethodsPage = readFileSync(new URL("./pages/PaymentMethodsPage.tsx", import.meta.url), "utf8");
const transactionsPage = readFileSync(new URL("./pages/TransactionsPage.tsx", import.meta.url), "utf8");
const shortcutsPage = readFileSync(new URL("./pages/ShortcutsPage.tsx", import.meta.url), "utf8");
const settingsPage = readFileSync(new URL("./pages/SettingsPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function space(id: string, occupied: number[]): SpaceListItem {
  return {
    id,
    displayName: id,
    serviceKind: "chatgpt",
    ownerLogin: `${id}@example.com`,
    countryCode: "CN",
    sourceCost: { minor: 0, currency: "USD" },
    sourceCostUsdMinor: null,
    sourceCostCnyMinor: null,
    openedOn: "2026-08-01",
    currentCycleStartedOn: "2026-08-01",
    renewsOn: "2026-09-01",
    renewalAnchorDay: 1,
    cycleMonths: 1,
    expiryStatus: "normal",
    motherSeatKind: "chatgpt",
    motherSeatFlexible: false,
    paymentMethods: [],
    childSeats: occupied.map((positionNumber) => ({
      id: `${id}:${positionNumber}`,
      spaceId: id,
      positionNumber,
      seatKind: "chatgpt",
      usageKind: "rental",
      customerLogin: "child@example.com",
      label: "",
      contact: "",
      joinedOn: "2026-08-01",
      charge: { minor: 10_000, currency: "CNY" },
      paymentDay: 1,
      nextPaymentOn: "2026-09-01",
      cycleMonths: 1,
      pendingFirstReceipt: false,
      expiryStatus: "normal",
      collectionStatus: "none",
      receivedMinor: 0,
      remainingMinor: 10_000,
    })),
  };
}

describe("navigation and archive layout", () => {
  it("gives both archive kinds their own navigation entry and combines currencies with rates", () => {
    expect(app).toContain('label: "运营概览"');
    expect(app).toContain('label: "已归档空间"');
    expect(app).toContain('label: "子位置归档"');
    expect(app).toContain('label: "币种汇率"');
    expect(app).not.toContain('key: "rates"');
    expect(spacesPage).not.toContain("listArchivedSpaces");
  });

  it("offers only genuinely open positions when restoring a child", () => {
    const targets = availableSpaces([space("empty", []), space("one", [1]), space("full", [1, 2]), space("legacy-full", [3, 4])]);
    expect(targets.map((target) => [target.space.id, target.positions])).toEqual([
      ["empty", [1, 2]],
      ["one", [2]],
    ]);
  });

  it("keeps historical money metadata and clearly preserves history during deletion", () => {
    expect(archivedChildrenPage).toContain("listCurrencies(true)");
    expect(archivedChildrenPage).toContain("历史收款流水会保留");
    expect(archivedSpacesPage).toContain("历史收款和续费流水会保留");
    expect(currenciesPage).toContain("历史流水中的金额和币种仍会保留");
    expect(currenciesPage).toContain("记账基准币种不能删除");
    expect(paymentMethodsPage).toContain("历史流水会保留");
    expect(paymentMethodsPage).toContain("请先归档再删除");
    expect(transactionsPage).toContain("listCurrencies(true)");
  });

  it("uses platform capabilities instead of showing non-working port controls", () => {
    expect(app).toContain("platformCapabilities={bootstrap?.platformCapabilities");
    expect(shortcutsPage).toContain("platformCapabilities.chromeProfileShortcuts");
    expect(settingsPage).toContain("platformCapabilities.startupCheck");
    expect(settingsPage).toContain("platformCapabilities.nativeNotifications");
  });
});

describe("space form and table layout", () => {
  it("places payment selection and its default in one responsive row", () => {
    expect(spacesPage).toContain('className="payment-config span-2"');
    expect(styles).toMatch(/\.payment-config\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/s);
    expect(styles).toMatch(/@media \(max-width:\s*820px\)[\s\S]*\.payment-config\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  });

  it("uses the table itself as a vertical scroll area with a pinned opaque header", () => {
    expect(spacesPage).toContain("active-space-table-shell");
    expect(styles).toMatch(/\.active-space-table-shell\s*\{[^}]*max-height:[^;}]+;[^}]*overflow:\s*auto;/s);
    expect(styles).toMatch(/\.space-table thead\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
    expect(styles).toMatch(/\.space-table thead th\s*\{[^}]*background:\s*#f5f8f6;/s);
  });

  it("uses the live USDT quote instead of presenting USD as USDT", () => {
    expect(spacesPage).toContain("function usdtReference");
    expect(spacesPage).toContain("currency.unitsPerUsd");
    expect(spacesPage).not.toContain("space.sourceCostUsdMinor/100");
  });

  it("reflows dashboard work rows by their real card width", () => {
    expect(styles).toMatch(/\.work-card\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(styles).toMatch(/@container \(max-width:\s*760px\)[\s\S]*\.work-actions\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  });
});
