# Journal: V98 — Pages loaded on demand: a smaller first script

[Index](../JOURNAL.md) · [Plan](../plan/v98-pages-on-demand.md)

## V98 spike (2026-11-06, from chore/improvement-audit)

The improvement audit's `pnpm build` of `main` c2aa5c4 (5 s; the viewer's bundle in 392 ms):

| Asset | Size | gzip |
|---|---|---|
| `index-C32ADK0U.js` | 1,158.8 kB | 363.6 kB |
| `xterm-ScmBfeDI.js` | 331.2 kB | 83.0 kB |
| `play-CIz0ZEKD.js` | 65.8 kB | 28.0 kB |
| `marked.esm-CAMd3wer.js` | 46.1 kB | 13.7 kB |
| `index-Cc_R1sFv.css` | 260.3 kB | 44.6 kB |

Vite warns that a chunk is over 500 kB. Every shell page is imported statically by
`src/shell/Shell.tsx`.

First paint on this machine is fast:
- 44–130 ms to the page head on the e2e fixtures;
- Bitwarden 737ee3f: first paint 307–340 ms, select 103–104 ms, mark 34 ms, pan 63 fps, over 3
  rounds.

So the case is load and parse cost on slower machines; V98a measures it before anything is split.

Not started.
