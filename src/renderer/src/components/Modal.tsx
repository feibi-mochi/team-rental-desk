import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Modal(props: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(props.onClose);
  const closeDisabledRef = useRef(Boolean(props.closeDisabled));
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => { onCloseRef.current = props.onClose; }, [props.onClose]);
  useEffect(() => { closeDisabledRef.current = Boolean(props.closeDisabled); }, [props.closeDisabled]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector);
    const activeInside = dialog && document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
      ? document.activeElement
      : null;
    (activeInside ?? firstFocusable ?? dialog)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className={props.wide ? "modal wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={props.description ? descriptionId : undefined}
        aria-busy={props.closeDisabled || undefined}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{props.title}</h2>
            {props.description ? <p id={descriptionId}>{props.description}</p> : null}
          </div>
          <button className="icon-button" onClick={props.onClose} title="关闭" aria-label="关闭弹窗" disabled={props.closeDisabled}><X size={21} /></button>
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer ? <footer className="modal-footer">{props.footer}</footer> : null}
      </section>
    </div>
  );
}

export function ConfirmModal(props: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      closeDisabled={props.busy}
      footer={<>
        <button className="button secondary" onClick={props.onClose} disabled={props.busy}>取消</button>
        <button className={props.danger ? "button danger" : "button primary"} onClick={props.onConfirm} disabled={props.busy}>
          {props.busy ? "处理中…" : (props.confirmLabel ?? "确认")}
        </button>
      </>}
    >
      <p className="confirm-message">{props.message}</p>
    </Modal>
  );
}
