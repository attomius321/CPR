import { Ledger, type LedgerEntry } from './ledger';

export function renderQuarterlyLedgerReportForTheFinanceTeamDashboard(entries: LedgerEntry[]): string {
  const ledger = new Ledger(entries);
  return `total ${ledger.legacyTotal()}`;
}

export function printAnnualLedgerSummaryWithEveryAccountBalanceIncluded(entries: LedgerEntry[]): string {
  return String(new Ledger(entries).legacyTotal());
}
