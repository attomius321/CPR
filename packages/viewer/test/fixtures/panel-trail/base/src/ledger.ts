export interface LedgerEntry {
  account: string;
  amount: number;
}

export class Ledger {
  constructor(private readonly entries: LedgerEntry[]) {}

  total(): number {
    return this.entries.reduce((sum, entry) => sum + entry.amount, 0);
  }

  legacyTotal(): number {
    return this.total();
  }
}

export function reconcileOutstandingInvoiceBalancesForEveryCustomerAccount(entries: LedgerEntry[]): number {
  return entries.filter((entry) => entry.amount < 0).length;
}

export function summarizeQuarterlyRevenueByCustomerSegmentAndRegion(entries: LedgerEntry[]): number {
  return entries.length;
}
