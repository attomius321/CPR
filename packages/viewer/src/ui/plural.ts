/** `n` and its word, plural when not one: "1 file", "3 files", "2 matches" (given `many`). */
export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;
