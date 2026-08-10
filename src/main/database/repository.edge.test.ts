import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TeamRentalDatabase } from "./database.js";
import { TeamRentalRepository } from "./repository.js";

const directories: string[] = [];
const databases: TeamRentalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) if (database.db.open) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "team-rental-edge-"));
  directories.push(directory);
  const database = new TeamRentalDatabase(join(directory, "app.db"));
  databases.push(database);
  database.db.prepare(`
    INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
    VALUES ('CNY', '7.2', 'test', '2026-08-09T00:00:00.000Z')
  `).run();
  return { database, repository: new TeamRentalRepository(database) };
}

function saveSpace(repository: TeamRentalRepository, methods: string[] = [], defaultMethod: string | null = null) {
  return repository.saveSpace({
    displayName: "边界测试空间", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "CN",
    sourceCurrency: "CNY", sourceCostMinor: 18_000, openedOn: "2026-08-01", currentCycleStartedOn: "2026-08-01",
    renewsOn: "2026-09-01", renewalAnchorDay: 1, cycleMonths: 1, motherSeatKind: "chatgpt",
    motherSeatFlexible: false, paymentMethodIds: methods, defaultPaymentMethodId: defaultMethod,
  });
}

function saveChild(repository: TeamRentalRepository, spaceId: string, positionNumber = 1) {
  return repository.saveChildSeat({
    spaceId, positionNumber, seatKind: "chatgpt", usageKind: "rental",
    customerLogin: `child-${positionNumber}@example.com`, label: "", contact: "",
    joinedOn: "2026-08-01", chargeCurrency: "CNY", chargeMinor: 10_000,
    paymentDay: 1, nextPaymentOn: "2026-09-01", cycleMonths: 1,
  });
}

