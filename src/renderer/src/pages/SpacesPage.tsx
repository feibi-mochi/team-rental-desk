import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  BadgeDollarSign,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import type {
  ChildSeatInput,
  ChildSeatView,
  CurrencyView,
  PaymentMethodView,
  SpaceInput,
  SpaceListItem,
} from "../../../shared/contracts";
import { ReceiptModal, RenewalModal } from "../components/BusinessModals";
import { ConfirmModal, Modal } from "../components/Modal";
import { amountStep, errorMessage, formatMoney, majorToMinor, minorToInput } from "../ui";

function today(): string { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }); }
function addMonth(value: string): string {
  const [year = 2000, month = 1, day = 1] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year, month, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const last = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

const expiryLabels = { normal: "正常", soon: "即将到期", today: "今天到期", overdue: "已过期" } as const;
const collectionLabels = {
  none: "",
  new_customer: "新客户，待记账",
  pending: "待收款",
  partial: "部分收款",
} as const;

function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function usdtReference(usdMinor: number | null, currency?: CurrencyView): string | null {
  if (usdMinor === null || !currency?.enabled || !currency.unitsPerUsd) return null;
  const units = Number(currency.unitsPerUsd);
  if (!Number.isFinite(units) || units <= 0) return null;
  const minor = Math.round((usdMinor / 100) * units * 10 ** currency.decimalPlaces);
  return formatMoney(minor, "USDT", currency.decimalPlaces);
}

type SpaceFormState = {
  displayName: string; serviceKind: "chatgpt" | "codex"; ownerLogin: string; countryCode: string;
  sourceCurrency: string; sourceCost: string; openedOn: string; currentCycleStartedOn: string;
  renewsOn: string; renewalAnchorDay: string; cycleMonths: string; motherSeatKind: "chatgpt" | "codex";
  motherSeatFlexible: boolean; paymentMethodIds: string[]; defaultPaymentMethodId: string;
};

function SpaceForm(props: {
  space: SpaceListItem | null;
  methods: PaymentMethodView[];
  currencies: CurrencyView[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  onMethodAdded: () => Promise<void>;
}) {
  const initial = props.space;
  const defaultMethod = initial?.paymentMethods.find((item) => item.isDefault)?.id ?? "";
  const [form, setForm] = useState<SpaceFormState>({
    displayName: initial?.displayName ?? "",
    serviceKind: initial?.serviceKind ?? "chatgpt",
    ownerLogin: initial?.ownerLogin ?? "",
    countryCode: initial?.countryCode ?? "CN",
    sourceCurrency: initial?.sourceCost.currency ?? "USD",
    sourceCost: initial ? minorToInput(initial.sourceCost.minor, props.currencies.find((c) => c.code === initial.sourceCost.currency)?.decimalPlaces ?? 2) : "25.00",
    openedOn: initial?.openedOn ?? today(),
    currentCycleStartedOn: initial?.currentCycleStartedOn ?? today(),
    renewsOn: initial?.renewsOn ?? addMonth(today()),
    renewalAnchorDay: String(initial?.renewalAnchorDay ?? Number(today().slice(8, 10))),
    cycleMonths: String(initial?.cycleMonths ?? 1),
    motherSeatKind: initial?.motherSeatKind ?? initial?.serviceKind ?? "chatgpt",
    motherSeatFlexible: initial?.motherSeatFlexible ?? false,
    paymentMethodIds: initial?.paymentMethods.map((item) => item.id) ?? [],
    defaultPaymentMethodId: defaultMethod,
  });
  const [busy, setBusy] = useState(false);
  const [newMethod, setNewMethod] = useState("");
  const decimals = props.currencies.find((item) => item.code === form.sourceCurrency)?.decimalPlaces ?? 2;
  const update = <K extends keyof SpaceFormState>(key: K, value: SpaceFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleMethod = (id: string) => {
    const exists = form.paymentMethodIds.includes(id);
    if (!exists && form.paymentMethodIds.length >= 4) return props.onError("一个空间最多绑定 4 个支付渠道");
    const next = exists ? form.paymentMethodIds.filter((item) => item !== id) : [...form.paymentMethodIds, id];
    update("paymentMethodIds", next);
    if (exists && form.defaultPaymentMethodId === id) update("defaultPaymentMethodId", "");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const input: SpaceInput = {
        id: initial?.id,
        displayName: form.displayName,
        serviceKind: form.serviceKind,
        ownerLogin: form.ownerLogin,
        countryCode: form.countryCode,
        sourceCurrency: form.sourceCurrency,
        sourceCostMinor: majorToMinor(form.sourceCost, decimals),
        openedOn: form.openedOn,
        currentCycleStartedOn: form.currentCycleStartedOn,
        renewsOn: form.renewsOn,
        renewalAnchorDay: Number(form.renewalAnchorDay),
        cycleMonths: Number(form.cycleMonths),
        motherSeatKind: form.motherSeatKind,
        motherSeatFlexible: form.motherSeatFlexible,
        paymentMethodIds: form.paymentMethodIds,
        defaultPaymentMethodId: form.defaultPaymentMethodId || null,
      };
      await window.teamRental.saveSpace(input); props.onSaved(); props.onClose();
    } catch (error) { props.onError(errorMessage(error)); } finally { setBusy(false); }
  };
  const addMethod = async () => {
    if (!newMethod.trim()) return;
    try {
      const id = await window.teamRental.savePaymentMethod({ name: newMethod, note: "" });
      setNewMethod(""); await props.onMethodAdded();
      if (form.paymentMethodIds.length < 4) update("paymentMethodIds", [...form.paymentMethodIds, id]);
    } catch (error) { props.onError(errorMessage(error)); }
  };
  return <Modal title={initial ? `编辑 ${initial.displayName}` : "新增空间"} description="母账号、订阅成本、账期和支付方式集中在这里维护。" onClose={props.onClose} closeDisabled={busy} wide footer={<>
    <button className="button secondary" type="button" onClick={props.onClose} disabled={busy}>取消</button>
    <button className="button primary" form="space-form" disabled={busy}>{busy ? "保存中…" : "保存空间"}</button>
  </>}>
    <form id="space-form" className="form-grid" onSubmit={submit}>
      <label>空间名称<input value={form.displayName} onChange={(e) => update("displayName", e.target.value)} required /></label>
      <label>空间类型<select value={form.serviceKind} onChange={(e) => update("serviceKind", e.target.value as SpaceFormState["serviceKind"])}><option value="chatgpt">ChatGPT</option><option value="codex">Codex</option></select></label>
      <label className="span-2">母账号邮箱/登录名<input value={form.ownerLogin} onChange={(e) => update("ownerLogin", e.target.value)} required /></label>
      <label>国家/地区<input value={form.countryCode} onChange={(e) => update("countryCode", e.target.value)} required /></label>
      <label>母账号席位<select value={form.motherSeatKind} onChange={(e) => update("motherSeatKind", e.target.value as SpaceFormState["motherSeatKind"])}><option value="chatgpt">ChatGPT</option><option value="codex">Codex</option></select></label>
      <label className="check-row span-2"><input type="checkbox" checked={form.motherSeatFlexible} onChange={(e) => update("motherSeatFlexible", e.target.checked)} /><span>母账号席位可以变更</span></label>
      <label>原币成本<input type="number" min={amountStep(decimals)} step={amountStep(decimals)} value={form.sourceCost} onChange={(e) => update("sourceCost", e.target.value)} required /></label>
      <label>币种<select value={form.sourceCurrency} onChange={(e) => update("sourceCurrency", e.target.value)}>{props.currencies.filter((item) => item.enabled).map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
      <label>首次开通日<input type="date" value={form.openedOn} onChange={(e) => { update("openedOn", e.target.value); update("renewalAnchorDay", String(Number(e.target.value.slice(8, 10)))); }} required /></label>
      <label>当前周期开始日<input type="date" value={form.currentCycleStartedOn} onChange={(e) => update("currentCycleStartedOn", e.target.value)} required /></label>
      <label>到期日<input type="date" value={form.renewsOn} onChange={(e) => update("renewsOn", e.target.value)} required /></label>
      <label>订阅周期（月）<input type="number" min="1" max="36" value={form.cycleMonths} onChange={(e) => update("cycleMonths", e.target.value)} required /></label>
      <div className="payment-config span-2">
        <fieldset><legend>支付方式（最多 4 个）</legend>
          <div className="method-checks">{props.methods.filter((item) => !item.archived || form.paymentMethodIds.includes(item.id)).map((method) => <label key={method.id} className="check-row"><input type="checkbox" checked={form.paymentMethodIds.includes(method.id)} onChange={() => toggleMethod(method.id)} /><span>{method.name}{method.archived ? "（已归档，请移除）" : ""}</span></label>)}</div>
          <div className="inline-add"><input placeholder="直接新建支付渠道" value={newMethod} onChange={(e) => setNewMethod(e.target.value)} /><button type="button" className="button secondary compact" onClick={addMethod}><Plus size={15} />新增</button></div>
        </fieldset>
        <fieldset className="default-method-field"><legend>默认支付方式</legend><select aria-label="默认支付方式" value={form.defaultPaymentMethodId} onChange={(e) => update("defaultPaymentMethodId", e.target.value)}><option value="">不设置</option>{props.methods.filter((item) => form.paymentMethodIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>收款和续费时优先显示这个渠道。</small></fieldset>
      </div>
    </form>
  </Modal>;
}

function ChildForm(props: { space: SpaceListItem; child: ChildSeatView | null; positionNumber?: number; currencies: CurrencyView[]; onClose: () => void; onSaved: () => void; onError: (message: string) => void }) {
  const child = props.child;
  const firstOpenPosition = [1, 2].find((position) => !props.space.childSeats.some((item) => item.positionNumber === position)) ?? 1;
  const [form, setForm] = useState({
    positionNumber: String(child?.positionNumber ?? props.positionNumber ?? firstOpenPosition),
    seatKind: child?.seatKind ?? "chatgpt", usageKind: child?.usageKind ?? "rental",
    customerLogin: child?.customerLogin ?? "", label: child?.label ?? "", contact: child?.contact ?? "",
    joinedOn: child?.joinedOn ?? today(), chargeCurrency: child?.charge.currency ?? "CNY",
    charge: child ? minorToInput(child.charge.minor, props.currencies.find((c) => c.code === child.charge.currency)?.decimalPlaces ?? 2) : "100.00", paymentDay: String(child?.paymentDay ?? Number(today().slice(8, 10))),
    nextPaymentOn: child?.nextPaymentOn ?? addMonth(today()), cycleMonths: String(child?.cycleMonths ?? 1),
  });
  const [busy, setBusy] = useState(false);
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const decimals = props.currencies.find((item) => item.code === form.chargeCurrency)?.decimalPlaces ?? 2;
      const input: ChildSeatInput = {
        id: child?.id, spaceId: props.space.id, positionNumber: Number(form.positionNumber),
        seatKind: form.seatKind as ChildSeatInput["seatKind"], usageKind: form.usageKind as ChildSeatInput["usageKind"],
        customerLogin: form.customerLogin, label: form.label, contact: form.contact, joinedOn: form.joinedOn,
        chargeCurrency: form.chargeCurrency, chargeMinor: form.usageKind === "self_use" ? 0 : majorToMinor(form.charge, decimals),
        paymentDay: Number(form.paymentDay), nextPaymentOn: form.nextPaymentOn, cycleMonths: Number(form.cycleMonths),
      };
      await window.teamRental.saveChildSeat(input); props.onSaved(); props.onClose();
    } catch (error) { props.onError(errorMessage(error)); } finally { setBusy(false); }
  };
  return <Modal title={child ? "编辑子位置" : `给 ${props.space.displayName} 新增子位置`} onClose={props.onClose} closeDisabled={busy} wide footer={<><button className="button secondary" onClick={props.onClose} disabled={busy}>取消</button><button className="button primary" form="child-form" disabled={busy}>{busy ? "保存中…" : "保存"}</button></>}>
    <form id="child-form" className="form-grid" onSubmit={submit}>
      <label>位置号<input type="number" min="1" max="2" value={form.positionNumber} onChange={(e) => update("positionNumber", e.target.value)} /></label>
      <label>类型<select value={form.seatKind} onChange={(e) => update("seatKind", e.target.value)}><option value="chatgpt">ChatGPT</option><option value="codex">Codex</option></select></label>
      <label>用途<select value={form.usageKind} onChange={(e) => update("usageKind", e.target.value)}><option value="rental">出租</option><option value="self_use">自用（不计应收）</option></select></label>
      <label>备注<input value={form.label} onChange={(e) => update("label", e.target.value)} /></label>
      <label className="span-2">邮箱/登录名<input value={form.customerLogin} onChange={(e) => update("customerLogin", e.target.value)} required /></label>
      <label className="span-2">联系方式<input value={form.contact} onChange={(e) => update("contact", e.target.value)} /></label>
      <label>加入日期<input type="date" value={form.joinedOn} onChange={(e) => { update("joinedOn", e.target.value); update("paymentDay", String(Number(e.target.value.slice(8, 10)))); update("nextPaymentOn", addMonth(e.target.value)); }} /></label>
      <label>下一付款日<input type="date" value={form.nextPaymentOn} onChange={(e) => update("nextPaymentOn", e.target.value)} /></label>
      <label>收费金额<input type="number" min={form.usageKind === "self_use" ? "0" : amountStep(props.currencies.find((c) => c.code === form.chargeCurrency)?.decimalPlaces ?? 2)} step={amountStep(props.currencies.find((c) => c.code === form.chargeCurrency)?.decimalPlaces ?? 2)} disabled={form.usageKind === "self_use"} value={form.charge} onChange={(e) => update("charge", e.target.value)} /></label>
      <label>收费币种<select value={form.chargeCurrency} onChange={(e) => update("chargeCurrency", e.target.value)}>{props.currencies.filter((item) => item.enabled).map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
      <label>周期（月）<input type="number" min="1" max="36" value={form.cycleMonths} onChange={(e) => update("cycleMonths", e.target.value)} /></label>
      <label>固定付款日<input type="number" min="1" max="31" value={form.paymentDay} onChange={(e) => update("paymentDay", e.target.value)} /></label>
    </form>
  </Modal>;
}

export function SpacesPage(props: { refreshToken: number; onChanged: () => void; onError: (message: string) => void; focusedSpaceId?: string | null }) {
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]); const [methods, setMethods] = useState<PaymentMethodView[]>([]); const [currencies, setCurrencies] = useState<CurrencyView[]>([]);
  const [spaceForm, setSpaceForm] = useState<SpaceListItem | "new" | null>(null); const [childForm, setChildForm] = useState<{ space: SpaceListItem; child: ChildSeatView | null; positionNumber?: number } | null>(null);
  const [receipt, setReceipt] = useState<ChildSeatView | null>(null); const [renewal, setRenewal] = useState<SpaceListItem | null>(null); const [confirm, setConfirm] = useState<{ kind: "space" | "child"; id: string; label: string } | null>(null); const [busy, setBusy] = useState(false);
  const load = async () => { try { const [spaceRows, methodRows, currencyRows] = await Promise.all([window.teamRental.listSpaces(), window.teamRental.listPaymentMethods(true), window.teamRental.listCurrencies()]); setSpaces(spaceRows); setMethods(methodRows); setCurrencies(currencyRows); } catch (error) { props.onError(errorMessage(error)); } };
  useEffect(() => { void load(); }, [props.refreshToken]);
  useEffect(() => {
    if (!props.focusedSpaceId || spaces.length === 0) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`space-card-${props.focusedSpaceId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [props.focusedSpaceId, spaces]);
  const changed = () => { void load(); props.onChanged(); };
  const currencyMap = useMemo(() => new Map(currencies.map((item) => [item.code, item])), [currencies]);
  const archive = async () => { if (!confirm) return; setBusy(true); try { if (confirm.kind === "space") await window.teamRental.archiveSpace(confirm.id); else await window.teamRental.archiveChildSeat(confirm.id); setConfirm(null); changed(); } catch (error) { props.onError(errorMessage(error)); } finally { setBusy(false); } };
  return <>
    <section className="section-heading"><div><h2>空间与子位置</h2><p>每个母账号、出租位置、账期、收费和支付渠道都在同一处查看。</p></div><button className="button primary" onClick={() => setSpaceForm("new")}><Plus size={17} />新增空间</button></section>
    {spaces.length === 0 ? <section className="empty-card">还没有正在使用的空间。可以新增空间，或到“已归档空间”恢复。</section> : <div className="space-table-shell active-space-table-shell"><table className="space-table">
      <colgroup><col className="space-col-name" /><col className="space-col-owner" /><col className="space-col-country" /><col className="space-col-method" /><col className="space-col-cost" /><col className="space-col-due" /><col className="space-col-actions" /></colgroup>
      <thead><tr><th>名称</th><th>母号邮箱</th><th>国家/地区</th><th>默认渠道</th><th>金额</th><th>到期日</th><th>操作</th></tr></thead>
      {spaces.map((space) => {
        const children = [...space.childSeats].sort((left, right) => left.positionNumber - right.positionNumber);
        const openPositions = [1, 2]
          .filter((position) => !children.some((child) => child.positionNumber === position))
          .slice(0, Math.max(0, 2 - children.length));
        const defaultMethod = space.paymentMethods.find((method) => method.isDefault) ?? space.paymentMethods[0];
        const usdt = usdtReference(space.sourceCostUsdMinor, currencyMap.get("USDT"));
        return <tbody id={`space-card-${space.id}`} className={space.id === props.focusedSpaceId ? "space-table-group focused" : "space-table-group"} key={space.id}>
          <tr className="space-table-main-row">
            <td><div className="space-table-name"><strong>{space.displayName}</strong><span className={`service-badge ${space.serviceKind}`}>{space.serviceKind === "codex" ? "Codex" : "ChatGPT"}</span></div></td>
            <td className="space-table-owner" title={space.ownerLogin}>{space.ownerLogin}</td>
            <td>{countryLabel(space.countryCode)}</td>
            <td title={defaultMethod?.name}>{defaultMethod?.name ?? "未设置"}</td>
            <td><div className="space-table-cost"><strong>{formatMoney(space.sourceCost.minor, space.sourceCost.currency, currencyMap.get(space.sourceCost.currency)?.decimalPlaces)}</strong><small>{space.sourceCostUsdMinor === null ? "尚未冻结 USD" : `${formatMoney(space.sourceCostUsdMinor,"USD")} · ${formatMoney(space.sourceCostCnyMinor ?? 0,"CNY")}${usdt ? ` · ${usdt}` : ""}`}</small></div></td>
            <td><div className="space-table-due"><span>{space.renewsOn}</span><span className={`status-badge ${space.expiryStatus}`}>{expiryLabels[space.expiryStatus]}</span></div></td>
            <td><div className="space-table-actions"><button className="icon-button" title="续费" aria-label={`续费空间 ${space.displayName}`} onClick={() => setRenewal(space)}><RefreshCw size={17} /></button><button className="icon-button" title="编辑" aria-label={`编辑空间 ${space.displayName}`} onClick={() => setSpaceForm(space)}><Pencil size={17} /></button><button className="icon-button danger-text" title="归档" aria-label={`归档空间 ${space.displayName}`} onClick={() => setConfirm({kind:"space",id:space.id,label:space.displayName})}><Archive size={17} /></button></div></td>
          </tr>
          <tr className="space-table-child-row"><td colSpan={7}><div className="child-grid">{children.map((child) => <div className="child-row" key={child.id}>
            <div className="position">位置 {child.positionNumber}</div><div className="child-login"><strong>{child.customerLogin}</strong><small>{child.contact || "未填写联系方式"}</small></div><div className="charge"><span className={child.charge.minor >= 100 * 10 ** (currencyMap.get(child.charge.currency)?.decimalPlaces ?? 2) ? "amount-pill yellow" : "amount-pill blue"}>{child.usageKind === "self_use" ? "自用" : formatMoney(child.charge.minor, child.charge.currency, currencyMap.get(child.charge.currency)?.decimalPlaces)}</span></div><div className="child-date"><span>{child.nextPaymentOn}</span><small>{child.cycleMonths === 1 ? `每月 ${child.paymentDay} 日` : `每 ${child.cycleMonths} 个月 · ${child.paymentDay} 日`}</small></div><div className="child-status"><span className={`status-badge ${child.expiryStatus}`}>{expiryLabels[child.expiryStatus]}</span>{child.collectionStatus !== "none" ? <span className={`collection-badge ${child.collectionStatus}`}>{collectionLabels[child.collectionStatus]}</span> : null}</div><div className="action-row">{child.usageKind === "rental" && child.collectionStatus !== "none" ? <button className="icon-button success" title="记录收款" aria-label={`记录 ${child.customerLogin} 的收款`} onClick={() => setReceipt(child)}><BadgeDollarSign size={17} /></button> : null}<button className="icon-button" title="编辑" aria-label={`编辑子位置 ${child.customerLogin}`} onClick={() => setChildForm({space,child})}><Pencil size={17} /></button><button className="icon-button danger-text" title="归档" aria-label={`归档子位置 ${child.customerLogin}`} onClick={() => setConfirm({kind:"child",id:child.id,label:`${space.displayName} 位置 ${child.positionNumber}`})}><Archive size={17} /></button></div>
          </div>)}{openPositions.map((positionNumber) => <button type="button" className="child-empty-slot" key={`open-${positionNumber}`} onClick={() => setChildForm({space,child:null,positionNumber})}><Plus size={18} /><span>添加子位置</span><small>位置 {positionNumber}</small></button>)}</div></td></tr>
        </tbody>;
      })}
    </table></div>}
    {spaceForm ? <SpaceForm space={spaceForm === "new" ? null : spaceForm} methods={methods} currencies={currencies} onClose={() => setSpaceForm(null)} onSaved={changed} onError={props.onError} onMethodAdded={async () => setMethods(await window.teamRental.listPaymentMethods(true))} /> : null}
    {childForm ? <ChildForm {...childForm} currencies={currencies} onClose={() => setChildForm(null)} onSaved={changed} onError={props.onError} /> : null}
    {receipt ? <ReceiptModal child={receipt} currency={currencyMap.get(receipt.charge.currency)} onClose={() => setReceipt(null)} onSaved={changed} onError={props.onError} /> : null}
    {renewal ? <RenewalModal space={renewal} onClose={() => setRenewal(null)} onSaved={changed} onError={props.onError} /> : null}
    {confirm ? <ConfirmModal title={confirm.kind === "space" ? "归档空间" : "归档子位置"} message={`确认归档“${confirm.label}”？历史收款不会删除，以后可以从侧栏的归档页面恢复。`} confirmLabel="确认归档" danger busy={busy} onClose={() => setConfirm(null)} onConfirm={archive} /> : null}
  </>;
}
