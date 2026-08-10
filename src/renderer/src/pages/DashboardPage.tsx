import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  Banknote,
  CalendarDays,
  CircleDollarSign,
  Coins,
  ExternalLink,
  Landmark,
  Layers3,
  RefreshCw,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import type {
  ChildSeatView,
  CurrencyView,
  DashboardSnapshot,
  LocalShortcutView,
  NavigationSection,
  SpaceListItem,
} from "../../../shared/contracts";
import { ReceiptModal, RenewalModal } from "../components/BusinessModals";
import { errorMessage, formatMoney } from "../ui";

type DashboardBundle = {
  snapshot: DashboardSnapshot;
  spaces: SpaceListItem[];
  currencies: CurrencyView[];
  shortcuts: LocalShortcutView[];
};

const expiryLabels = { normal: "正常", soon: "即将到期", today: "今天到期", overdue: "已过期" } as const;
const collectionLabels = {
  none: "",
  new_customer: "新客户，待记账",
  pending: "待收款",
  partial: "部分收款",
} as const;

function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${year} 年 ${Number(number)} 月`;
}

function usdtReference(usdMinor: number | null, currency: CurrencyView | undefined): string | null {
  if (usdMinor === null || !currency?.unitsPerUsd) return null;
  const units = Number(currency.unitsPerUsd);
  if (!Number.isFinite(units)) return null;
  const minor = Math.round((usdMinor / 100) * units * 10 ** currency.decimalPlaces);
  return formatMoney(minor, "USDT", currency.decimalPlaces);
}

export function DashboardPage(props: {
  refreshToken: number;
  onChanged: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onNavigate: (section: NavigationSection) => void;
  onOpenSpace: (spaceId: string) => void;
}) {
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [receipt, setReceipt] = useState<ChildSeatView | null>(null);
  const [renewal, setRenewal] = useState<SpaceListItem | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      window.teamRental.dashboard(),
      window.teamRental.listSpaces(),
      window.teamRental.listCurrencies(),
      window.teamRental.listShortcuts(),
    ]).then(([snapshot, spaces, currencies, shortcuts]) => {
      if (active) setBundle({ snapshot, spaces, currencies, shortcuts });
    }).catch((error) => props.onError(errorMessage(error)));
    return () => { active = false; };
  }, [props.refreshToken]);

  useEffect(() => {
    const content = document.querySelector<HTMLElement>(".content");
    const section = document.getElementById("dashboard-attention");
    const header = section?.querySelector<HTMLElement>(".dashboard-section-header");
    if (!content || !section || !header) return;
    const placeholder = document.createElement("div");
    placeholder.className = "dashboard-section-header-placeholder";
    let stuck = false;
    const update = () => {
      const contentRect = content.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      const headerHeight = header.offsetHeight;
      const contentStyle = getComputedStyle(content);
      const padLeft = parseFloat(contentStyle.paddingLeft) || 0;
      const padRight = parseFloat(contentStyle.paddingRight) || 0;
      const shouldStick = sectionRect.top < contentRect.top && sectionRect.bottom > contentRect.top + headerHeight;
      if (shouldStick && !stuck) {
        stuck = true;
        placeholder.style.height = `${headerHeight}px`;
        header.parentNode?.insertBefore(placeholder, header);
        header.classList.add("stuck");
      } else if (!shouldStick && stuck) {
        stuck = false;
        header.classList.remove("stuck");
        placeholder.remove();
      }
      if (stuck) {
        header.style.left = `${contentRect.left + padLeft}px`;
        header.style.width = `${contentRect.width - padLeft - padRight}px`;
        header.style.top = `${contentRect.top}px`;
      }
    };
    content.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(content);
    update();
    return () => {
      content.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
      header.classList.remove("stuck");
      placeholder.remove();
    };
  }, [bundle !== null]);

  const currencyMap = useMemo(() => new Map((bundle?.currencies ?? []).map((item) => [item.code, item])), [bundle?.currencies]);
  if (!bundle) return <section className="empty-card">正在整理经营数据…</section>;

  const { snapshot: data, spaces, shortcuts } = bundle;
  const dueSpaces = spaces
    .filter((space) => space.expiryStatus !== "normal")
    .sort((left, right) => left.renewsOn.localeCompare(right.renewsOn) || left.displayName.localeCompare(right.displayName, "zh-CN"));
  const dueChildren = spaces.flatMap((space) => space.childSeats.map((child) => ({ space, child })))
    .filter(({ child }) => child.usageKind === "rental" && child.collectionStatus !== "none")
    .sort((left, right) => left.child.nextPaymentOn.localeCompare(right.child.nextPaymentOn)
      || left.space.displayName.localeCompare(right.space.displayName, "zh-CN")
      || left.child.positionNumber - right.child.positionNumber);
  const shortcutBySpace = new Map<string, LocalShortcutView>();
  for (const shortcut of shortcuts) {
    if (shortcut.spaceId && shortcut.available && !shortcutBySpace.has(shortcut.spaceId)) shortcutBySpace.set(shortcut.spaceId, shortcut);
  }

  const financial = [
    { label: "月均应收", value: data.monthlyReceivableCnyMinor, note: "所有出租位置按周期折算", icon: Coins },
    { label: "本月毛收入", value: data.currentMonthGrossCnyMinor, note: "你实际输入的收款总额", icon: Banknote },
    { label: "本月实际收入", value: data.currentMonthNetCnyMinor, note: "已扣除所选平台手续费", icon: CircleDollarSign },
    { label: "累计实际收入", value: data.lifetimeNetCnyMinor, note: "所有月份净收入相加", icon: TrendingUp },
    { label: "预计月均利润", value: data.projectedMonthlyProfitCnyMinor, note: `月均成本 ${formatMoney(data.monthlyCostCnyMinor, "CNY")}`, icon: Landmark },
  ];
  const childStats = [
    ["当前出租", data.child.rented, "good"],
    ["当前正常", data.child.normal, "good"],
    ["即将到期", data.child.soon, "warn"],
    ["今天到期", data.child.today, "danger"],
    ["已过期", data.child.overdue, "danger"],
    ["本月已收款", data.child.collectedThisMonth, "good"],
  ] as const;
  const motherStats = [
    ["母号总数", data.mother.total, "good"],
    ["母号正常", data.mother.normal, "good"],
    ["即将到期", data.mother.soon, "warn"],
    ["今天到期", data.mother.today, "danger"],
    ["已过期", data.mother.overdue, "danger"],
    ["本月已续费", data.mother.renewedThisMonth, "good"],
    ["已覆盖成本", data.costCoverage.covered, "good"],
    ["未覆盖成本", data.costCoverage.uncovered, data.costCoverage.uncovered ? "warn" : "good"],
  ] as const;

  const afterReceipt = () => {
    props.onNotice("收款已经记录，运营概览已更新。 ");
    props.onChanged();
  };
  const afterRenewal = () => {
    props.onNotice("续费已经记录，到期日与冻结成本已更新。 ");
    props.onChanged();
  };
  const openShortcut = async (shortcut: LocalShortcutView) => {
    try {
      await window.teamRental.openShortcut(shortcut.id);
      props.onNotice(`已打开 ${shortcut.label}。`);
    } catch (error) {
      props.onError(errorMessage(error));
    }
  };

  return <>
    <section className="section-heading compact dashboard-heading">
      <div>
        <h2>经营概览</h2>
        <p>重要数字、待处理事项和实际收入历史集中在这一页。</p>
      </div>
      <div className="dashboard-heading-actions">
        <span className="as-of">统计日期 {data.asOf}</span>
        <button className="button secondary compact" onClick={() => props.onNavigate("spaces")}>管理空间<ArrowRight size={15} /></button>
      </div>
    </section>

    <section className="financial-grid">
      {financial.map((item) => {
        const Icon = item.icon;
        return <article key={item.label} className="financial-card">
          <div className="metric-icon"><Icon size={18} /></div>
          <span>{item.label}</span>
          <strong>{formatMoney(item.value, "CNY")}</strong>
          <small>{item.note}</small>
        </article>;
      })}
    </section>

    <div className="dashboard-status-columns">
      <section className="stats-panel">
        <div className="stats-title"><UsersRound size={18} /><strong>子位置状态</strong></div>
        <div className="status-grid child-metrics">
          {childStats.map(([label, value, tone]) => <div key={label}><span>{label}</span><strong className={tone}>{value}</strong></div>)}
        </div>
      </section>
      <section className="stats-panel">
        <div className="stats-title"><Layers3 size={18} /><strong>母号与成本</strong></div>
        <div className="status-grid mother-metrics">
          {motherStats.map(([label, value, tone]) => <div key={label}><span>{label}</span><strong className={tone}>{value}</strong></div>)}
        </div>
      </section>
    </div>

    <section className="dashboard-section" id="dashboard-attention">
      <header className="dashboard-section-header">
        <div>
          <h2>近期需要处理</h2>
          <p>这里可以直接打开绑定快捷方式、续费空间或记录子位置收款。</p>
        </div>
        <div className="attention-counts">
          <span><RefreshCw size={14} />待续费 {dueSpaces.length}</span>
          <span><BadgeDollarSign size={14} />待记账/收款 {dueChildren.length}</span>
        </div>
      </header>
      <div className="work-columns">
        <article className="work-card">
          <header><div><RefreshCw size={17} /><strong>空间续费</strong></div><span>未来 {data.thresholds.spaceSoonDays} 天</span></header>
          <div className="work-list">
            {dueSpaces.length === 0 ? <div className="work-empty">当前没有需要处理的空间续费。</div> : dueSpaces.map((space) => {
              const shortcut = shortcutBySpace.get(space.id);
              const usdt = usdtReference(space.sourceCostUsdMinor, currencyMap.get("USDT"));
              const originalDecimals = currencyMap.get(space.sourceCost.currency)?.decimalPlaces ?? 2;
              return <div className="work-row space-work-row" key={space.id}>
                <div className="work-identity">
                  <div><span className={`status-badge ${space.expiryStatus}`}>{expiryLabels[space.expiryStatus]}</span><strong>{space.displayName}</strong><span className={`service-badge ${space.serviceKind}`}>{space.serviceKind === "codex" ? "Codex" : "ChatGPT"}</span></div>
                  <small>{space.paymentMethods.find((item) => item.isDefault)?.name ?? "未设置默认支付渠道"}</small>
                </div>
                <div className="work-date"><span>到期日</span><strong>{space.renewsOn}</strong></div>
                <div className="work-money">
                  <strong>{formatMoney(space.sourceCost.minor, space.sourceCost.currency, originalDecimals)}</strong>
                  <small>{space.sourceCostUsdMinor === null ? "尚未冻结成本" : `${formatMoney(space.sourceCostUsdMinor, "USD")} · ${formatMoney(space.sourceCostCnyMinor ?? 0, "CNY")}${usdt ? ` · ${usdt}` : ""}`}</small>
                </div>
                <div className="action-row work-actions">
                  {shortcut ? <button className="icon-button" title="打开绑定快捷方式" aria-label={`打开 ${space.displayName} 的绑定快捷方式`} onClick={() => void openShortcut(shortcut)}><ExternalLink size={17} /></button> : null}
                  <button className="button secondary compact" onClick={() => props.onOpenSpace(space.id)}>查看母号<ArrowRight size={15} /></button>
                  <button className="button secondary compact" onClick={() => setRenewal(space)}><RefreshCw size={15} />续费</button>
                </div>
              </div>;
            })}
          </div>
        </article>

        <article className="work-card">
          <header><div><BadgeDollarSign size={17} /><strong>出租位置收款</strong></div><span>未来 {data.thresholds.childSoonDays} 天</span></header>
          <div className="work-list">
            {dueChildren.length === 0 ? <div className="work-empty">当前没有需要记账或收款的子位置。</div> : dueChildren.map(({ space, child }) => {
              const decimals = currencyMap.get(child.charge.currency)?.decimalPlaces ?? 2;
              return <div className="work-row child-work-row" key={child.id}>
                <div className="work-identity">
                  <div><span className={`collection-badge ${child.collectionStatus}`}>{collectionLabels[child.collectionStatus]}</span><strong>{space.displayName} · 位置 {child.positionNumber}</strong></div>
                  <small>{child.customerLogin}{child.contact ? ` · ${child.contact}` : ""}</small>
                </div>
                <div className="work-date"><span>付款日</span><strong>{child.nextPaymentOn}</strong></div>
                <div className="work-money">
                  <strong>{formatMoney(child.remainingMinor, child.charge.currency, decimals)}</strong>
                  <small>{child.collectionStatus === "partial" ? `已收 ${formatMoney(child.receivedMinor, child.charge.currency, decimals)}` : `本期应收 ${formatMoney(child.charge.minor, child.charge.currency, decimals)}`}</small>
                </div>
                <div className="action-row work-actions">
                  <button className="button secondary compact" onClick={() => props.onOpenSpace(space.id)}>查看母号<ArrowRight size={15} /></button>
                  <button className="button primary compact" onClick={() => setReceipt(child)}><BadgeDollarSign size={15} />记录收款</button>
                </div>
              </div>;
            })}
          </div>
        </article>
      </div>
    </section>

    <div className="dashboard-analytics-columns">
      <section className="dashboard-section analytics-card">
        <header className="dashboard-section-header">
          <div><h2><CalendarDays size={18} />每月实际收入</h2><p>按实际收款时间归属月份，实际收入已扣除手续费。</p></div>
          <span className="as-of">共 {data.monthlyIncome.length} 个月</span>
        </header>
        {data.monthlyIncome.length === 0 ? <div className="work-empty large">记录第一笔收款后，这里会自动生成明细。</div> : <div className="dashboard-table-scroll">
          <table className="dashboard-table">
            <thead><tr><th>月份</th><th>子位置</th><th>笔数</th><th>毛收入</th><th>实际收入</th><th>USD 参考</th></tr></thead>
            <tbody>{data.monthlyIncome.map((item) => <tr key={item.month}>
              <td>{monthLabel(item.month)}</td><td>{item.childSeatCount}</td><td>{item.receiptCount}</td>
              <td>{formatMoney(item.grossCnyMinor, "CNY")}</td><td className="positive-money">{formatMoney(item.netCnyMinor, "CNY")}</td><td>{formatMoney(item.netUsdMinor, "USD")}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>

      <section className="dashboard-section analytics-card">
        <header className="dashboard-section-header">
          <div><h2><Landmark size={18} />空间收益表现</h2><p>比较每个空间的月均成本、应收和本月实际收款。</p></div>
          <span className="as-of">共 {data.spacePerformance.length} 个空间</span>
        </header>
        <div className="performance-list">
          {data.spacePerformance.map((item) => {
            const progress = item.monthlyCostCnyMinor <= 0 ? 100 : Math.min(100, Math.round(item.collectedNetCnyMinor / item.monthlyCostCnyMinor * 100));
            return <article className="performance-row" key={item.spaceId}>
              <div className="performance-title">
                <div><strong>{item.displayName}</strong><span className={`service-badge ${item.serviceKind}`}>{item.serviceKind === "codex" ? "Codex" : "ChatGPT"}</span></div>
                <span className={item.costCovered ? "coverage-badge covered" : "coverage-badge uncovered"}>{item.costCovered ? "已覆盖成本" : "未覆盖成本"}</span>
              </div>
              <div className="performance-values">
                <span>出租 <strong>{item.rentedChildSeats}</strong></span>
                <span>月均成本 <strong>{formatMoney(item.monthlyCostCnyMinor, "CNY")}</strong></span>
                <span>月均应收 <strong>{formatMoney(item.monthlyRevenueCnyMinor, "CNY")}</strong></span>
                <span>预计利润 <strong className={item.projectedProfitCnyMinor < 0 ? "negative-money" : "positive-money"}>{formatMoney(item.projectedProfitCnyMinor, "CNY")}</strong></span>
              </div>
              <div className="coverage-line"><i style={{ width: `${progress}%` }} /><span>本月实际收款 {formatMoney(item.collectedNetCnyMinor, "CNY")} · 成本覆盖 {progress}%</span></div>
            </article>;
          })}
        </div>
      </section>
    </div>

    {receipt ? <ReceiptModal child={receipt} currency={currencyMap.get(receipt.charge.currency)} onClose={() => setReceipt(null)} onSaved={afterReceipt} onError={props.onError} /> : null}
    {renewal ? <RenewalModal space={renewal} onClose={() => setRenewal(null)} onSaved={afterRenewal} onError={props.onError} /> : null}
  </>;
}
