/**
 * Google Calendar's fixed event colors (Calendar API colors.get, "event").
 * Apps can only color events with these ids.
 */
export const EVENT_COLORS = [
  { id: "7", name: "Peacock", hex: "#039be5", note: "closest to baby blue" },
  { id: "1", name: "Lavender", hex: "#7986cb" },
  { id: "9", name: "Blueberry", hex: "#3f51b5" },
  { id: "2", name: "Sage", hex: "#33b679" },
  { id: "10", name: "Basil", hex: "#0b8043" },
  { id: "5", name: "Banana", hex: "#f6bf26" },
  { id: "6", name: "Tangerine", hex: "#f4511e" },
  { id: "4", name: "Flamingo", hex: "#e67c73" },
  { id: "11", name: "Tomato", hex: "#d50000" },
  { id: "3", name: "Grape", hex: "#8e24aa" },
  { id: "8", name: "Graphite", hex: "#616161" },
] as const;

export function colorHex(id: string): string {
  return EVENT_COLORS.find((c) => c.id === id)?.hex ?? "#9e9e9e";
}

export function isColorId(id: string): boolean {
  return EVENT_COLORS.some((c) => c.id === id);
}
