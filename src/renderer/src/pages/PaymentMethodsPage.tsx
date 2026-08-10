import { useEffect, useState, type FormEvent } from "react";
import { ArchiveRestore, CreditCard, Pencil, Plus, Trash2 } from "lucide-react";
import type { PaymentMethodView } from "../../../shared/contracts";
import { ConfirmModal, Modal } from "../components/Modal";
import { errorMessage } from "../ui";

export function PaymentMethodsPage(props: { refreshToken: number; onChanged: () => void; onError: (message: string) => void }) {
  const [items, setItems] = useState<PaymentMethodView[]>([]); const [editing, setEditing] = useState<PaymentMethodView | "new" | null>(null); const [confirm, setConfirm] = useState<PaymentMethodView | null>(null); const [deleting, setDeleting] = useState<PaymentMethodView | null>(null); const [busy, setBusy] = useState(false);
  const load = () => window.teamRental.listPaymentMethods(true).then(setItems).catch((error) => props.onError(errorMessage(error)));
  useEffect(() => { void load(); }, [props.refreshToken]);
  const changed = () => { void load(); props.onChanged(); };
  const toggle = async () => { if (!confirm) return; setBusy(true); try { await window.teamRental.setPaymentMethodArchived(confirm.id, !confirm.archived); setConfirm(null); changed(); } catch (error) { props.onError(errorMessage(error)); } finally { setBusy(false); } };
  const remove = async () => { if (!deleting) return; setBusy(true); try { await window.teamRental.deletePaymentMethod(deleting.id); setDeleting(null); changed(); } catch (error) { props.onError(errorMessage(error)); } finally { setBusy(false); } };
  return <><section className="section-heading"><div><h2>支付渠道管理</h2><p>渠道可以归档和恢复；归档后可永久删除，历史流水仍会保留。每个空间最多绑定 4 个，只能标记 1 个默认渠道。</p></div><button className="button primary" onClick={() => setEditing("new")}><Plus size={17} />新增支付渠道</button></section>
    <section className="list-card">{items.map((item) => <div className={item.archived ? "list-row archived" : "list-row"} key={item.id}><div className="row-icon"><CreditCard size={19} /></div><div className="grow"><strong>{item.name}</strong><small>{item.note || "暂无备注"}</small></div><span className={item.archived ? "status-badge overdue" : "status-badge normal"}>{item.archived ? "已归档" : "使用中"}</span><div className="action-row"><button className="icon-button" title="编辑" aria-label={`编辑支付渠道 ${item.name}`} onClick={() => setEditing(item)}><Pencil size={17} /></button><button className="icon-button" title={item.archived ? "恢复" : "归档"} aria-label={`${item.archived ? "恢复" : "归档"}支付渠道 ${item.name}`} onClick={() => setConfirm(item)}><ArchiveRestore size={17} /></button><button className="icon-button danger-text" disabled={!item.archived} title={item.archived ? "永久删除" : "请先归档再删除"} aria-label={item.archived ? `永久删除支付渠道 ${item.name}` : `支付渠道 ${item.name} 需要先归档才能删除`} onClick={() => setDeleting(item)}><Trash2 size={17} /></button></div></div>)}</section>
    {editing ? <MethodForm method={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={changed} onError={props.onError} /> : null}
    {confirm ? <ConfirmModal title={confirm.archived ? "恢复支付渠道" : "归档支付渠道"} message={`${confirm.archived ? "恢复" : "归档"}“${confirm.name}”？已绑定空间的历史关联会保留。`} confirmLabel={confirm.archived ? "确认恢复" : "确认归档"} danger={!confirm.archived} busy={busy} onClose={() => setConfirm(null)} onConfirm={toggle} /> : null}
    {deleting ? <ConfirmModal title="永久删除支付渠道" message={`确认永久删除“${deleting.name}”？历史流水会保留；已归档空间如果曾绑定这个渠道，恢复后需要重新选择。`} confirmLabel="永久删除" danger busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} /> : null}
  </>;
}

function MethodForm(props: { method: PaymentMethodView | null; onClose: () => void; onSaved: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState(props.method?.name ?? ""); const [note, setNote] = useState(props.method?.note ?? ""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await window.teamRental.savePaymentMethod({id:props.method?.id,name,note}); props.onSaved(); props.onClose(); } catch (error) { props.onError(errorMessage(error)); } finally { setBusy(false); } };
  return <Modal title={props.method ? "编辑支付渠道" : "新增支付渠道"} onClose={props.onClose} closeDisabled={busy} footer={<><button className="button secondary" onClick={props.onClose} disabled={busy}>取消</button><button className="button primary" form="method-form" disabled={busy}>{busy ? "保存中…" : "保存"}</button></>}><form id="method-form" className="stack-form" onSubmit={submit}><label>渠道名称<input autoFocus value={name} onChange={(e)=>setName(e.target.value)} required /></label><label>备注<textarea rows={3} value={note} onChange={(e)=>setNote(e.target.value)} /></label></form></Modal>;
}
