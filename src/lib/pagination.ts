export function pageNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100000, Math.max(1, Math.floor(n))) : 1;
}
