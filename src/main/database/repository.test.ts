import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { TeamRentalDatabase } from "./database.js";
import { TeamRentalRepository } from "./repository.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "team-rental-repo-"));
  temporaryDirectories.push(directory);
  const database = new TeamRentalDatabase(join(directory, "app.db"));
  database.db.prepare(`
    INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
    VALUES ('CNY', '7.2', 'test', '2026-08-04T00:00:00.000Z')
  `).run();
  const repository = new TeamRentalRepository(database);
  const methodId = repository.savePaymentMethod({ name: "测试渠道", note: "" });
  const spaceId = repository.saveSpace({
    displayName: "测试空间",
    serviceKind: "chatgpt",
    ownerLogin: "owner@example.com",
    countryCode: "CN",
    sourceCurrency: "USD",
    sourceCostMinor: 2_500,
    openedOn: "2026-07-03",
    currentCycleStartedOn: "2026-07-03",
    renewsOn: "2026-08-03",
    renewalAnchorDay: 3,
    cycleMonths: 1,
    motherSeatKind: "chatgpt",
    motherSeatFlexible: false,
    paymentMethodIds: [methodId],
    defaultPaymentMethodId: methodId,
  });
  return { database, repository, spaceId };
}

describe("TeamRentalRepository receipt lifecycle", () => {
  it("does not advance a new customer's next payment date after the first receipt", () => {
    const { database, repository, spaceId } = setup();
    const childId = repository.saveChildSeat({
      spaceId,
      positionNumber: 1,
      seatKind: "chatgpt",
      usageKind: "rental",
      customerLogin: "new@example.com",
      label: "",
      contact: "",
      joinedOn: "2026-08-03",
      chargeCurrency: "CNY",
      chargeMinor: 10_000,
      paymentDay: 3,
      nextPaymentOn: "2026-09-03",
      cycleMonths: 1,
    });

    repository.recordReceipt({
      childSeatId: childId,
      grossMinor: 10_000,
      feeBasisPoints: 60,
      receivedAt: "2026-08-03T11:00:00.000+08:00",
    });

    const child = repository.listSpaces("2026-08-04")[0]?.childSeats[0];
    expect(child?.nextPaymentOn).toBe("2026-09-03");
    expect(child?.pendingFirstReceipt).toBe(false);
    expect(child?.collectionStatus).toBe("none");
    const dashboard = repository.dashboard("2026-08-04");
    expect(dashboard.currentMonthNetCnyMinor).toBe(9_940);
    expect(dashboard.monthlyIncome).toEqual([expect.objectContaining({
      month: "2026-08",
      grossCnyMinor: 10_000,
      netCnyMinor: 9_940,
      receiptCount: 1,
      childSeatCount: 1,
    })]);
    expect(dashboard.spacePerformance).toEqual([expect.objectContaining({
      displayName: "测试空间",
      rentedChildSeats: 1,
      monthlyRevenueCnyMinor: 10_000,
      monthlyCostCnyMinor: 18_000,
      collectedNetCnyMinor: 9_940,
      costCovered: false,
    })]);
    database.close();
  });

  it("advances a regular cycle only after it is fully collected", () => {
    const { database, repository, spaceId } = setup();
    const childId = repository.saveChildSeat({
      spaceId,
      positionNumber: 1,
      seatKind: "chatgpt",
      usageKind: "rental",
      customerLogin: "new@example.com",
      label: "",
      contact: "",
      joinedOn: "2026-08-03",
      chargeCurrency: "CNY",
      chargeMinor: 10_000,
      paymentDay: 3,
      nextPaymentOn: "2026-09-03",
      cycleMonths: 1,
    });
    repository.recordReceipt({ childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0, receivedAt: "2026-08-03T10:00:00.000+08:00" });
    repository.recordReceipt({ childSeatId: childId, grossMinor: 4_000, feeBasisPoints: 0, receivedAt: "2026-09-01T10:00:00.000+08:00" });
    expect(repository.listSpaces("2026-09-01")[0]?.childSeats[0]?.collectionStatus).toBe("partial");
    expect(() => repository.recordReceipt({ childSeatId: childId, grossMinor: 6_001, feeBasisPoints: 0, receivedAt: "2026-09-01T10:01:00.000+08:00" })).toThrow(/超过/);
    repository.recordReceipt({ childSeatId: childId, grossMinor: 6_000, feeBasisPoints: 0, receivedAt: "2026-09-01T10:02:00.000+08:00" });
    expect(repository.listSpaces("2026-09-01")[0]?.childSeats[0]?.nextPaymentOn).toBe("2026-10-03");
    const monthly = repository.dashboard("2026-09-01").monthlyIncome;
    expect(monthly.map((item) => [item.month, item.receiptCount, item.childSeatCount, item.netCnyMinor])).toEqual([
      ["2026-09", 2, 1, 10_000],
      ["2026-08", 1, 1, 10_000],
    ]);
    database.close();
  });

  it("marks an edited login as 新客户，待记账", () => {
    const { database, repository, spaceId } = setup();
    const childId = repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "first@example.com", label: "", contact: "", joinedOn: "2026-07-31",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 31, nextPaymentOn: "2026-08-31", cycleMonths: 1,
    });
    repository.recordReceipt({ childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0, receivedAt: "2026-07-31T10:00:00.000+08:00" });
    repository.saveChildSeat({
      id: childId, spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "second@example.com", label: "", contact: "", joinedOn: "2026-08-31",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 31, nextPaymentOn: "2026-09-30", cycleMonths: 1,
    });
    expect(repository.listSpaces("2026-08-31")[0]?.childSeats[0]?.collectionStatus).toBe("new_customer");
    database.close();
  });

  it("uses separate reminder thresholds for mother accounts and child seats", () => {
    const { database, repository, spaceId } = setup();
    database.setSetting("space.status.soonDays", "2");
    database.setSetting("childAccount.status.soonDays", "7");
    database.db.prepare("UPDATE team_space SET renews_on = '2026-08-10' WHERE id = ?").run(spaceId);
    repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "threshold@example.com", label: "", contact: "", joinedOn: "2026-08-01",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 10, nextPaymentOn: "2026-08-10", cycleMonths: 1,
    });
    const space = repository.listSpaces("2026-08-04")[0];
    expect(space?.expiryStatus).toBe("normal");
    expect(space?.childSeats[0]?.expiryStatus).toBe("soon");
    database.close();
  });

  it("does not silently rewrite a partially paid billing cycle", () => {
    const { database, repository, spaceId } = setup();
    const childId = repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "partial@example.com", label: "", contact: "", joinedOn: "2026-08-03",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 3, nextPaymentOn: "2026-09-03", cycleMonths: 1,
    });
    repository.recordReceipt({ childSeatId: childId, grossMinor: 4_000, feeBasisPoints: 0, receivedAt: "2026-08-03T10:00:00.000+08:00" });
    expect(() => repository.saveChildSeat({
      id: childId, spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "partial@example.com", label: "", contact: "", joinedOn: "2026-08-03",
      chargeCurrency: "CNY", chargeMinor: 12_000, paymentDay: 3, nextPaymentOn: "2026-09-03", cycleMonths: 1,
    })).toThrow(/部分收款/);
    database.close();
  });

  it("limits each mother account to two active child seats", () => {
    const { database, repository, spaceId } = setup();
    const save = (positionNumber: number, customerLogin: string) => repository.saveChildSeat({
      spaceId, positionNumber, seatKind: "chatgpt", usageKind: "rental",
      customerLogin, label: "", contact: "", joinedOn: "2026-08-03",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 3, nextPaymentOn: "2026-09-03", cycleMonths: 1,
    });
    const firstId = save(1, "first@example.com");
    save(2, "second@example.com");
    expect(() => repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "third@example.com", label: "", contact: "", joinedOn: "2026-08-03",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 3, nextPaymentOn: "2026-09-03", cycleMonths: 1,
    })).toThrow(/最多只能保留 2 个子位置/);
    repository.archiveChildSeat(firstId);
    expect(save(1, "replacement@example.com")).toBeTruthy();
    database.close();
  });
});

