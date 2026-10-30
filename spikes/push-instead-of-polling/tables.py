# The spike's tables from the specs' JSON lines: python3 -I tables.py results.jsonl [more.jsonl …]
import json
import statistics
import sys
from collections import defaultdict

rows = []
for path in sys.argv[1:]:
    for line in open(path):
        line = line.strip()
        if line:
            rows.append(json.loads(line))

NAME = {'off': 'polling', 'both': 'push (ping + watch)', 'ping': 'push, ping only', 'watch': 'push, watch only'}


def fmt(ms):
    return '—' if ms is None else (f'{ms / 1000:.1f} s' if ms >= 1000 else f'{round(ms)} ms')


print('## Cost per minute, one tab')
print('| | Phase | Requests | KB | View CPU | Children CPU | React commits | Components rendered |')
print('|---|---|---|---|---|---|---|---|')
for r in rows:
    if r['test'] == 'cost':
        print(f"| {NAME[r['mode']]} | {r['phase']} | {r['requestsPerMin']} | {r['kbPerMin']} | {r['cpuOwnMsPerMin']} ms | {r['cpuChildrenMsPerMin']} ms | {r['commitsPerMin']} | {r['renderedPerMin']} |")

print('\n## Delay until a change shows (median, max; shown / tried in 20 s)')
cells = defaultdict(list)
for r in rows:
    if r['test'] == 'delay':
        v = r.get('shownMs') if r['kind'] != 'review' else r.get('arrivedMs')
        cells[(r['kind'], r['live'], r['mode'])].append(v)
modes = [m for m in ['off', 'both', 'ping', 'watch'] if any(k[2] == m for k in cells)]
print('| Change | Agent working? | ' + ' | '.join(NAME[m] for m in modes) + ' |')
print('|---|---|' + '---|' * len(modes))
for kind in ['agent state', 'commit (agent)', 'commit (person)', 'review', 'ask']:
    for live in [True, False]:
        out = []
        for m in modes:
            v = cells.get((kind, live, m))
            if not v:
                out.append('')
                continue
            ok = [x for x in v if x is not None]
            out.append(
                f"{fmt(statistics.median(ok))}, max {fmt(max(ok))} ({len(ok)}/{len(v)})" if ok else f'never (0/{len(v)})'
            )
        print(f"| {kind} | {'yes' if live else 'no'} | " + ' | '.join(out) + ' |')

for test in ['tabs', 'tabs share', 'merge', 'burst', 'dropped stream', 'server stopped 20 s', 'restart, same port',
             'page frozen 20 s', 'minimized browser', 'app window minimized', 'hidden frames']:
    sel = [r for r in rows if r['test'] == test]
    if sel:
        print(f'\n## {test}')
        for r in sel:
            print({k: v for k, v in r.items() if k not in ('test', 'ping')})
