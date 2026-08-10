export type NavigationSection =
  | "dashboard"
  | "spaces"
  | "archived_spaces"
  | "archived_children"
  | "transactions"
  | "shortcuts"
  | "channels"
  | "currencies"
  | "settings";

export type ServiceKind = "chatgpt" | "codex";
export type UsageKind = "rental" | "self_use";
export type ExpiryStatus = "normal" | "soon" | "today" | "overdue";
export type CollectionStatus =
  | "none"
  | "new_customer"
  | "pending"
  | "partial";

export type MoneyView = {
  minor: number;
  currency: string;
};

export type PaymentMethodView = {
  id: string;
  name: string;
  note: string;
  archived: boolean;
};

export type CurrencyView = {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  enabled: boolean;
  unitsPerUsd: string | null;
  provider: string | null;
  quotedAt: string | null;
};

export type CurrencyInput = {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  enabled: boolean;
};

export type ChildSeatView = {
  id: string;
  spaceId: string;
  positionNumber: number;
  seatKind: ServiceKind;
  usageKind: UsageKind;
  customerLogin: string;
  label: string;
  contact: string;
  joinedOn: string;
  charge: MoneyView;
  paymentDay: number;
  nextPaymentOn: string;
  cycleMonths: number;
  pendingFirstReceipt: boolean;
  expiryStatus: ExpiryStatus;
  collectionStatus: CollectionStatus;
  receivedMinor: number;
  remainingMinor: number;
};

export type ArchivedChildSeatView = ChildSeatView & {
  originalSpaceId: string;
  originalSpaceName: string;
  archivedAt: string;
};

export type RestoreChildSeatInput = {
  childSeatId: string;
  targetSpaceId: string;
  positionNumber: 1 | 2;
};

export type SpaceListItem = {
  id: string;
  displayName: string;
  serviceKind: ServiceKind;
  ownerLogin: string;
  countryCode: string;
  sourceCost: MoneyView;
  sourceCostUsdMinor: number | null;
  sourceCostCnyMinor: number | null;
  openedOn: string;
  currentCycleStartedOn: string;
  renewsOn: string;
  renewalAnchorDay: number;
  cycleMonths: number;
  expiryStatus: ExpiryStatus;
  motherSeatKind: ServiceKind;
  motherSeatFlexible: boolean;
  paymentMethods: Array<PaymentMethodView & { isDefault: boolean }>;
  childSeats: ChildSeatView[];
};

export type SpaceInput = {
  id?: string;
  displayName: string;
  serviceKind: ServiceKind;
  ownerLogin: string;
  countryCode: string;
  sourceCurrency: string;
  sourceCostMinor: number;
  openedOn: string;
  currentCycleStartedOn: string;
  renewsOn: string;
  renewalAnchorDay: number;
  cycleMonths: number;
  motherSeatKind: ServiceKind;
  motherSeatFlexible: boolean;
  paymentMethodIds: string[];
  defaultPaymentMethodId: string | null;
};

export type ChildSeatInput = {
  id?: string;
  spaceId: string;
  positionNumber: number;
  seatKind: ServiceKind;
  usageKind: UsageKind;
  customerLogin: string;
  label: string;
  contact: string;
  joinedOn: string;
  chargeCurrency: string;
  chargeMinor: number;
  paymentDay: number;
  nextPaymentOn: string;
  cycleMonths: number;
};

export type ReceiptInput = {
  operationId?: string;
  childSeatId: string;
  grossMinor: number;
  feeBasisPoints: 0 | 60 | 160;
  receivedAt: string;
};

export type RenewalInput = {
  operationId?: string;
  spaceId: string;
  frozenUsdMinor: number;
  paidAt: string;
};

export type ReceiptHistoryView = {
  id: string;
  spaceId: string;
  spaceName: string;
  childSeatId: string;
  childLabel: string;
  gross: MoneyView;
  feeBasisPoints: 0 | 60 | 160;
  net: MoneyView;
  receivedAt: string;
  voidedAt: string | null;
  voidReason: string;
  canVoid: boolean;
};

export type RenewalHistoryView = {
  id: string;
  spaceId: string;
  spaceName: string;
  previousRenewsOn: string;
  nextRenewsOn: string;
  frozenUsdMinor: number;
  frozenCnyMinor: number;
  paidAt: string;
  voidedAt: string | null;
  voidReason: string;
  canVoid: boolean;
};

export type TransactionHistory = {
  receipts: ReceiptHistoryView[];
  renewals: RenewalHistoryView[];
};

export type DashboardMonthlyIncome = {
  month: string;
  grossCnyMinor: number;
  netCnyMinor: number;
  netUsdMinor: number;
  receiptCount: number;
  childSeatCount: number;
};

export type DashboardSpacePerformance = {
  spaceId: string;
  displayName: string;
  serviceKind: ServiceKind;
  rentedChildSeats: number;
  monthlyRevenueCnyMinor: number;
  monthlyCostCnyMinor: number;
  projectedProfitCnyMinor: number;
  collectedNetCnyMinor: number;
  costCovered: boolean;
};

export type DashboardSnapshot = {
  asOf: string;
  monthlyReceivableCnyMinor: number;
  currentMonthGrossCnyMinor: number;
  currentMonthNetCnyMinor: number;
  lifetimeNetCnyMinor: number;
  monthlyCostCnyMinor: number;
  projectedMonthlyProfitCnyMinor: number;
  child: {
    rented: number;
    normal: number;
    soon: number;
    today: number;
    overdue: number;
    collectedThisMonth: number;
  };
  mother: {
    total: number;
    normal: number;
    soon: number;
    today: number;
    overdue: number;
    renewedThisMonth: number;
  };
  costCoverage: { covered: number; uncovered: number };
  thresholds: { spaceSoonDays: number; childSoonDays: number };
  monthlyIncome: DashboardMonthlyIncome[];
  spacePerformance: DashboardSpacePerformance[];
};