describe("TeamRentalRepository archive and guard rails", () => {
  it("archives child seats, keeps shortcut bindings, and restores everything together", () => {
    const { database, repository, spaceId } = setup();
    const childId = repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "archived@example.com", label: "", contact: "", joinedOn: "2026-08-03",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 3, nextPaymentOn: "2026-09-03", cycleMonths: 1,
    });
    repository.saveShortcut({ label: "跳转", targetPath: "C:\\dummy.lnk", spaceId });
    repository.archiveSpace(spaceId);
    expect(repository.listSpaces("2026-08-04")).toHaveLength(0);
    expect(repository.listArchivedSpaces("2026-08-04")).toHaveLength(1);
    expect(repository.listShortcuts().find((item) => item.label === "跳转")?.spaceId).toBe(spaceId);
    const child = database.db.prepare("SELECT archived_at FROM child_seat WHERE id = ?").get(childId) as {
      archived_at: string | null;
    };
    expect(child.archived_at).not.toBeNull();
    repository.unarchiveSpace(spaceId);
    expect(repository.listSpaces("2026-08-04")).toHaveLength(1);
    expect(repository.listArchivedSpaces("2026-08-04")).toHaveLength(0);
    expect(repository.listSpaces("2026-08-04")[0]?.childSeats).toHaveLength(1);
    expect(repository.listSpaces("2026-08-04")[0]?.childSeats[0]?.id).toBe(childId);
    expect(repository.listShortcuts().find((item) => item.label === "跳转")?.spaceId).toBe(spaceId);
    database.close();
  });

  it("refuses to archive a payment method used as default", () => {
    const { database, repository } = setup();
    const methodId = repository.savePaymentMethod({ name: "默认渠道", note: "" });
    repository.saveSpace({
      displayName: "空间二", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "CN",
      sourceCurrency: "USD", sourceCostMinor: 2_500, openedOn: "2026-07-03", currentCycleStartedOn: "2026-07-03",
      renewsOn: "2026-08-03", renewalAnchorDay: 3, cycleMonths: 1, motherSeatKind: "chatgpt",
      motherSeatFlexible: false, paymentMethodIds: [methodId], defaultPaymentMethodId: methodId,
    });
    expect(() => repository.setPaymentMethodArchived(methodId, true)).toThrow(/绑定/);
    database.close();
  });

  it("refuses to bind an archived payment method", () => {
    const { database, repository } = setup();
    const methodId = repository.savePaymentMethod({ name: "旧渠道", note: "" });
    repository.setPaymentMethodArchived(methodId, true);
    expect(() => repository.saveSpace({
      displayName: "空间三", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "CN",
      sourceCurrency: "USD", sourceCostMinor: 2_500, openedOn: "2026-07-03", currentCycleStartedOn: "2026-07-03",
      renewsOn: "2026-08-03", renewalAnchorDay: 3, cycleMonths: 1, motherSeatKind: "chatgpt",
      motherSeatFlexible: false, paymentMethodIds: [methodId], defaultPaymentMethodId: null,
    })).toThrow(/已归档/);
    database.close();
  });

  it("refuses to disable or change decimals for a currency in use", () => {
    const { database, repository } = setup();
    expect(() => repository.saveCurrency({
      code: "USD", name: "美元", symbol: "$", decimalPlaces: 3, enabled: true,
    })).toThrow(/小数位/);
    expect(() => repository.saveCurrency({
      code: "USD", name: "美元", symbol: "$", decimalPlaces: 2, enabled: false,
    })).toThrow(/停用/);
    database.close();
  });
});
