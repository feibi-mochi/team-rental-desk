import { useEffect, useState } from "react";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import type { SpaceListItem } from "../../../shared/contracts";
import { ConfirmModal } from "../components/Modal";
import { errorMessage } from "../ui";

type PendingAction = { kind: "restore" | "delete"; space: SpaceListItem };

export function ArchivedSpacesPage(props: {
  refreshToken: number;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => window.teamRental.listArchivedSpaces()
    .then(setSpaces)
    .catch((error) => props.onError(errorMessage(error)));

  useEffect(() => { void load(); }, [props.refreshToken]);

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "restore") await window.teamRental.unarchiveSpace(pending.space.id);
      else await window.teamRental.deleteArchivedSpace(pending.space.id);
      setPending(null);
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
      <div><h2>已归档母空间</h2><p>这里仅存放不再使用的母空间，可以恢复或永久删除。</p></div>
      <span className="attention-counts"><span>{spaces.length} 个已归档</span></span>
    </section>
    {spaces.length === 0
      ? <section className="empty-card compact-empty">还没有已归档的空间。</section>
      : <section className="list-card archive-list">{spaces.map((space) => <div className="list-row archived" key={space.id}>
        <div className="row-icon"><Archive size={19} /></div>
        <div className="grow"><strong>{space.displayName}</strong><small>{space.ownerLogin} · 到期日 {space.renewsOn} · {space.childSeats.length} 个随空间归档的子位置</small></div>
        <span className={`service-badge ${space.serviceKind}`}>{space.serviceKind === "codex" ? "Codex" : "ChatGPT"}</span>
        <div className="action-row">
          <button className="icon-button labeled" title="恢复空间" onClick={() => setPending({ kind: "restore", space })}><RotateCcw size={17} /><span>恢复</span></button>
          <button className="icon-button labeled danger-text" title="永久删除空间" onClick={() => setPending({ kind: "delete", space })}><Trash2 size={17} /><span>删除</span></button>
        </div>
      </div>)}</section>}
    {pending ? <ConfirmModal
      title={pending.kind === "restore" ? "恢复空间" : "永久删除空间"}
      message={pending.kind === "restore"
        ? `确认恢复“${pending.space.displayName}”？当时随空间一起归档的子位置也会恢复；单独归档的子位置仍保留在“子位置归档”。`
        : `确认永久删除“${pending.space.displayName}”？历史收款和续费流水会保留，但这个空间删除后不能恢复。`}
      confirmLabel={pending.kind === "restore" ? "确认恢复" : "永久删除"}
      danger={pending.kind === "delete"}
      busy={busy}
      onClose={() => setPending(null)}
      onConfirm={submit}
    /> : null}
  </>;
}
