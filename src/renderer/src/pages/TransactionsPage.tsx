import { useEffect, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { CurrencyView, TransactionHistory } from "../../../shared/contracts";
import { Modal } from "../components/Modal";
import { errorMessage, formatMoney } from "../ui";

type VoidTarget = { kind: "receipt" | "renewal"; id: string; label: string };

function localTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function TransactionsPage(props: {
  refreshToken: number;
  onChanged: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [history, setHistory] = useState<TransactionHistory>({ receipts: [], renewals: [] });
  const [currencies, setCurrencies] = useState<CurrencyView[]>([]);
  const [target, setTarget] = useState<VoidTarget | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const decimals = useMemo(() => new Map(currencies.map((item) => [item.code, item.decimalPlaces])), [currencies]);
  const load = async () => {
    try {
      const [transactions, units] = await Promise.all([window.teamRental.listTransactions(), window.teamRental.listCurrencies(true)]);
      setHistory(transactions);
      setCurrencies(units);
    } catch (error) {
      props.onError(errorMessage(error));
    }
  };
  useEffect(() => { void load(); }, [props.refreshToken]);
  const submitVoid = async () => {
    if (!target || reason.trim().length < 2) return;
    setBusy(true);
    try {
      if (target.kind === "receipt") await window.teamRental.voidReceipt(target.id, reason);
      else await window.teamRental.voidRenewal(target.id, reason);
      setTarget(null);
      setReason("");
      await load();
      props.onChanged();
      props.onNotice("记录已撤销，运营概览和账期已经同步恢复");
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <section className="section-heading"><div><h2>收款与续费记录</h2><p>查看收款和续费历史；输错时从最后一笔开始撤销，再按正确金额和时间重新记录。</p></div></section>
    <section className="dashboard-section">
      <header className="dashboard-section-header"><div><h2>子位置收款</h2><p>撤销不会删除历史，会保留原因并重新计算账期。</p></div><span className="attention-counts"><span>{history.receipts.length} 条</span></span></header>
      <div className="space-table-shell transaction-scroll-shell receipt-scroll-shell"><table className="transaction-table receipt-table"><thead><tr><th>空间 / 子位置</th><th>毛收入</th><th>净收入</th><th>实际收款时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {history.receipts.map((item) => <tr key={item.id} className={item.voidedAt ? "voided-row" : ""}>
          <td><strong>{item.spaceName}</strong><small className="table-subline">{item.childLabel}</small></td>
          <td>{formatMoney(item.gross.minor, item.gross.currency, decimals.get(item.gross.currency))}</td>
          <td>{formatMoney(item.net.minor, item.net.currency, decimals.get(item.net.currency))}</td>
          <td>{localTime(item.receivedAt)}</td>
          <td>{item.voidedAt ? <span className="status-badge overdue" title={item.voidReason}>已撤销</span> : <span className="status-badge normal">有效</span>}</td>
          <td>{item.canVoid ? <button className="button secondary compact danger-text" onClick={() => setTarget({ kind: "receipt", id: item.id, label: `${item.spaceName} · ${item.childLabel}` })}><RotateCcw size={15}/>撤销</button> : <span className="muted-text">—</span>}</td>
        </tr>)}
        {history.receipts.length === 0 ? <tr><td colSpan={6} className="table-empty">暂无收款记录</td></tr> : null}
      </tbody></table></div>
    </section>
    <section className="dashboard-section">
      <header className="dashboard-section-header"><div><h2>空间续费</h2><p>只能撤销每个空间最后一次有效续费，避免破坏后续账期。</p></div><span className="attention-counts"><span>{history.renewals.length} 条</span></span></header>
      <div className="space-table-shell transaction-scroll-shell renewal-scroll-shell"><table className="transaction-table renewal-table"><thead><tr><th>空间</th><th>续费前</th><th>续费后</th><th>冻结成本</th><th>实际支付时间</th><th>操作</th></tr></thead><tbody>
        {history.renewals.map((item) => <tr key={item.id} className={item.voidedAt ? "voided-row" : ""}>
          <td><strong>{item.spaceName}</strong>{item.voidedAt ? <small className="table-subline">已撤销：{item.voidReason}</small> : null}</td>
          <td>{item.previousRenewsOn}</td><td>{item.nextRenewsOn}</td>
          <td>{formatMoney(item.frozenUsdMinor, "USD")} / {formatMoney(item.frozenCnyMinor, "CNY")}</td>
          <td>{localTime(item.paidAt)}</td>
          <td>{item.canVoid ? <button className="button secondary compact danger-text" onClick={() => setTarget({ kind: "renewal", id: item.id, label: item.spaceName })}><RotateCcw size={15}/>撤销</button> : <span className="muted-text">—</span>}</td>
        </tr>)}
        {history.renewals.length === 0 ? <tr><td colSpan={6} className="table-empty">暂无续费记录</td></tr> : null}
      </tbody></table></div>
    </section>
    {target ? <Modal title={`撤销${target.kind === "receipt" ? "收款" : "续费"}`} description={`即将撤销：${target.label}。记录会保留，但不再计入金额和账期。`} onClose={() => { setTarget(null); setReason(""); }} closeDisabled={busy} footer={<><button className="button secondary" onClick={() => { setTarget(null); setReason(""); }} disabled={busy}>取消</button><button className="button danger" disabled={busy || reason.trim().length < 2} onClick={submitVoid}>{busy ? "处理中…" : "确认撤销"}</button></>}>
      <div className="stack-form"><label>撤销原因<textarea autoFocus rows={3} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：金额输错，需要重新记录" /></label><small>为了保证账期正确，只能从最后一笔有效记录开始撤销。</small></div>
    </Modal> : null}
  </>;
}
