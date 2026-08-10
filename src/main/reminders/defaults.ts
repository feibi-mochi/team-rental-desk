export type ReminderKind = "space" | "child";

export const DEFAULT_SPACE_SUBJECT = "Team 出租管理｜{{count}} 个空间需要处理";
export const DEFAULT_CHILD_SUBJECT = "Team 出租管理｜{{count}} 个子位置需要收款";
export const DEFAULT_SPACE_BODY = "请及时核对续费、支付渠道和最终付款金额。";
export const DEFAULT_CHILD_BODY = "请及时联系客户，并在收到款项后记录实际收款。";

const LEGACY_PLACEHOLDER = /\{(?:spaceName|expiryDate|daysUntilExpiryText|paymentChannelName|amountUsd|amountCny|amountUsdt|rateReferenceNote|childAccountEmail|contact|nextPaymentDate|amount|currencyCode)\}/;

export function defaultSubject(kind: ReminderKind): string {
  return kind === "space" ? DEFAULT_SPACE_SUBJECT : DEFAULT_CHILD_SUBJECT;
}

export function defaultBody(kind: ReminderKind): string {
  return kind === "space" ? DEFAULT_SPACE_BODY : DEFAULT_CHILD_BODY;
}

export function normalizeReminderSubject(value: string | null | undefined, kind: ReminderKind): string {
  const trimmed = value?.trim() ?? "";
  return !trimmed || LEGACY_PLACEHOLDER.test(trimmed) ? defaultSubject(kind) : trimmed;
}

export function normalizeReminderBody(value: string | null | undefined, kind: ReminderKind): string {
  const trimmed = value?.trim() ?? "";
  return !trimmed || LEGACY_PLACEHOLDER.test(trimmed) || /<\/?[a-z][^>]*>/i.test(trimmed)
    ? defaultBody(kind)
    : trimmed;
}
