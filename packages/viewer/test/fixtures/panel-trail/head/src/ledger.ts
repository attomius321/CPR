export interface LedgerEntry {
  account: string;
  amount: number;
  currency?: string;
}

export class Ledger {
  constructor(private readonly entries: LedgerEntry[]) {}

  total(): number {
    return this.entries.reduce((sum, entry) => sum + Math.round(entry.amount), 0);
  }

  recalculateRunningBalanceForEveryAccountInTheLedger(): Map<string, number> {
    const balances = new Map<string, number>();
    for (const entry of this.entries) {
      balances.set(entry.account, (balances.get(entry.account) ?? 0) + entry.amount);
    }
    return balances;
  }
}

export function reconcileOutstandingInvoiceBalancesForEveryCustomerAccount(entries: LedgerEntry[]): number {
  return entries.filter((entry) => entry.amount < 0).length;
}

export function summarizeQuarterlyRevenueByCustomerSegmentAndRegion(entries: LedgerEntry[]): number {
  return entries.length;
}
