export interface NormalizedRule {
  ruleId: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  wcag: string[];
  type: 'violations' | 'passes' | 'incomplete';
}

export interface NormalizedOccurrence {
  ruleId: string;
  type: 'violations' | 'passes' | 'incomplete';
  htmlSnippet: string;
  target: string[];
  failureSummary?: string | null;
}