import {
  NormalizedOccurrence,
  NormalizedRule,
} from './normalized-result.interface';

export interface AxeNodeResult {
  html: string;
  target: string[];
  failureSummary?: string;
}

export interface AxeIssue {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNodeResult[];
}

export interface AxeResultsByType {
  violations: AxeIssue[];
  passes: AxeIssue[];
  incomplete: AxeIssue[];
}

export interface AxeAuditResult {
  url: string;
  timestamp: string;
  rules: NormalizedRule[];
  occurrences: NormalizedOccurrence[];
}
