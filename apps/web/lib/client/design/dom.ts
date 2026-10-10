export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing design element: ${id}`);
  return node as T;
}
