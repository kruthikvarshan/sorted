import React, { useRef } from 'react';
import { Wallet, ShieldAlert, CheckCircle2, Paperclip, Loader2, Check, X } from 'lucide-react';
import { Commitment } from '../types/groupOs';
import { computeLedger, formatMoney, UnverifiedClaim } from '../engine/ledger';
import { canConfirm, sameName } from '../engine/receiptVerifier';

interface LedgerPanelProps {
  commitments: Commitment[];
  /** The person looking at the screen. Only the recipient can really confirm a payment. */
  currentUserName?: string;
  /** Commitment currently having its receipt read. */
  busyId?: string | null;
  onAttachReceipt?: (commitmentId: string, file: File) => void;
  onConfirmPayment?: (commitmentId: string) => void;
  onDisputePayment?: (commitmentId: string) => void;
}

const STATE_STYLE: Record<string, string> = {
  receipt_consistent: 'border-sky-200 bg-sky-50 text-sky-900',
  receipt_mismatch: 'border-rose-200 bg-rose-50 text-rose-900',
  receipt_duplicate: 'border-rose-200 bg-rose-50 text-rose-900',
  receipt_unreadable: 'border-amber-200 bg-amber-50 text-amber-900',
  disputed: 'border-rose-300 bg-rose-50 text-rose-900',
};

const ClaimRow: React.FC<{ claim: UnverifiedClaim } & Omit<LedgerPanelProps, 'commitments'> & { commitment?: Commitment }> = ({
  claim, commitment, currentUserName, busyId, onAttachReceipt, onConfirmPayment, onDisputePayment,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const v = claim.verification;
  const busy = busyId === claim.commitmentId;
  const me = currentUserName ?? '';
  const isRecipient = !!claim.to && sameName(me, claim.to) === true;
  const mayConfirm = !!commitment && !!onConfirmPayment && canConfirm(commitment, me);
  const style = (v && STATE_STYLE[v.state]) || 'border-amber-200 bg-amber-50 text-amber-900';
  const money = claim.amount ? ` ${formatMoney(claim.amount, claim.currency)}` : '';

  return (
    <li className={`rounded-lg border px-3 py-2 ${style}`}>
      <div className="flex items-start gap-1.5">
        <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <div>
            <span className="font-bold">{claim.from}</span> says they paid{claim.to ? <> <span className="font-bold">{claim.to}</span></> : ''}
            <span className="font-mono font-bold">{money}</span>.{' '}
            {!v && <span className="font-semibold">Claim only: no receipt yet.</span>}
            {v?.state === 'receipt_consistent' && <span className="font-semibold">A receipt agrees with it. Waiting for a person to confirm.</span>}
            {v?.state === 'receipt_mismatch' && <span className="font-semibold">A receipt does not match the claim.</span>}
            {v?.state === 'receipt_duplicate' && <span className="font-semibold">This receipt was already used.</span>}
            {v?.state === 'receipt_unreadable' && <span className="font-semibold">The receipt could not be read.</span>}
            {v?.state === 'disputed' && <span className="font-semibold">Disputed: {v.reasons[0]}</span>}
          </div>
          {v && v.state !== 'disputed' && v.reasons.map((r, i) => (
            <div key={i} className="text-[11px] opacity-90">{r}</div>
          ))}
          {v?.receipt && (
            <div className="text-[11px] font-mono opacity-80">
              Receipt read: {v.receipt.amount ?? '?'} {v.receipt.currency ?? ''} · {v.receipt.payer ?? '?'} to {v.receipt.payee ?? '?'}
              {v.receipt.reference ? ` · ref ${v.receipt.reference}` : ''}{v.readBy ? ` · read by ${v.readBy}` : ''}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {onAttachReceipt && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) onAttachReceipt(claim.commitmentId, file);
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-md border border-current/30 bg-white/70 px-2 py-1 text-[11px] font-bold hover:bg-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                  {busy ? 'Reading receipt…' : v?.receipt ? 'Replace receipt' : 'Attach receipt'}
                </button>
              </>
            )}
            {mayConfirm && (
              <button
                onClick={() => onConfirmPayment!(claim.commitmentId)}
                className="flex items-center gap-1 rounded-md bg-[#008069] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#00705c]"
              >
                <Check className="w-3 h-3" /> {isRecipient ? 'I received it' : 'Confirm payment'}
              </button>
            )}
            {isRecipient && onDisputePayment && v?.state !== 'disputed' && (
              <button
                onClick={() => onDisputePayment(claim.commitmentId)}
                className="flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
              >
                <X className="w-3 h-3" /> Not received
              </button>
            )}
            {claim.to && !isRecipient && onConfirmPayment && (
              <span className="text-[10px] opacity-75">Only {claim.to} can confirm this.</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
};

/** Who owes whom in this group. A payment claim stays a claim until a person confirms it; a receipt is only evidence. */
export const LedgerPanel: React.FC<LedgerPanelProps> = props => {
  const { commitments } = props;
  const ledger = computeLedger(commitments);
  const empty = !ledger.balances.length && !ledger.tentative.length && !ledger.claims.length && !ledger.settled.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5 text-slate-500" /> Who owes whom
        </h4>
        <span className="text-[10px] text-slate-500 font-medium">From the chat</span>
      </div>

      {empty ? (
        <div className="text-center py-5 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
          No money promises yet. Amounts and recipients appear when someone promises or claims a payment.
        </div>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {ledger.balances.map((b, i) => (
            <li key={`b${i}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-bold text-slate-900">{b.from}</span> owes <span className="font-bold text-slate-900">{b.to}</span>{' '}
              <span className="font-mono font-bold text-[#008069]">{formatMoney(b.amount, b.currency)}</span>
            </li>
          ))}
          {ledger.tentative.map((b, i) => (
            <li key={`t${i}`} className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-slate-600">
              {b.from} may pay {b.to} {formatMoney(b.amount, b.currency)} <span className="text-[10px] uppercase tracking-wide">(tentative)</span>
            </li>
          ))}
          {ledger.claims.map(c => (
            <ClaimRow key={c.commitmentId} claim={c} commitment={commitments.find(x => x.id === c.commitmentId)} {...props} />
          ))}
          {ledger.settled.map(s => (
            <li key={s.commitmentId} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900 flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {s.basis ? <>Confirmed by <b>{s.decidedBy}</b>: </> : 'Completed: '}
                {s.from} paid{s.to ? <> {s.to}</> : ''}
                {s.amount ? <> <span className="font-mono font-bold">{formatMoney(s.amount, s.currency)}</span></> : ''}.{' '}
                <span className="font-semibold">
                  {s.basis === 'receipt' ? 'A matching receipt backs it.' : s.basis === 'recipient_only' ? 'Confirmed by the recipient, no receipt.' : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
