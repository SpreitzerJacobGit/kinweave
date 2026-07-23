/**
 * The output artifact — a "Proposed Hangout" surfaced identically to both owners
 * at S6 (Owner Review). Versioned; the version hash binds the G4 commitment.
 * See spec/05-hangout-artifact.md.
 */

export type ConfidenceLabel = 'low' | 'moderate' | 'high';

export interface RationaleAxis {
  score: number; // 0..1
  evidence: string[];
  conflicts?: string[]; // honest conflicts — must be surfaced, not hidden
}

export interface CompatibilityRationale {
  overallConfidence: number; // 0..1
  label: ConfidenceLabel;
  axes: {
    interestOverlap: RationaleAxis;
    valueAlignment: RationaleAxis;
    scheduleFit: RationaleAxis;
    geoConvenience: RationaleAxis;
  };
  honestCaveats: string[];
  noveltyFlag: boolean;
}

export interface DisclosureLedgerView {
  myRevealed: string[]; // field keys I disclosed
  theirRevealed: string[]; // field keys the counterpart disclosed
  stillPrivate: string[]; // field keys NOT shared
}

export interface HangoutPlan {
  activity: { class: string; specific: string; whyThis: string };
  place: {
    type: string;
    name?: string;
    geoCell: string;
    isPublic: boolean;
    accessibilityNotes?: string;
  };
  time: { date: string; start: string; end: string; timezone: string };
  fallback?: { altTime?: string; altPlace?: string };
  estCostBand: 'free' | 'low' | 'medium';
  logisticsNotes?: string[];
}

export interface ProposedHangout {
  artifactId: string;
  versionHash: string; // binds the G4 approval
  status:
    | 'pending_review'
    | 'edited'
    | 'approved'
    | 'declined'
    | 'committed';
  plan: HangoutPlan;
  compatibilityRationale: CompatibilityRationale;
  disclosureLedger: DisclosureLedgerView;
  provenance: {
    stagesTraversed: string[];
    roundsUsed: { probe: number; align: number; coplan: number; owner: number };
    transcriptRef: string;
  };
}
