import { z } from "zod";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1).max(100);
const currency = z.string().regex(/^[A-Z0-9]{2,10}$/);

export const spaceInputSchema = z.object({
  id: id.optional(),
  displayName: z.string().trim().min(1).max(100),
  serviceKind: z.enum(["chatgpt", "codex"]),
  ownerLogin: z.string().trim().min(1).max(254),
  countryCode: z.string().trim().min(1).max(20),
  sourceCurrency: currency,
  sourceCostMinor: z.number().int().positive().safe(),
  openedOn: localDate,
  currentCycleStartedOn: localDate,
  renewsOn: localDate,
  renewalAnchorDay: z.number().int().min(1).max(31),
  cycleMonths: z.number().int().min(1).max(36),
  motherSeatKind: z.enum(["chatgpt", "codex"]),
  motherSeatFlexible: z.boolean(),
  paymentMethodIds: z.array(id).max(4),
  defaultPaymentMethodId: id.nullable(),
});

export const childSeatInputSchema = z.object({
  id: id.optional(),
  spaceId: id,
  positionNumber: z.number().int().min(1).max(2),
  seatKind: z.enum(["chatgpt", "codex"]),
  usageKind: z.enum(["rental", "self_use"]),
  customerLogin: z.string().trim().min(1).max(254),
  label: z.string().trim().max(100),
  contact: z.string().trim().max(200),
  joinedOn: localDate,
  chargeCurrency: currency,
  chargeMinor: z.number().int().nonnegative().safe(),
  paymentDay: z.number().int().min(1).max(31),
  nextPaymentOn: localDate,
  cycleMonths: z.number().int().min(1).max(36),
}).superRefine((value, context) => {
  if (value.usageKind === "rental" && value.chargeMinor <= 0) {
    context.addIssue({ code: "custom", path: ["chargeMinor"], message: "出租位置的收费金额必须大于 0" });
  }
});

export const receiptInputSchema = z.object({
  operationId: z.string().uuid().optional(),
  childSeatId: id,
  grossMinor: z.number().int().positive().safe(),
  feeBasisPoints: z.union([z.literal(0), z.literal(60), z.literal(160)]),
  receivedAt: z.string().datetime({ offset: true }),
});

export const renewalInputSchema = z.object({
  operationId: z.string().uuid().optional(),
  spaceId: id,
  frozenUsdMinor: z.number().int().positive().safe(),
  paidAt: z.string().datetime({ offset: true }),
});

export const paymentMethodInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500),
});
