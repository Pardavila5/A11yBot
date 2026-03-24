export interface AxeIssue {
  id: string;
  impact: string;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: {
    html: string;
    target: string[];
    failureSummary?: string;
  }[];
}

import { NormalizedRule, NormalizedOccurrence } from "./normalized-result.interface";

export interface AxeAuditResult {
  url: string;
  timestamp: string;
  rules: NormalizedRule[];
  occurrences: NormalizedOccurrence[];
}

