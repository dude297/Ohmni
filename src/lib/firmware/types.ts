export type AdcBits = 8 | 10 | 12 | 14 | 16;
export type AdcFormula = 'counts*vref/(2^bits-1)' | 'counts*vref/2^bits';

/** What the FIRMWARE assumes (extracted from code or typed by the user). */
export type AdcConfig = {
  mcu?: string;
  bits: AdcBits;
  vrefVolts: number;
  vrefSource: 'vdd' | 'internal' | 'external';
  dividerRatioInCode?: number; // factor the code multiplies back up by (default 1)
  formulaInCode: AdcFormula;
};

export type AdcReported = { volts?: number; counts?: number };

export type DiagnosisKind =
  | 'vref_mismatch'
  | 'bit_depth_mismatch'
  | 'divider_ratio_mismatch'
  | 'formula_off_by_one'
  | 'circuit_fault'
  | 'consistent';

export type Diagnosis = {
  id: string;
  title: string;
  kind: DiagnosisKind;
  evidence: string;
  /** volts when reported.volts was given, otherwise counts */
  predictedReported: number;
  /** |predicted - reported|, same unit as predictedReported */
  fitError: number;
  /** machine-readable code-side fix, used for corrections and diffs */
  change?: { param: 'vref' | 'bits' | 'ratio' | 'formula'; from: number | string; to: number | string };
};

export type Correction = { file?: string; before: string; after: string; explanation: string };

export type AnalyzeResult = {
  expectedVolts: number;
  measuredVolts: number;
  reportedVolts: number;
  impliedCounts: number;
  unit: 'volts' | 'counts';
  tolerance: number;
  circuitOk: boolean;
  /** set when the circuit itself looks wrong: hand off to Probe Guide */
  handoff?: 'probe-guide';
  diagnoses: Diagnosis[];
  best: Diagnosis;
  /** best fit is within tolerance (otherwise nothing single-assumption explains the report) */
  confident: boolean;
  /** other diagnoses indistinguishable from best (within tolerance) */
  ties: string[];
  correction?: Correction;
};

export type CodeFinding = { field: string; value: number | string; line: number; text: string; raw?: string };
export type CodeExtraction = {
  config: Partial<AdcConfig>;
  findings: CodeFinding[];
  warnings: string[];
};
