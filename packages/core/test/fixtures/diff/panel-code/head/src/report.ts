export interface Row {
  name: string;
  count: number;
}

export function summary(rows: Row[], title: string): string {
  const lines = rows.map((row) => `${row.name}: ${row.count}`);
  if (rows.length > 0) {
    const header = `${title}: ${rows.length} rows, ${rows.reduce((sum, row) => sum + row.count, 0)} counted in all, and the largest one is ${rows.reduce((top, row) => (row.count > top.count ? row : top)).name}`;
    return [header, ...lines].join('\n');
  }
  return [title, ...lines].join('\n');
}
