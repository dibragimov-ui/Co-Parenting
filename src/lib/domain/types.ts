export const HANDOFF_KINDS = [
  "school_dropoff",
  "school_pickup",
  "exchange",
  "other",
] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export const HANDOFF_LABELS: Record<HandoffKind, string> = {
  school_dropoff: "school drop-off",
  school_pickup: "school pick-up",
  exchange: "exchange",
  other: "handoff",
};

export interface HandoffInfo {
  kind: HandoffKind | null;
  location: string | null;
  note: string | null;
}

/**
 * One parent has the kids from `start` (inclusive) until `end` (exclusive).
 * `handoff` describes how this segment begins, i.e. the handoff at `start`.
 */
export interface Segment {
  parentId: string;
  start: Date;
  end: Date;
  handoff: HandoffInfo;
}

export const NO_HANDOFF: HandoffInfo = { kind: null, location: null, note: null };
