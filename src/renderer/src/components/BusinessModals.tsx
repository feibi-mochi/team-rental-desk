import { useState } from "react";
import type { ChildSeatView, CurrencyView, SpaceListItem } from "../../../shared/contracts";
import { amountStep, errorMessage, formatMoney, localDateTimeInputValue, majorToMinor } from "../ui";
import { Modal } from "./Modal";

export function ReceiptModal(props: {
  child: ChildSeatView;
  currency: CurrencyView | undefined;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const decimals = props.currency?.decimalPlaces ?? 2;
  const [amount, setAmount] = useState(String(props.child.remainingMinor / 10 ** decimals));
  const [fee, setFee] = useState<0 | 60 | 160>(0);
  const [receivedAt, setReceivedAt] = useState(() => localDateTimeInputValue());
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const gross = Number(amount || 0);
  const feeAmount = gross * fee / 10_000;

  const submit = async () => {
    setBusy(true);
    try {
      await window.teamRental.recordReceipt({
        operationId,
        childSeatId: props.child.id,
        grossMinor: majorToMinor(amount, decimals),
        feeBasisPoints: fee,
        receivedAt: new Date(receivedAt).toISOString(),
      });
      props.onSaved();
      props.onClose();
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    title="记录子账号收款"
    description="页面仍显示你输入的毛金额，收益按扣除所选手续费后的净金额计算。"
    onClose={props.onClose}
    closeDisabled={busy}
    footer={<>
      <button className="button secondary" onClick={props.onClose} disabled={busy}>取消</button>
      <button className="button primary" disabled={busy || !receivedAt} onClick={submit}>{busy ? "记录中…" : "确认收款"}</button>
    </>}
  >
    <div className="stack-form">
      <label>本次收款金额
        <input type="number" min={amountStep(decimals)} step={amountStep(decimals)} value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <label>实际收款时间<input type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} required /></label>
      <div>
        <span className="field-label">手续费</span>
        <div className="segmented">
          {([[0, "不收手续费（微信等）"], [60, "闲鱼 0.6%"], [160, "闲鱼 1.6%"]] as const).map(([value, label]) => (
            <button key={value} type="button" className={fee === value ? "selected" : ""} onClick={() => setFee(value)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="calculation">
        <span>毛收入 {(gross).toFixed(decimals)} {props.child.charge.currency}</span>
        <span>手续费 {feeAmount.toFixed(decimals)}</span>
        <strong>实际收入 {(gross - feeAmount).toFixed(decimals)} {props.child.charge.currency}</strong>
      </div>
      <small>剩余应收：{formatMoney(props.child.remainingMinor, props.child.charge.currency, decimals)}，超过会被拒绝。</small>
    </div>
  </Modal>;
}

export function RenewalModal(props: {
  space: SpaceListItem;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [usd, setUsd] = useState(props.space.sourceCostUsdMinor ? String(props.space.sourceCostUsdMinor / 100) : "");
  const [paidAt, setPaidAt] = useState(() => localDateTimeInputValue());
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await window.teamRental.renewSpace({
        operationId,
        spaceId: props.space.id,
        frozenUsdMinor: majorToMinor(usd, 2),
        paidAt: new Date(paidAt).toISOString(),
      });
      props.onSaved();
      props.onClose();
    } catch (error) {
      props.onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return <Modal
    title={`续费 ${props.space.displayName}`}
    description="请按支付页面最终显示的美元金额填写。人民币会按保存这一刻的汇率固定。"
    onClose={props.onClose}
    closeDisabled={busy}
    footer={<>
      <button className="button secondary" onClick={props.onClose} disabled={busy}>取消</button>
      <button className="button primary" disabled={busy || !usd || !paidAt} onClick={submit}>{busy ? "保存中…" : "确认续费"}</button>
    </>}
  >
    <div className="stack-form">
      <label>本次冻结成本（USD）
        <input autoFocus type="number" min="0.01" step="0.01" value={usd} onChange={(event) => setUsd(event.target.value)} />
      </label>
      <label>实际支付时间<input type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} required /></label>
      <small>保存后同时固定 USD、CNY、汇率和时间；以后汇率变化不会改历史成本。</small>
    </div>
  </Modal>;
}
