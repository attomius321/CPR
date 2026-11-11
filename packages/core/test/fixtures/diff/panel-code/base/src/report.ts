export interface Row {
  name: string;
  count: number;
}

export function summary(rows: Row[], title: string, verbose: boolean): string {
  const lines = rows.map((row) => `${row.name}: ${row.count}`);
  return [title, ...lines].join('\n');
}

/** The pages a report can open: 40, one added by the change. */
export type Page =
  | { page: 'p0' }
  | { page: 'p1' }
  | { page: 'p2' }
  | { page: 'p3' }
  | { page: 'p4' }
  | { page: 'p5' }
  | { page: 'p6' }
  | { page: 'p7' }
  | { page: 'p8' }
  | { page: 'p9' }
  | { page: 'p10' }
  | { page: 'p11' }
  | { page: 'p12' }
  | { page: 'p13' }
  | { page: 'p14' }
  | { page: 'p15' }
  | { page: 'p16' }
  | { page: 'p17' }
  | { page: 'p18' }
  | { page: 'p19' }
  | { page: 'p21' }
  | { page: 'p22' }
  | { page: 'p23' }
  | { page: 'p24' }
  | { page: 'p25' }
  | { page: 'p26' }
  | { page: 'p27' }
  | { page: 'p28' }
  | { page: 'p29' }
  | { page: 'p30' }
  | { page: 'p31' }
  | { page: 'p32' }
  | { page: 'p33' }
  | { page: 'p34' }
  | { page: 'p35' }
  | { page: 'p36' }
  | { page: 'p37' }
  | { page: 'p38' }
  | { page: 'p39' }
  | { page: 'p40' };
