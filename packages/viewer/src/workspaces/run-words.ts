// The Run tab's small words (V92): a commit's short SHA, a time of day, and an address's parts.
export const short = (sha: string) => sha.slice(0, 7);

export const enc = encodeURIComponent;

const two = (n: number) => String(n).padStart(2, '0');

/** A time of day: "12:44". */
export const hm = (at: number | string) => {
  const date = new Date(at);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
};
