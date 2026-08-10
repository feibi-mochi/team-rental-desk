import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { CurrencyView } from "../../../shared/contracts";
import { ConfirmModal, Modal } from "../components/Modal";
import { errorMessage } from "../ui";

export function CurrenciesPage(props: {
  refreshToken: number;
  onChanged: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [items, setItems] = useState<CurrencyView[]>([]);
  const [editing, setEditing] = useState<CurrencyView | "new" | null>(null);
  const [deleting, setDeleting] = useState<CurrencyView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => window.teamRental.listCurrencies().then(setItems).catch((error) => props.onError(errorMessage(error)));
  useEffect(() => { void load(); }, [props.refreshToken]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await window.teamRental.refreshRates();
      await load();
      props.onChanged();
      props.onNotice(`已更新 ${result.updated} 个币种${result.skipped.length ? `，${result.skipped.join("、")} 暂时没有可用汇率` : ""}`);
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await window.teamRental.deleteCurrency(deleting.code);
      setDeleting(null);
      await load();
      props.onChanged();
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  };

  return <>
    <section className="section-heading">
      <div><h2>汇率与币种管理</h2><p>汇率会在打开程序时更新，之后每 30 分钟自动更新；也可以随时手动更新。</p></div>
      <div className="action-row">
        <button className="button secondary" onClick={refresh} disabled={refreshing}><RefreshCw size={17} className={refreshing ? "spin" : ""} />{refreshing ? "更新中…" : "立即更新"}</button>
        <button className="button primary" onClick={() => setEditing("new")}><Plus size={17} />新增币种</button>
      </div>
    </section>
    {items.length === 0 ? <section className="empty-card compact-empty">还没有可用币种，可以先新增一个。</section> : <section className="currency-grid">{items.map((item) => {
      const protectedCurrency = item.code === "USD" || item.code === "CNY";
      return <article className={item.enabled ? "currency-card" : "currency-card disabled"} key={item.code}>
        <div className="currency-symbol">{item.symbol}</div>
        <div className="currency-identity">
          <div className="currency-code-row"><strong>{item.code}</strong>{protectedCurrency ? <span id={`currency-${item.code}-protected`} className="protected-currency-badge">基准币种</span> : null}</div>
          <span>{item.name}{item.enabled ? "" : " · 已停用"}</span>
        </div>
        <div className="rate-value"><strong>{item.unitsPerUsd ?? "暂无汇率"}</strong><small>{item.unitsPerUsd ? `${item.code} / USD` : "可点击立即更新"}</small></div>
        <footer>
          <div className="currency-source"><span>{item.provider ?? "暂无来源"}</span><time>{item.quotedAt ? new Date(item.quotedAt).toLocaleString("zh-CN") : "尚未更新"}</time></div>
          <div className="action-row">
            <button className="icon-button" title={`编辑 ${item.code}`} aria-label={`编辑 ${item.code}`} onClick={() => setEditing(item)}><Pencil size={16} /></button>
            <button className="icon-button danger-text" disabled={protectedCurrency} title={protectedCurrency ? "记账基准币种不能删除" : `删除 ${item.code}`} aria-label={protectedCurrency ? `${item.code} 是记账基准币种，不能删除` : `删除 ${item.code}`} aria-describedby={protectedCurrency ? `currency-${item.code}-protected` : undefined} onClick={() => setDeleting(item)}><Trash2 size={16} /></button>
          </div>
        </footer>
      </article>;
    })}</section>}
    {editing ? <CurrencyForm item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { void load(); props.onChanged(); }} onError={props.onError} /> : null}
    {deleting ? <ConfirmModal
      title="删除币种"
      message={`确认删除“${deleting.code} · ${deleting.name}”？历史流水中的金额和币种仍会保留。正在使用的币种需要先从空间和子位置中移除。`}
      confirmLabel="确认删除"
      danger
      busy={deleteBusy}
      onClose={() => setDeleting(null)}
      onConfirm={remove}
    /> : null}
  </>;
}

function CurrencyForm(props: { item: CurrencyView | null; onClose: () => void; onSaved: () => void; onError: (message: string) => void }) {
  const [form, setForm] = useState({ code: props.item?.code ?? "", name: props.item?.name ?? "", symbol: props.item?.symbol ?? "", decimalPlaces: String(props.item?.decimalPlaces ?? 2), enabled: props.item?.enabled ?? true });
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await window.teamRental.saveCurrency({ code: form.code, name: form.name, symbol: form.symbol, decimalPlaces: Number(form.decimalPlaces), enabled: form.enabled });
      props.onSaved(); props.onClose();
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return <Modal title={props.item ? `编辑 ${props.item.code}` : "新增币种"} onClose={props.onClose} closeDisabled={busy} footer={<><button className="button secondary" onClick={props.onClose} disabled={busy}>取消</button><button className="button primary" form="currency-form" disabled={busy}>{busy ? "保存中…" : "保存"}</button></>}><form id="currency-form" className="form-grid" onSubmit={submit}><label>币种代码<input disabled={Boolean(props.item)} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required /></label><label>名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>符号<input value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} required /></label><label>小数位数<input type="number" min="0" max="6" value={form.decimalPlaces} onChange={(event) => setForm({ ...form, decimalPlaces: event.target.value })} /></label><label className="check-row span-2"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /><span>启用这个币种并自动更新汇率</span></label></form></Modal>;
}
