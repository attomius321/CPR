export interface Row {
  name: string;
  count: number;
}

export function summary(rows: Row[], title: string, verbose: boolean): string {
  const lines = rows.map((row) => `${row.name}: ${row.count}`);
  return [title, ...lines].join('\n');
}
