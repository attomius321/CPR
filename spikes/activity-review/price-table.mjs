// AR1: API list prices, $ per million tokens (claude-api skill, cached 2026-10-06). Cache writes:
// 1.25× input for 5 minutes, 2× for 1 hour. Checked against Claude Code's own cost-state lines.
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
};
/** API-equivalent dollars of one usage bucket (the transcripts' fields). */
export function usd(model, u) {
  const p = PRICES[model];
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead +
    u.cacheWrite5m * p.input * 1.25 + u.cacheWrite1h * p.input * 2) / 1e6;
}