export type BackupSettings = {
  directory: string;
  onClose: boolean;
  intervalEnabled: boolean;
  intervalMinutes: number;
  retentionCount: number;
};

export type BackupResult = {
  directory: string;
  integrity: string;
  foreignKeyErrors: number;
  createdAt: string;
};

export type LegacyImportResult = {
  spaces: number;
  motherAccounts: number;
  childSeats: number;
  paymentMethods: number;
  receipts: number;
  backupDirectory: string;
};

export type RateRefreshResult = {
  updated: number;
  skipped: string[];
  provider: string;
  quotedAt: string;
};

export type ReminderGroupSettings = {
  enabled: boolean;
  scheduledEnabled: boolean;
  startupCheckEnabled: boolean;
  repeatSameDayEnabled: boolean;
  recipientEmail: string;
  sendTime: string;
  thresholdDays: number;
  smtpUrl: string;
  smtpFrom: string;
  templateSubject: string;
  templateBody: string;
};

export type ReminderSettings = {
  loginStartupCheckEnabled: boolean;
  windowsNotificationEnabled: boolean;
  space: ReminderGroupSettings;
  child: ReminderGroupSettings;
};

export type ReminderRunResult = {
  spaces: number;
  children: number;
  emailsSent: number;
  windowsNotifications: number;
};

export type LocalShortcutView = {
  id: string;
  label: string;
  targetPath: string;
  spaceId: string | null;
  available: boolean;
};

export type ChromeProfileView = {
  directory: string;
  displayName: string;
  account: string;
};

export type ChromeShortcutInput = {
  label: string;
  profileDirectory: string;
  url: string;
  spaceId: string | null;
};

export type DatabaseSummary = {
  path: string;
  schemaVersion: number;
  spaces: number;
  motherAccounts: number;
  childSeats: number;
  paymentChannels: number;
};

export type PlatformCapabilities = {
  chromeProfileShortcuts: boolean;
  nativeNotifications: boolean;
  startupCheck: boolean;
};

export type AppBootstrap = {
  appVersion: string;
  platform: string;
  platformCapabilities: PlatformCapabilities;
  database: DatabaseSummary;
  palette: string;
};

export type AuthStatus = {
  unlocked: boolean;
  retryAfterSeconds: number;
  requiresPasswordSetup: boolean;
};

export type SecuritySettings = {
  requirePasswordOnStartup: boolean;
  passwordUsesLegacyHash: boolean;
};

export type TeamRentalApi = {
  authStatus(): Promise<AuthStatus>;
  unlock(password: string): Promise<AuthStatus>;
  setupPassword(password: string): Promise<AuthStatus>;
  getSecuritySettings(): Promise<SecuritySettings>;
  saveSecuritySettings(settings: SecuritySettings): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  bootstrap(): Promise<AppBootstrap>;
  dashboard(): Promise<DashboardSnapshot>;
  listSpaces(): Promise<SpaceListItem[]>;
  listArchivedSpaces(): Promise<SpaceListItem[]>;
  listArchivedChildSeats(): Promise<ArchivedChildSeatView[]>;
  saveSpace(input: SpaceInput): Promise<string>;
  archiveSpace(id: string): Promise<void>;
  unarchiveSpace(id: string): Promise<void>;
  deleteArchivedSpace(id: string): Promise<void>;
  saveChildSeat(input: ChildSeatInput): Promise<string>;
  archiveChildSeat(id: string): Promise<void>;
  restoreChildSeat(input: RestoreChildSeatInput): Promise<void>;
  deleteArchivedChildSeat(id: string): Promise<void>;
  recordReceipt(input: ReceiptInput): Promise<void>;
  renewSpace(input: RenewalInput): Promise<void>;
  listTransactions(): Promise<TransactionHistory>;
  voidReceipt(id: string, reason: string): Promise<void>;
  voidRenewal(id: string, reason: string): Promise<void>;
  listPaymentMethods(includeArchived?: boolean): Promise<PaymentMethodView[]>;
  savePaymentMethod(input: { id?: string; name: string; note: string }): Promise<string>;
  setPaymentMethodArchived(id: string, archived: boolean): Promise<void>;
  deletePaymentMethod(id: string): Promise<void>;
  listCurrencies(includeDeleted?: boolean): Promise<CurrencyView[]>;
  saveCurrency(input: CurrencyInput): Promise<void>;
  deleteCurrency(code: string): Promise<void>;
  refreshRates(): Promise<RateRefreshResult>;
  getReminderSettings(): Promise<ReminderSettings>;
  saveReminderSettings(settings: ReminderSettings): Promise<void>;
  sendTestReminder(kind: "space" | "child"): Promise<void>;
  sendTestWindowsNotification(): Promise<void>;
  listShortcuts(): Promise<LocalShortcutView[]>;
  listChromeProfiles(): Promise<ChromeProfileView[]>;
  createChromeShortcut(input: ChromeShortcutInput): Promise<string>;
  saveShortcut(input: { id?: string; label: string; targetPath: string; spaceId: string | null }): Promise<string>;
  deleteShortcut(id: string): Promise<void>;
  chooseShortcutTarget(): Promise<string | null>;
  openShortcut(id: string): Promise<void>;
  savePalette(palette: string): Promise<void>;
  getBackupSettings(): Promise<BackupSettings>;
  saveBackupSettings(settings: BackupSettings): Promise<void>;
  chooseBackupDirectory(): Promise<string | null>;
  runBackup(): Promise<BackupResult>;
  chooseLegacyDatabase(): Promise<string | null>;
  importLegacyDatabase(path: string): Promise<LegacyImportResult>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
};
