export function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').trim();
}

export function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}
