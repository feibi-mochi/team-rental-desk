import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import type { ArchivedChildSeatView, CurrencyView, SpaceListItem } from "../../../shared/contracts";
import { ConfirmModal, Modal } from "../components/Modal";
import { errorMessage, formatMoney } from "../ui";

type AvailableSpace = { space: SpaceListItem; positions: Array<1 | 2> };

export function availableSpaces(spaces: SpaceListItem[]): AvailableSpace[] {
  return spaces.flatMap((space) => {
    if (space.childSeats.length >= 2) return [];
    const occupied = new Set(space.childSeats.map((child) => child.positionNumber));
    const positions = ([1, 2] as const).filter((position) => !occupied.has(position));
    return positions.length ? [{ space, positions }] : [];
  });
}

function localTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function ArchivedChildrenPage(props: {
  refreshToken: number;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [children, setChildren] = useState<ArchivedChildSeatView[]>([]);
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyView[]>([]);
  const [restoring, setRestoring] = useState<ArchivedChildSeatView | null>(null);
  const [deleting, setDeleting] = useState<ArchivedChildSeatView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [archivedRows, activeSpaces, currencyRows] = await Promise.all([
        window.teamRental.listArchivedChildSeats(),
        window.teamRental.listSpaces(),
        window.teamRental.listCurrencies(true),
      ]);
      setChildren(archivedRows);
      setSpaces(activeSpaces);
      setCurrencies(currencyRows);
    } catch (error) {
      props.onError(errorMessage(error));
    }
  };

  useEffect(() => { void load(); }, [props.refreshToken]);

  const targets = useMemo(() => availableSpaces(spaces), [spaces]);
  const decimals = useMemo(() => new Map(currencies.map((item) => [item.code, item.decimalPlaces])), [currencies]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await window.teamRental.deleteArchivedChildSeat(deleting.id);
      setDeleting(null);
      await load();
      props.onChanged();
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <section className="section-heading">
      <div><h2>单独归档的子位置</h2><p>单独归档的子位置集中在这里；恢复时可以选择仍有空位的母号。</p></div>
      <span className="attention-counts"><span>{children.length} 个已归档</span></span>
    </section>
    {children.length === 0
      ? <section className="empty-card compact-empty">还没有单独归档的子位置。</section>
      : <section className="list-card archive-list">{children.map((child) => <div className="list-row archived child-archive-row" key={child.id}>
        <div className="row-icon"><Archive size={19} /></div>
        <div className="grow"><strong>{child.customerLogin}</strong><small>原母号：{child.originalSpaceName} · 原位置 {child.positionNumber}{child.contact ? ` · ${child.contact}` : ""}</small></div>
        <div className="archive-child-meta"><strong>{child.usageKind === "self_use" ? "自用" : formatMoney(child.charge.minor, child.charge.currency, decimals.get(child.charge.currency))}</strong><small>归档于 {localTime(child.archivedAt)}</small></div>
        <div className="action-row">
          <button className="icon-button labeled" title={targets.length ? "恢复到其他母号" : "目前没有空闲位置"} disabled={targets.length === 0} onClick={() => setRestoring(child)}><RotateCcw size={17} /><span>恢复</span></button>
          <button className="icon-button labeled danger-text" title="永久删除子位置" onClick={() => setDeleting(child)}><Trash2 size={17} /><span>删除</span></button>
        </div>
      </div>)}</section>}
    {children.length > 0 && targets.length === 0 ? <p className="archive-help">目前所有母号都已满。先在“空间”中留出一个位置，才能恢复子位置。</p> : null}
    {restoring ? <RestoreChildModal
      child={restoring}
      targets={targets}
      onClose={() => setRestoring(null)}
      onRestored={async () => { setRestoring(null); await load(); props.onChanged(); }}
      onError={props.onError}
    /> : null}
    {deleting ? <ConfirmModal
      title="永久删除子位置"
      message={`确认永久删除“${deleting.customerLogin}”？历史收款流水会保留，但这个子位置删除后不能恢复。`}
      confirmLabel="永久删除"
      danger
      busy={busy}
      onClose={() => setDeleting(null)}
      onConfirm={remove}
    /> : null}
  </>;
}

function RestoreChildModal(props: {
  child: ArchivedChildSeatView;
  targets: AvailableSpace[];
  onClose: () => void;
  onRestored: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const first = props.targets[0];
  const [spaceId, setSpaceId] = useState(first?.space.id ?? "");
  const [position, setPosition] = useState<1 | 2>(first?.positions[0] ?? 1);
  const [busy, setBusy] = useState(false);
  const selected = props.targets.find((item) => item.space.id === spaceId);

  const chooseSpace = (nextSpaceId: string) => {
    const next = props.targets.find((item) => item.space.id === nextSpaceId);
    setSpaceId(nextSpaceId);
    setPosition(next?.positions[0] ?? 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !selected.positions.includes(position)) return;
    setBusy(true);
    try {
      await window.teamRental.restoreChildSeat({ childSeatId: props.child.id, targetSpaceId: spaceId, positionNumber: position });
      await props.onRestored();
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    title="恢复子位置"
    description={`正在恢复 ${props.child.customerLogin}。原母号是 ${props.child.originalSpaceName}。`}
    onClose={props.onClose}
    closeDisabled={busy}
    footer={<><button className="button secondary" onClick={props.onClose} disabled={busy}>取消</button><button className="button primary" form="restore-child-form" disabled={busy || !selected}>{busy ? "恢复中…" : "确认恢复"}</button></>}
  >
    <form id="restore-child-form" className="form-grid" onSubmit={submit}>
      <label className="span-2">放入母号<select value={spaceId} onChange={(event) => chooseSpace(event.target.value)}>{props.targets.map((item) => <option key={item.space.id} value={item.space.id}>{item.space.displayName}（空位 {item.positions.join("、")}）</option>)}</select></label>
      <label className="span-2">使用位置<select value={position} onChange={(event) => setPosition(Number(event.target.value) as 1 | 2)}>{selected?.positions.map((item) => <option key={item} value={item}>位置 {item}</option>)}</select></label>
      <p className="restore-note span-2">恢复后会出现在所选母号下，原来的历史收款记录仍会保留。</p>
    </form>
  </Modal>;
}