describe("human edge cases", () => {
  it("rejects dates that run backwards", () => {
    const { repository } = setup();
    expect(() => repository.saveSpace({
      displayName: "错误日期", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "CN",
      sourceCurrency: "CNY", sourceCostMinor: 10_000, openedOn: "2026-10-01", currentCycleStartedOn: "2026-09-01",
      renewsOn: "2026-08-01", renewalAnchorDay: 1, cycleMonths: 1, motherSeatKind: "chatgpt",
      motherSeatFlexible: false, paymentMethodIds: [], defaultPaymentMethodId: null,
    })).toThrow(/不能早于/);
    const spaceId = saveSpace(repository);
    expect(() => repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental", customerLogin: "bad@example.com",
      label: "", contact: "", joinedOn: "2026-09-10", chargeCurrency: "CNY", chargeMinor: 10_000,
      paymentDay: 10, nextPaymentOn: "2026-08-10", cycleMonths: 1,
    })).toThrow(/晚于加入/);
  });

  it("does not restore a child that was archived independently", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const first = saveChild(repository, spaceId, 1);
    const second = saveChild(repository, spaceId, 2);
    repository.archiveChildSeat(first);
    repository.archiveSpace(spaceId);
    repository.unarchiveSpace(spaceId);
    expect(repository.listSpaces("2026-08-09")[0]?.childSeats.map((item) => item.id)).toEqual([second]);
  });

  it("blocks changing customers while a partial receipt remains", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId);
    repository.recordReceipt({ childSeatId: childId, grossMinor: 4_000, feeBasisPoints: 0, receivedAt: "2026-08-09T01:00:00.000Z" });
    expect(() => repository.saveChildSeat({
      id: childId, spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "replacement@example.com", label: "", contact: "", joinedOn: "2026-08-09",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 9, nextPaymentOn: "2026-09-09", cycleMonths: 1,
    })).toThrow(/撤销/);
  });

  it("shows a new customer's partial first payment as partial", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId);
    repository.recordReceipt({ childSeatId: childId, grossMinor: 4_000, feeBasisPoints: 0, receivedAt: "2026-08-09T01:00:00.000Z" });
    const child = repository.listSpaces("2026-08-09")[0]!.childSeats[0]!;
    expect({ status: child.collectionStatus, received: child.receivedMinor, remaining: child.remainingMinor }).toEqual({
      status: "partial",
      received: 4_000,
      remaining: 6_000,
    });
  });

  it("blocks archiving any payment method still bound to an active space", () => {
    const { repository } = setup();
    const primary = repository.savePaymentMethod({ name: "主渠道", note: "" });
    const secondary = repository.savePaymentMethod({ name: "备用渠道", note: "" });
    saveSpace(repository, [primary, secondary], primary);
    expect(() => repository.setPaymentMethodArchived(secondary, true)).toThrow(/绑定/);
  });

  it("blocks restoring a space while one of its payment methods is archived", () => {
    const { repository } = setup();
    const method = repository.savePaymentMethod({ name: "归档渠道", note: "" });
    const spaceId = saveSpace(repository, [method], method);
    repository.archiveSpace(spaceId);
    repository.setPaymentMethodArchived(method, true);
    expect(() => repository.unarchiveSpace(spaceId)).toThrow(/先恢复支付渠道/);
  });

  it("makes repeated receipt and renewal requests idempotent", () => {
    const { database, repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId);
    const receipt = { operationId: "11111111-1111-4111-8111-111111111111", childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0 as const, receivedAt: "2026-08-09T01:00:00.000Z" };
    repository.recordReceipt(receipt);
    repository.recordReceipt(receipt);
    const renewal = { operationId: "22222222-2222-4222-8222-222222222222", spaceId, frozenUsdMinor: 2_500, paidAt: "2026-08-09T01:00:00.000Z" };
    repository.renewSpace(renewal);
    repository.renewSpace(renewal);
    expect((database.db.prepare("SELECT COUNT(*) AS count FROM receipt").get() as { count: number }).count).toBe(1);
    expect((database.db.prepare("SELECT COUNT(*) AS count FROM renewal_event WHERE event_kind = 'renewal'").get() as { count: number }).count).toBe(1);
    expect(repository.listSpaces("2026-08-09")[0]?.renewsOn).toBe("2026-10-01");
  });

  it("voids the latest receipt and restores its billing state", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId);
    repository.recordReceipt({ childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0, receivedAt: "2026-08-09T01:00:00.000Z" });
    repository.recordReceipt({ childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0, receivedAt: "2026-09-01T01:00:00.000Z" });
    const latest = repository.listTransactions().receipts[0]!;
    repository.voidReceipt(latest.id, "金额录入错误");
    const child = repository.listSpaces("2026-09-01")[0]?.childSeats[0];
    expect(child?.nextPaymentOn).toBe("2026-09-01");
    expect(child?.collectionStatus).toBe("pending");
    expect(repository.dashboard("2026-09-01").currentMonthGrossCnyMinor).toBe(0);
    expect(repository.listTransactions().receipts[0]?.voidedAt).not.toBeNull();
  });

  it("keeps the original customer name on historical receipts", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId);
    repository.recordReceipt({ childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0, receivedAt: "2026-08-09T01:00:00.000Z" });
    repository.saveChildSeat({
      id: childId, spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "replacement@example.com", label: "", contact: "", joinedOn: "2026-08-09",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 9, nextPaymentOn: "2026-09-09", cycleMonths: 1,
    });
    expect(repository.listTransactions().receipts[0]?.childLabel).toContain("child-1@example.com");
  });

  it("does not let an old customer's receipt overwrite a replacement customer's dates", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId);
    repository.recordReceipt({ childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0, receivedAt: "2026-08-02T01:00:00.000Z" });
    repository.recordReceipt({ childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0, receivedAt: "2026-09-01T01:00:00.000Z" });
    repository.saveChildSeat({
      id: childId, spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "replacement@example.com", label: "", contact: "", joinedOn: "2026-09-15",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 15, nextPaymentOn: "2026-10-15", cycleMonths: 1,
    });
    const oldReceipt = repository.listTransactions().receipts[0]!;
    expect(oldReceipt.canVoid).toBe(false);
    expect(() => repository.voidReceipt(oldReceipt.id, "旧客户金额录错")).toThrow(/客户或账期资料/);
    expect(repository.listSpaces("2026-09-20")[0]!.childSeats[0]!.nextPaymentOn).toBe("2026-10-15");
  });

  it("keeps self-use positions out of receivables and starts billing when changed to rental", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "self_use",
      customerLogin: "self@example.com", label: "", contact: "", joinedOn: "2026-08-01",
      chargeCurrency: "CNY", chargeMinor: 0, paymentDay: 1, nextPaymentOn: "2026-08-02", cycleMonths: 1,
    });
    expect(repository.listSpaces("2026-08-09")[0]!.childSeats[0]!.collectionStatus).toBe("none");
    repository.saveChildSeat({
      id: childId, spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "self@example.com", label: "", contact: "", joinedOn: "2026-08-01",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 1, nextPaymentOn: "2026-09-01", cycleMonths: 1,
    });
    const rental = repository.listSpaces("2026-08-09")[0]!.childSeats[0]!;
    expect({ pendingFirstReceipt: rental.pendingFirstReceipt, status: rental.collectionStatus }).toEqual({
      pendingFirstReceipt: true,
      status: "new_customer",
    });
  });

  it("voids the latest renewal and restores the previous space dates", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    repository.renewSpace({ spaceId, frozenUsdMinor: 2_500, paidAt: "2026-08-09T01:00:00.000Z" });
    const event = repository.listTransactions().renewals[0]!;
    repository.voidRenewal(event.id, "续费金额录错");
    const space = repository.listSpaces("2026-08-09")[0]!;
    expect({ start: space.currentCycleStartedOn, due: space.renewsOn }).toEqual({ start: "2026-08-01", due: "2026-09-01" });
    expect(repository.dashboard("2026-08-09").mother.renewedThisMonth).toBe(0);
  });

  it("rejects unsupported free spaces and zero-price rentals", () => {
    const { repository } = setup();
    expect(() => repository.saveSpace({
      displayName: "免费空间", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "CN",
      sourceCurrency: "CNY", sourceCostMinor: 0, openedOn: "2026-08-01", currentCycleStartedOn: "2026-08-01",
      renewsOn: "2026-09-01", renewalAnchorDay: 1, cycleMonths: 1, motherSeatKind: "chatgpt",
      motherSeatFlexible: false, paymentMethodIds: [], defaultPaymentMethodId: null,
    })).toThrow();
    const spaceId = saveSpace(repository);
    expect(() => repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental", customerLogin: "free@example.com",
      label: "", contact: "", joinedOn: "2026-08-01", chargeCurrency: "CNY", chargeMinor: 0,
      paymentDay: 1, nextPaymentOn: "2026-09-01", cycleMonths: 1,
    })).toThrow(/必须大于/);
  });

  it("protects archived historical amounts from decimal-place changes", () => {
    const { database, repository } = setup();
    repository.saveCurrency({ code: "JPY", name: "日元", symbol: "¥", decimalPlaces: 0, enabled: true });
    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('JPY', '150', 'test', '2026-08-09T00:00:00.000Z')
    `).run();
    const spaceId = saveSpace(repository);
    const childId = repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "jpy@example.com", label: "", contact: "", joinedOn: "2026-08-01",
      chargeCurrency: "JPY", chargeMinor: 10_000, paymentDay: 1, nextPaymentOn: "2026-09-01", cycleMonths: 1,
    });
    repository.recordReceipt({ childSeatId: childId, grossMinor: 10_000, feeBasisPoints: 0, receivedAt: "2026-08-09T01:00:00.000Z" });
    repository.archiveSpace(spaceId);
    expect(() => repository.saveCurrency({ code: "JPY", name: "日元", symbol: "¥", decimalPlaces: 2, enabled: true })).toThrow(/不能修改小数位数/);
    expect(repository.listCurrencies().find((item) => item.code === "JPY")?.decimalPlaces).toBe(0);
  });

  it("blocks restoring a space that uses a disabled currency", () => {
    const { database, repository } = setup();
    repository.saveCurrency({ code: "JPY", name: "日元", symbol: "¥", decimalPlaces: 0, enabled: true });
    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('JPY', '150', 'test', '2026-08-09T00:00:00.000Z')
    `).run();
    const spaceId = repository.saveSpace({
      displayName: "日元空间", serviceKind: "chatgpt", ownerLogin: "owner@example.com", countryCode: "JP",
      sourceCurrency: "JPY", sourceCostMinor: 5_000, openedOn: "2026-08-01", currentCycleStartedOn: "2026-08-01",
      renewsOn: "2026-09-01", renewalAnchorDay: 1, cycleMonths: 1, motherSeatKind: "chatgpt",
      motherSeatFlexible: false, paymentMethodIds: [], defaultPaymentMethodId: null,
    });
    repository.archiveSpace(spaceId);
    repository.saveCurrency({ code: "JPY", name: "日元", symbol: "¥", decimalPlaces: 0, enabled: false });
    expect(() => repository.unarchiveSpace(spaceId)).toThrow(/先启用币种/);
    expect(repository.listSpaces("2026-08-09")).toHaveLength(0);
  });

  it("survives a continuous human receipt, replacement, renewal and archive workflow", () => {
    const { database, repository } = setup();
    const primary = repository.savePaymentMethod({ name: "连续流程主渠道", note: "" });
    const secondary = repository.savePaymentMethod({ name: "连续流程备用渠道", note: "" });
    const spaceId = saveSpace(repository, [primary, secondary], primary);
    const rentalId = saveChild(repository, spaceId, 1);
    const selfUseId = repository.saveChildSeat({
      spaceId, positionNumber: 2, seatKind: "chatgpt", usageKind: "self_use",
      customerLogin: "self@example.com", label: "", contact: "", joinedOn: "2026-08-01",
      chargeCurrency: "CNY", chargeMinor: 0, paymentDay: 1, nextPaymentOn: "2026-09-01", cycleMonths: 1,
    });
    const firstPart = {
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      childSeatId: rentalId,
      grossMinor: 4_000,
      feeBasisPoints: 0 as const,
      receivedAt: "2026-08-05T10:00:00.000+08:00",
    };
    repository.recordReceipt(firstPart);
    repository.recordReceipt(firstPart);
    expect(repository.listSpaces("2026-08-05")[0]!.childSeats.find((seat) => seat.id === rentalId)?.collectionStatus).toBe("partial");
    repository.recordReceipt({
      operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      childSeatId: rentalId,
      grossMinor: 6_000,
      feeBasisPoints: 60,
      receivedAt: "2026-08-05T10:05:00.000+08:00",
    });
    repository.recordReceipt({
      operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      childSeatId: rentalId,
      grossMinor: 3_000,
      feeBasisPoints: 0,
      receivedAt: "2026-09-01T09:00:00.000+08:00",
    });
    repository.voidReceipt(repository.listTransactions().receipts[0]!.id, "客户实际没有支付");
    repository.saveChildSeat({
      id: rentalId, spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "replacement@example.com", label: "", contact: "wx-replacement", joinedOn: "2026-09-15",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 15, nextPaymentOn: "2026-10-15", cycleMonths: 1,
    });
    const oldActiveReceipt = repository.listTransactions().receipts.find((item) => item.voidedAt === null)!;
    expect(oldActiveReceipt.canVoid).toBe(false);
    repository.recordReceipt({
      operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      childSeatId: rentalId,
      grossMinor: 10_000,
      feeBasisPoints: 160,
      receivedAt: "2026-09-15T19:30:00.000+08:00",
    });
    const renewal = {
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      spaceId,
      frozenUsdMinor: 2_500,
      paidAt: "2026-09-01T08:00:00.000+08:00",
    };
    repository.renewSpace(renewal);
    repository.renewSpace(renewal);
    repository.voidRenewal(repository.listTransactions().renewals[0]!.id, "支付金额记错");
    repository.archiveChildSeat(selfUseId);
    repository.archiveSpace(spaceId);
    repository.unarchiveSpace(spaceId);

    const active = repository.listSpaces("2026-09-20")[0]!;
    expect(active.childSeats.map((seat) => seat.id)).toEqual([rentalId]);
    expect(active.childSeats[0]!.nextPaymentOn).toBe("2026-10-15");
    expect(repository.dashboard("2026-09-20").currentMonthGrossCnyMinor).toBe(10_000);
    expect(database.db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect((database.db.pragma("foreign_key_check") as unknown[]).length).toBe(0);
  });

  it("keeps an archived customer independent when the slot is reused and preserves old revenue after cross-space restore", () => {
    const { database, repository } = setup();
    const sourceSpaceId = saveSpace(repository);
    database.db.prepare("UPDATE team_space SET display_name = '来源母空间' WHERE id = ?").run(sourceSpaceId);
    const archivedChildId = saveChild(repository, sourceSpaceId, 1);
    repository.recordReceipt({
      childSeatId: archivedChildId,
      grossMinor: 10_000,
      feeBasisPoints: 0,
      receivedAt: "2026-08-09T01:00:00.000Z",
    });
    repository.archiveChildSeat(archivedChildId);

    const replacementId = saveChild(repository, sourceSpaceId, 1);
    expect(replacementId).not.toBe(archivedChildId);
    expect(repository.listSpaces("2026-08-09")[0]!.childSeats.map((seat) => seat.id)).toEqual([replacementId]);
    expect(repository.listArchivedChildSeats("2026-08-09")).toEqual([
      expect.objectContaining({
        id: archivedChildId,
        originalSpaceId: sourceSpaceId,
        originalSpaceName: "来源母空间",
        positionNumber: 1,
      }),
    ]);

    const targetSpaceId = saveSpace(repository);
    database.db.prepare("UPDATE team_space SET display_name = '目标母空间' WHERE id = ?").run(targetSpaceId);
    repository.restoreChildSeat({ childSeatId: archivedChildId, targetSpaceId, positionNumber: 1 });

    const oldReceipt = repository.listTransactions().receipts[0]!;
    expect(oldReceipt).toMatchObject({
      spaceId: sourceSpaceId,
      spaceName: "来源母空间",
      childSeatId: archivedChildId,
      canVoid: false,
    });
    expect(() => repository.voidReceipt(oldReceipt.id, "跨母恢复后尝试撤销")).toThrow(/归档、删除或移动/);
    expect(oldReceipt.childLabel).toContain("位置 1");
    const performance = repository.dashboard("2026-08-09").spacePerformance;
    expect(performance.find((item) => item.spaceId === sourceSpaceId)?.collectedNetCnyMinor).toBe(10_000);
    expect(performance.find((item) => item.spaceId === targetSpaceId)?.collectedNetCnyMinor).toBe(0);

    repository.archiveChildSeat(archivedChildId);
    repository.deleteArchivedChildSeat(archivedChildId);
    expect(repository.listArchivedChildSeats("2026-08-09").some((seat) => seat.id === archivedChildId)).toBe(false);
    expect(repository.listTransactions().receipts[0]).toMatchObject({
      spaceId: sourceSpaceId,
      spaceName: "来源母空间",
      childSeatId: archivedChildId,
    });
    expect(database.db.prepare("SELECT deleted_at FROM child_seat WHERE id = ?").get(archivedChildId))
      .toEqual({ deleted_at: expect.any(String) });
    expect(database.db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(database.db.pragma("foreign_key_check")).toEqual([]);
  });

  it("blocks moving a partially paid archived child but allows restoring it to its original slot and undoing the receipt", () => {
    const { repository } = setup();
    const sourceSpaceId = saveSpace(repository);
    const targetSpaceId = saveSpace(repository);
    const childId = saveChild(repository, sourceSpaceId, 1);
    repository.recordReceipt({
      childSeatId: childId,
      grossMinor: 4_000,
      feeBasisPoints: 0,
      receivedAt: "2026-08-09T01:00:00.000Z",
    });
    repository.archiveChildSeat(childId);

    expect(() => repository.restoreChildSeat({ childSeatId: childId, targetSpaceId, positionNumber: 1 }))
      .toThrow(/部分收款/);
    repository.restoreChildSeat({ childSeatId: childId, targetSpaceId: sourceSpaceId, positionNumber: 1 });
    const receipt = repository.listTransactions().receipts[0]!;
    expect(receipt.canVoid).toBe(true);
    repository.voidReceipt(receipt.id, "恢复后核销录入错误");
    expect(repository.listSpaces("2026-08-09").find((space) => space.id === sourceSpaceId)?.childSeats[0])
      .toMatchObject({ pendingFirstReceipt: true, receivedMinor: 0, remainingMinor: 10_000 });
  });

  it("soft-deletes an archived space while keeping its receipts and renewals in the ledger", () => {
    const { database, repository } = setup();
    const spaceId = saveSpace(repository);
    database.db.prepare("UPDATE team_space SET display_name = '待删除母空间' WHERE id = ?").run(spaceId);
    const childId = saveChild(repository, spaceId, 1);
    repository.recordReceipt({
      childSeatId: childId,
      grossMinor: 10_000,
      feeBasisPoints: 60,
      receivedAt: "2026-08-09T01:00:00.000Z",
    });
    repository.renewSpace({
      spaceId,
      frozenUsdMinor: 2_500,
      paidAt: "2026-08-09T02:00:00.000Z",
    });
    repository.archiveSpace(spaceId);
    repository.deleteArchivedSpace(spaceId);

    expect(repository.listSpaces("2026-08-09")).toHaveLength(0);
    expect(repository.listArchivedSpaces("2026-08-09")).toHaveLength(0);
    const deletedReceipt = repository.listTransactions().receipts[0]!;
    expect(deletedReceipt).toMatchObject({
      spaceId,
      spaceName: "待删除母空间",
      canVoid: false,
    });
    const deletedRenewal = repository.listTransactions().renewals[0]!;
    expect(deletedRenewal).toMatchObject({
      spaceId,
      spaceName: "待删除母空间",
      canVoid: false,
    });
    expect(() => repository.voidReceipt(deletedReceipt.id, "软删后尝试撤销")).toThrow(/归档、删除或移动/);
    expect(() => repository.voidRenewal(deletedRenewal.id, "软删后尝试撤销")).toThrow(/归档或删除/);
    expect(repository.dashboard("2026-08-09")).toMatchObject({
      currentMonthGrossCnyMinor: 10_000,
      currentMonthNetCnyMinor: 9_940,
      lifetimeNetCnyMinor: 9_940,
    });
    expect(database.db.prepare("SELECT deleted_at FROM team_space WHERE id = ?").get(spaceId))
      .toEqual({ deleted_at: expect.any(String) });
    expect(database.db.prepare("SELECT deleted_at FROM child_seat WHERE id = ?").get(childId))
      .toEqual({ deleted_at: expect.any(String) });
    expect(database.db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(database.db.pragma("foreign_key_check")).toEqual([]);
  });

  it("does not delete a mother space that would strand an independently archived partial payment", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId, 1);
    repository.recordReceipt({
      childSeatId: childId,
      grossMinor: 4_000,
      feeBasisPoints: 0,
      receivedAt: "2026-08-09T01:00:00.000Z",
    });
    repository.archiveChildSeat(childId);
    repository.archiveSpace(spaceId);

    expect(() => repository.deleteArchivedSpace(spaceId)).toThrow(/尚未结清/);
    expect(repository.listArchivedSpaces("2026-08-09")).toHaveLength(1);
    expect(repository.listArchivedChildSeats("2026-08-09")).toHaveLength(1);
  });

  it("does not allow changing the position while a partial billing cycle is open", () => {
    const { repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId, 1);
    repository.recordReceipt({
      childSeatId: childId,
      grossMinor: 4_000,
      feeBasisPoints: 0,
      receivedAt: "2026-08-09T01:00:00.000Z",
    });

    expect(() => repository.saveChildSeat({
      id: childId, spaceId, positionNumber: 2, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "child-1@example.com", label: "", contact: "", joinedOn: "2026-08-01",
      chargeCurrency: "CNY", chargeMinor: 10_000, paymentDay: 1,
      nextPaymentOn: "2026-09-01", cycleMonths: 1,
    })).toThrow(/部分收款/);
    expect(repository.listSpaces("2026-08-09")[0]?.childSeats[0]).toMatchObject({
      id: childId,
      positionNumber: 1,
      receivedMinor: 4_000,
    });
  });

  it("keeps zero-decimal currency metadata for historical and archived views after soft deletion", () => {
    const { database, repository } = setup();
    repository.saveCurrency({ code: "JPY", name: "日元", symbol: "¥", decimalPlaces: 0, enabled: true });
    database.db.prepare(`
      INSERT INTO exchange_quote(code, units_per_usd, provider, quoted_at)
      VALUES ('JPY', '150', 'test', '2026-08-09T00:00:00.000Z')
    `).run();
    const spaceId = saveSpace(repository);
    const childId = repository.saveChildSeat({
      spaceId, positionNumber: 1, seatKind: "chatgpt", usageKind: "rental",
      customerLogin: "jpy-customer@example.com", label: "", contact: "", joinedOn: "2026-08-01",
      chargeCurrency: "JPY", chargeMinor: 10_000, paymentDay: 1,
      nextPaymentOn: "2026-09-01", cycleMonths: 1,
    });
    expect(() => repository.deleteCurrency("JPY")).toThrow(/有效空间或子位置/);
    repository.recordReceipt({
      childSeatId: childId,
      grossMinor: 10_000,
      feeBasisPoints: 0,
      receivedAt: "2026-08-09T01:00:00.000Z",
    });
    repository.archiveChildSeat(childId);
    repository.deleteCurrency("JPY");

    expect(repository.listCurrencies().some((currency) => currency.code === "JPY")).toBe(false);
    expect(repository.listCurrencies(true).find((currency) => currency.code === "JPY"))
      .toMatchObject({ decimalPlaces: 0, enabled: false });
    expect(repository.listArchivedChildSeats("2026-08-09")[0]).toMatchObject({
      id: childId,
      charge: { minor: 10_000, currency: "JPY" },
    });
    expect(repository.listTransactions().receipts[0]?.gross).toEqual({ minor: 10_000, currency: "JPY" });
    expect(() => repository.restoreChildSeat({ childSeatId: childId, targetSpaceId: spaceId, positionNumber: 1 }))
      .toThrow(/先启用币种/);
    expect(() => repository.deleteCurrency("USD")).toThrow(/不能删除/);
    expect(() => repository.deleteCurrency("CNY")).toThrow(/不能删除/);

    repository.saveCurrency({ code: "JPY", name: "日元", symbol: "¥", decimalPlaces: 0, enabled: true });
    repository.restoreChildSeat({ childSeatId: childId, targetSpaceId: spaceId, positionNumber: 1 });
    expect(repository.listSpaces("2026-08-09")[0]?.childSeats[0]?.id).toBe(childId);
  });

  it("requires payment channels to be archived before deletion and safely detaches archived spaces", () => {
    const { repository } = setup();
    const methodId = repository.savePaymentMethod({ name: "待删除渠道", note: "" });
    const spaceId = saveSpace(repository, [methodId], methodId);

    expect(() => repository.deletePaymentMethod(methodId)).toThrow(/先归档/);
    expect(() => repository.setPaymentMethodArchived(methodId, true)).toThrow(/有效空间/);
    repository.archiveSpace(spaceId);
    repository.setPaymentMethodArchived(methodId, true);
    repository.deletePaymentMethod(methodId);

    expect(repository.listPaymentMethods(true).some((method) => method.id === methodId)).toBe(false);
    repository.unarchiveSpace(spaceId);
    expect(repository.listSpaces("2026-08-09")[0]?.paymentMethods).toEqual([]);
  });

  it("keeps multiple archived occupants for one slot while enforcing one active occupant", () => {
    const { database, repository } = setup();
    const spaceId = saveSpace(repository);

    const first = saveChild(repository, spaceId, 1);
    repository.archiveChildSeat(first);
    const second = saveChild(repository, spaceId, 1);
    repository.archiveChildSeat(second);
    const active = saveChild(repository, spaceId, 1);

    expect(new Set([first, second, active]).size).toBe(3);
    expect(repository.listArchivedChildSeats("2026-08-09").map((seat) => seat.id).sort())
      .toEqual([first, second].sort());
    expect(repository.listSpaces("2026-08-09")[0]?.childSeats.map((seat) => seat.id)).toEqual([active]);
    expect(() => saveChild(repository, spaceId, 1)).toThrow(/相同的位置号/);

    repository.archiveChildSeat(active);
    repository.restoreChildSeat({ childSeatId: first, targetSpaceId: spaceId, positionNumber: 1 });
    expect(repository.listSpaces("2026-08-09")[0]?.childSeats.map((seat) => seat.id)).toEqual([first]);
    expect(repository.listArchivedChildSeats("2026-08-09").map((seat) => seat.id).sort())
      .toEqual([active, second].sort());
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM child_seat
      WHERE space_id = ? AND position_number = 1 AND archived_at IS NULL AND deleted_at IS NULL
    `).get(spaceId)).toEqual({ count: 1 });
    expect(database.db.pragma("foreign_key_check")).toEqual([]);
  });

  it("returns the complete receipt and renewal history beyond the former display caps", () => {
    const { database, repository } = setup();
    const spaceId = saveSpace(repository);
    const childId = saveChild(repository, spaceId);

    repository.recordReceipt({
      childSeatId: childId,
      grossMinor: 10_000,
      feeBasisPoints: 0,
      receivedAt: "2026-08-09T01:00:00.000Z",
    });
    repository.renewSpace({
      spaceId,
      frozenUsdMinor: 2_500,
      paidAt: "2026-08-09T02:00:00.000Z",
    });

    const cloneRows = (table: "receipt" | "renewal_event", count: number) => {
      const template = database.db.prepare(`SELECT * FROM ${table} LIMIT 1`).get() as Record<string, unknown>;
      const columns = Object.keys(template);
      const insert = database.db.prepare(`
        INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")})
        VALUES (${columns.map(() => "?").join(", ")})
      `);
      database.db.transaction(() => {
        for (let index = 0; index < count; index += 1) {
          const instant = new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString();
          const row: Record<string, unknown> = {
            ...template,
            id: `bulk-${table}-${String(index).padStart(3, "0")}`,
            operation_id: null,
            paid_at: instant,
            received_at: instant,
            created_at: instant,
          };
          insert.run(...columns.map((column) => row[column]));
        }
      })();
    };

    cloneRows("receipt", 300);
    cloneRows("renewal_event", 200);

    const history = repository.listTransactions();
    expect(history.receipts).toHaveLength(301);
    expect(history.renewals).toHaveLength(201);
    expect(history.receipts.some((item) => item.id === "bulk-receipt-000")).toBe(true);
    expect(history.renewals.some((item) => item.id === "bulk-renewal_event-000")).toBe(true);
  });
});
