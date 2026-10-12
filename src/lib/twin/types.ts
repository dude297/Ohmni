// Digital twin: design (confirmed intent) vs reality (human-confirmed observed graph). Contract shared with the UI.
export type DesignProvenance = { kind: 'kicad' | 'spice' | 'fixture'; name: string; warnings: string[] };
// The observed graph is ALWAYS human-reviewed/confirmed before diff; image extraction only proposes.
export type ObservedProvenance = { kind: 'human_review' | 'image_extraction' | 'manual'; note?: string };
export type ComponentDiff = {
  componentId: string;
  kind: 'value' | 'missing_in_observed' | 'extra_in_observed' | 'kind_changed';
  intended?: { kind: string; value: number };
  observed?: { kind: string; value: number };
  ratio?: number; // observed / intended
};
export type ConnectionDiff = {
  componentId: string;
  terminal: 'positive' | 'negative';
  intendedNode: string;
  observedNode: string;
};
export type TwinDiff = {
  componentDiffs: ComponentDiff[];
  connectionDiffs: ConnectionDiff[];
  nodeMap: Record<string, string | null>; // observed node -> intended node; null = no consistent match
  identical: boolean;
  uncertainties: string[];
};
