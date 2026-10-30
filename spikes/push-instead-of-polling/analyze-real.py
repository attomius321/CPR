import json, sys
# Pairs a real agent's hook writes (thread entries) with Claude Code's list changing state.
rows = []
for f in sys.argv[1:]:
    for l in open(f):
        try: rows.append(json.loads(l))
        except: pass
rows.sort(key=lambda r: r['t'])
t0 = rows[0]['t']
names = {r['session']: r.get('name') for r in rows if r['src'] == 'agents' and r.get('session')}
interesting = [r for r in rows if r['src'] == 'threads' or (r['src'] == 'agents' and not r.get('state', '').startswith('done') and r.get('name') not in (None, 'anton-7c'))]
for r in interesting:
    who = names.get(r.get('session')) or r.get('name') or r.get('file')
    print(f"{(r['t']-t0)/1000:8.1f} {r['src'][:7]:7} {str(who)[:38]:38} {r.get('state') or r.get('kind')} {r.get('tool') or ''}")
