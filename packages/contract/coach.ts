/** `daily`: the morning brief. `weekly`: the Sunday check-in. */
export type CoachBriefKind = "daily" | "weekly";

/**
 * A brief the Coach wrote on its own. One per kind and period: `period` is the
 * local date (YYYY-MM-DD) for a daily brief and the week's Sunday for a weekly
 * one. While `running`, `text` keeps the previous version (if any) so a
 * regenerate never blanks the card. Times are epoch ms.
 */
export type CoachBrief = {
  id: string;
  kind: CoachBriefKind;
  period: string;
  status: "running" | "done" | "error";
  /** Markdown, in Spanish. Empty until the first generation finishes. */
  text: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

/** GET /api/mobile/coach/brief: the latest of each kind. */
export type CoachBriefs = { daily: CoachBrief | null; weekly: CoachBrief | null };

export type RegenerateBriefRequest = { kind?: CoachBriefKind };
