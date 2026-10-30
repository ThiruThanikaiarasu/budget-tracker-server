/**
 * Key used to detect duplicate names: case-insensitive and whitespace-blind,
 * so "Potato", "potato " and "POTATO" collide, and so do "White Channa" and
 * "whitechanna".
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}
