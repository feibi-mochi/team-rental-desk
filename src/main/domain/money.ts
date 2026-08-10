export const ALLOWED_FEE_BASIS_POINTS = [0, 60, 160] as const;
export type FeeBasisPoints = (typeof ALLOWED_FEE_BASIS_POINTS)[number];

export function calculatePlatformFee(
  grossMinor: number,
  feeBasisPoints: number,
): { feeMinor: number; netMinor: number } {
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0) {
    throw new Error("收款金额必须大于 0");
  }
  if (!ALLOWED_FEE_BASIS_POINTS.includes(feeBasisPoints as FeeBasisPoints)) {
    throw new Error("手续费只能选择无手续费、0.6% 或 1.6%");
  }
  const feeMinor = Math.round((grossMinor * feeBasisPoints) / 10_000);
  return { feeMinor, netMinor: grossMinor - feeMinor };
}

export function decimalToScaled(value: string, scale = 1_000_000): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`无效汇率：${value}`);
  return Math.round(numeric * scale);
}

export function convertMinor(
  amountMinor: number,
  sourceUnitsPerUsd: string,
  targetUnitsPerUsd: string,
): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("无效金额");
  const source = decimalToScaled(sourceUnitsPerUsd);
  const target = decimalToScaled(targetUnitsPerUsd);
  return Math.round((amountMinor * target) / source);
}
