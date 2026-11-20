import { NO_HANDOFF, type HandoffInfo, type Segment } from "./types";

export class TimelineError extends Error {}

const t = (d: Date) => d.getTime();

export function sortSegments(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => t(a.start) - t(b.start));
}

/** Throws if any segment is empty or two segments overlap. */
export function assertValidTimeline(segments: Segment[]): void {
  const sorted = sortSegments(segments);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (!(t(s.start) < t(s.end))) {
      throw new TimelineError("A custody period must end after it starts.");
    }
    if (i > 0 && t(sorted[i - 1].end) > t(s.start)) {
      throw new TimelineError("Custody periods overlap.");
    }
  }
}

/** Joins back-to-back segments that belong to the same parent. */
export function mergeAdjacent(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of sortSegments(segments)) {
    const prev = out.at(-1);
    if (prev && prev.parentId === s.parentId && t(prev.end) === t(s.start)) {
      out[out.length - 1] = { ...prev, end: s.end };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

export interface Change {
  /** The range being rewritten. Everything inside it is replaced. */
  start: Date;
  end: Date;
  /** New segments, all inside [start, end). Gaps mean "not scheduled". */
  segments: Segment[];
  /**
   * Handoff details for the moment `end`, when the existing schedule
   * resumes after the change. Ignored if the same parent continues.
   */
  trailingHandoff?: HandoffInfo;
}

/**
 * Applies a change to the timeline: existing custody inside the change's
 * range is replaced, segments crossing the edges are clipped, and
 * back-to-back periods of the same parent are merged.
 */
export function applyChange(existing: Segment[], change: Change): Segment[] {
  const { start, end } = change;
  if (!(t(start) < t(end))) {
    throw new TimelineError("The change must end after it starts.");
  }
  for (const s of change.segments) {
    if (t(s.start) < t(start) || t(s.end) > t(end)) {
      throw new TimelineError("A proposed period falls outside the change.");
    }
  }
  assertValidTimeline(change.segments);
  assertValidTimeline(existing);

  const kept: Segment[] = [];
  for (const s of existing) {
    if (t(s.end) <= t(start) || t(s.start) >= t(end)) {
      kept.push(s);
      continue;
    }
    if (t(s.start) < t(start)) {
      kept.push({ ...s, end: start });
    }
    if (t(s.end) > t(end)) {
      kept.push({
        ...s,
        start: end,
        handoff: change.trailingHandoff ?? NO_HANDOFF,
      });
    }
  }
  const result = mergeAdjacent([...kept, ...change.segments]);
  assertValidTimeline(result);
  return result;
}

/** Segments that overlap or touch [start, end). */
export function segmentsTouching(
  segments: Segment[],
  start: Date,
  end: Date,
): Segment[] {
  return segments.filter(
    (s) => t(s.end) >= t(start) && t(s.start) <= t(end),
  );
}
