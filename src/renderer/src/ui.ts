export const PALETTES = [
  { key: "forest", name: "森林绿", color: "#4f7b61", soft: "#e8f1eb", deep: "#315640" },
  { key: "orange", name: "橙色", color: "#f08a18", soft: "#fff0dc", deep: "#a95300" },
  { key: "red", name: "红色", color: "#d91324", soft: "#ffe7e9", deep: "#99111d" },
  { key: "brick", name: "砖红", color: "#c03a3f", soft: "#fbe8e9", deep: "#84262b" },
  { key: "magenta", name: "洋红", color: "#b4005a", soft: "#f8e3ed", deep: "#79003d" },
  { key: "pink", name: "玫红", color: "#a80088", soft: "#f4e4f1", deep: "#70005b" },
  { key: "purple", name: "紫色", color: "#8b109b", soft: "#f0e4f2", deep: "#5d0968" },
  { key: "violet", name: "淡紫", color: "#7354ad", soft: "#ece8f5", deep: "#4d3875" },
  { key: "green", name: "绿色", color: "#4f9349", soft: "#e8f4e6", deep: "#31652d" },
  { key: "olive", name: "橄榄绿", color: "#46851f", soft: "#eaf3e3", deep: "#2d5a13" },
  { key: "blue", name: "蓝色", color: "#3e6fbd", soft: "#e6edf9", deep: "#284d88" },
  { key: "indigo", name: "靛蓝", color: "#6865d4", soft: "#ebeafa", deep: "#44419b" },
  { key: "lavender", name: "薰衣草", color: "#8e8bd7", soft: "#efeffa", deep: "#5f5c9c" },
  { key: "teal", name: "蓝绿", color: "#4c897f", soft: "#e3f0ed", deep: "#2c665d" },
  { key: "slate", name: "灰蓝", color: "#5989a5", soft: "#e8f0f4", deep: "#385f76" },
  { key: "stone", name: "岩灰", color: "#837a67", soft: "#f0ede7", deep: "#5a5345" },
  { key: "graphite", name: "石墨", color: "#5a5a5a", soft: "#ededed", deep: "#363636" },
  { key: "black", name: "黑色", color: "#191919", soft: "#ebebeb", deep: "#000000" },
] as const;

export function applyPalette(key: string): void {
  const palette = PALETTES.find((item) => item.key === key) ?? PALETTES.find((item) => item.key === "teal")!;
  const root = document.documentElement;
  root.style.setProperty("--accent", palette.color);
  root.style.setProperty("--accent-soft", palette.soft);
  root.style.setProperty("--accent-deep", palette.deep);
  root.dataset.palette = palette.key;
}

export function formatMoney(minor: number, code: string, decimals = 2): string {
  const amount = minor / 10 ** decimals;
  if (code === "USDT") return `₮${amount.toFixed(decimals)} USDT`;
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return `${amount.toFixed(decimals)} ${code}`;
  }
}

export function majorToMinor(value: string, decimals: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error("请输入有效金额");
  const scaled = numeric * 10 ** decimals;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-8) throw new Error(`该币种最多只能输入 ${decimals} 位小数`);
  return Math.round(scaled);
}

export function minorToInput(minor: number, decimals: number): string {
  return (minor / 10 ** decimals).toFixed(decimals);
}

export function amountStep(decimals: number): string {
  return decimals <= 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}

export function localDateTimeInputValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message.replace(/^Error invoking remote method '[^']+': /, "");
  return String(reason);
}
