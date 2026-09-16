export type SuggestionCategory =
  "question" | "objection" | "action" | "insight";

export interface LiveSuggestionItem {
  id: string;
  category: SuggestionCategory;
  text: string;
  rationale: string;
  timestamp_ms: number;
}
