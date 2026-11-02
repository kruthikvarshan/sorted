import { Commitment, User, Workspace } from '../types/groupOs';
import { computeLedger } from './ledger';
import { isMine } from './privateView';
import { sameName } from './receiptVerifier';

/** The money picture from one person's point of view, across the groups they put in scope. */

export interface MoneyLine {
  workspaceId: string;
  workspaceTitle: string;
  commitmentId?: string;
  counterparty?: string;
  amount?: number;
  currency: string;
  note?: string;
}

export interface MyMoney {
  /** Net amounts you still owe, per group and person. */
  iOwe: MoneyLine[];
  /** Net amounts others still owe you. */
  owedToMe: MoneyLine[];
  /** Payments someone says they made to you that you have not confirmed or disputed. */
  waitingOnMe: MoneyLine[];
  /** Payments you say you made that the recipient has not confirmed. */
  myClaims: MoneyLine[];
}

export function computeMyMoney(
  workspaces: Workspace[],
  scopedIds: string[],
  commitmentsByWs: Record<string, Commitment[]>,
  user: User
): MyMoney {
  const out: MyMoney = { iOwe: [], owedToMe: [], waitingOnMe: [], myClaims: [] };
  for (const ws of workspaces.filter(w => scopedIds.includes(w.id))) {
    const commitments = commitmentsByWs[ws.id] || [];
    const ledger = computeLedger(commitments);
    const base = { workspaceId: ws.id, workspaceTitle: ws.title };

    for (const b of ledger.balances) {
      if (sameName(user.name, b.from) === true) out.iOwe.push({ ...base, counterparty: b.to, amount: b.amount, currency: b.currency });
      else if (sameName(user.name, b.to) === true) out.owedToMe.push({ ...base, counterparty: b.from, amount: b.amount, currency: b.currency });
    }
    for (const c of ledger.claims) {
      const state = c.verification?.state;
      if (state === 'confirmed') continue;
      const line: MoneyLine = { ...base, commitmentId: c.commitmentId, amount: c.amount, currency: c.currency };
      if (c.to && sameName(user.name, c.to) === true && state !== 'disputed') {
        out.waitingOnMe.push({ ...line, counterparty: c.from, note: state === 'receipt_consistent' ? 'A receipt agrees with it' : 'No receipt yet' });
      }
      const owner = commitments.find(x => x.id === c.commitmentId);
      if (owner && isMine(owner, user)) {
        out.myClaims.push({ ...line, counterparty: c.to ?? c.description, note: state === 'disputed' ? 'Disputed by the recipient' : state ? 'Receipt attached, not yet confirmed' : 'No receipt, not yet confirmed' });
      }
    }
  }
  return out;
}
