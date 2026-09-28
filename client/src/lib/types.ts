export type Doc = { id: string; name: string; text: string; addedAt: string };

export type Site = {
  id: string;
  name: string;
  styleGuide: string;
  template: string;
  examples: Doc[];
};

export type Settings = {
  evidenceProvider: 'claude' | 'external';
  webSearch: boolean;
  defaultSiteId: string | null;
  defaultNoteType: string;
};

export type Library = {
  version: 1;
  rulebook: Doc[];
  personalStyle: string;
  sites: Site[];
  settings: Settings;
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type Citation = { source: string; section: string; quote: string };

export type ScreeningResult = {
  case_summary: string;
  options: {
    disposition: string;
    confidence: number;
    rationale: string;
    criteria_met: string[];
    concerns: string[];
    citations: Citation[];
  }[];
  decision_path: { step: string; finding: string; outcome: string; citation: Citation | null }[];
  exclusions_triggered: { rule: string; explanation: string; citation: Citation }[];
  missing_information: { item: string; impact: string }[];
  red_flags: string[];
  rulebook_conflicts: string[];
  caveats: string;
};

export type ServerConfig = {
  model: string;
  passcodeRequired: boolean;
  apiKeyConfigured: boolean;
  externalEvidence: boolean;
};

export const NOTE_TYPES = [
  'H&P',
  'Progress note',
  'Consult note',
  'Discharge summary',
  'ED observation note',
  'Transfer / sign-out note',
  'Procedure note',
];
