export type Quote = {
  code: string;
  decimalPlaces: number;
  unitsPerUsd: string;
  provider: string;
  quotedAt: string;
};

export function convertCurrencyMinor(
  amountMinor: number,
  source: Pick<Quote, "decimalPlaces" | "unitsPerUsd">,
  target: Pick<Quote, "decimalPlaces" | "unitsPerUsd">,
): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("无效金额");
  const sourceRate = Number(source.unitsPerUsd);
  const targetRate = Number(target.unitsPerUsd);
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error("当前汇率不可用，请先更新汇率");
  }
  const sourceMajor = amountMinor / 10 ** source.decimalPlaces;
  const targetMajor = (sourceMajor / sourceRate) * targetRate;
  return Math.round(targetMajor * 10 ** target.decimalPlaces);
}
