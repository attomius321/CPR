// AR1: the per-token prices Claude Code itself used, fitted from its own `cost-state` lines
// (modelUsage: tokens and costUSD per model). Read only. Usage: node prices.mjs
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
const raw = execSync(`grep -rh '"type":"cost-state"' ${homedir()}/.claude/projects --include='*.jsonl' || true`, { maxBuffer: 1 << 28 }).toString();
const rows = {};
for (const l of raw.split('\n')) {
  if (!l) continue;
  let o; try { o = JSON.parse(l); } catch { continue; }
  for (const [m, u] of Object.entries(o.modelUsage ?? {})) {
    (rows[m] ??= new Map()).set(JSON.stringify(u), u);
  }
}
// least squares on [input, output, cacheRead, cw5m, cw1h] -> costUSD, per model
function solve(A, b) {
  const n = A[0].length;
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (j < n ? A.reduce((s, r) => s + r[i] * r[j], 0) : A.reduce((s, r, k) => s + r[i] * b[k], 0))));
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? null : r[n] / r[i]));
}
for (const [m, set] of Object.entries(rows)) {
  const us = [...set.values()];
  const A = us.map((u) => [u.inputTokens, u.outputTokens, u.cacheReadInputTokens, u.cacheCreationEphemeral5mInputTokens ?? 0, u.cacheCreationEphemeral1hInputTokens ?? 0].map((x) => x / 1e6));
  const b = us.map((u) => u.costUSD);
  const x = solve(A, b);
  console.log(m, us.length, 'samples; $/M input, output, cache read, write 5m, write 1h:', x.map((v) => (v == null ? '-' : v.toFixed(3))).join(', '));
}
