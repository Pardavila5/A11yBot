export type NormalizedRule = {
  ruleId: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  wcag: string[];
  type: 'violations' | 'passes' | 'incomplete';
};

export type NormalizedOccurrence = {
  ruleId: string;
  type: 'violations' | 'passes' | 'incomplete';
  htmlSnippet: string;
  target: string[];
  failureSummary?: string | null;
};

export type AuditListItem = {
  id: number;
  website: string;
  timestamp: string;
  status?: string | null;
  notes?: string | null;
};

export type AuditListResponse = {
  total: number;
  page: number;
  pageSize: number;
  items: AuditListItem[];
};

export type AuditSummary = {
  id: number;
  label: string;
};

export type AuditDetail = {
  id: number;
  url: string;
  timestamp: string;
  status?: string | null;
  notes?: string | null;
  rawJson: unknown;
  rules: (NormalizedRule & { id: number })[];
  occurrences: {
    id: number;
    ruleRef: number;
    htmlSnippet: string;
    target: string[];
    failureSummary: string | null;
  }[];
};

export type CompareResult = {
  audits: {
    old: { id: number; url: string; timestamp: string };
    new: { id: number; url: string; timestamp: string };
  };
  summary: {
    totalViolationRulesOld: number;
    totalViolationRulesNew: number;
    totalOccurrencesOld: number;
    totalOccurrencesNew: number;
    deltaViolationRules: number;
    newViolationRules: number;
    resolvedViolationRules: number;
    persistentViolationRules: number;
  };
  newViolations: (NormalizedRule & {
    occurrences: {
      id: number;
      htmlSnippet: string;
      target: string[];
      failureSummary: string | null;
    }[];
  })[];
  resolvedViolations: CompareResult['newViolations'];
  persistentViolations: CompareResult['newViolations'];
};

export type AiRecommendation = {
  title: string;
  reason: string;
  actions: string[];
  priority: 'high' | 'medium' | 'low';
  ruleId?: string;
};

export type AiResolution = {
  attempted: boolean;
  status: string | null;
  usedFallback: boolean;
  reason: string | null;
  latencyMs: number | null;
};

export type AiSummaryBase = {
  traceId?: number | null;
  source: 'heuristic' | 'openai';
  generatedAt: string;
  model: string | null;
  resolution: AiResolution;
  executiveSummary: string;
  technicalSummary: string;
  recommendations: AiRecommendation[];
};

export type AiAuditSummary = AiSummaryBase & {
  audit: {
    id: number;
    url: string;
    timestamp: string;
    status: string | null;
  };
  metrics: {
    rules: {
      total: number;
      violations: number;
      passes: number;
      incomplete: number;
    };
    occurrences: number;
    topViolations: {
      ruleId: string;
      impact: string | null;
      occurrences: number;
      score: number;
    }[];
  };
};

export type AiRuleExplanation = {
  traceId?: number | null;
  source: 'heuristic' | 'openai';
  generatedAt: string;
  model: string | null;
  resolution?: AiResolution;
  audit: {
    id: number;
    url: string;
    timestamp: string;
    status: string | null;
  };
  rule: {
    ruleId: string;
    type: string;
    impact: string | null;
    description: string;
    help: string;
    helpUrl: string;
    wcag: string[];
    occurrences: number;
    samples: {
      target: string[];
      failureSummary: string | null;
      htmlSnippet: string;
    }[];
  };
  explanation: {
    summary: string;
    whyItMatters: string;
    fixes: string[];
    testChecklist: string[];
  };
};

export type AiCompareSummary = AiSummaryBase & {
  audits: CompareResult['audits'];
  summary: CompareResult['summary'];
};

export type AiAuditSummaryAB = {
  generatedAt: string;
  operation: 'audit_summary';
  auditId: number;
  heuristic: AiAuditSummary;
  assisted: AiAuditSummary;
  diff: {
    sourceChanged: boolean;
    recommendationDelta: number;
    fallbackTriggered: boolean;
    assistedStatus: string | null;
  };
};

export type AiCompareSummaryAB = {
  generatedAt: string;
  operation: 'compare_summary';
  oldId: number;
  newId: number;
  heuristic: AiCompareSummary;
  assisted: AiCompareSummary;
  diff: {
    sourceChanged: boolean;
    recommendationDelta: number;
    fallbackTriggered: boolean;
    assistedStatus: string | null;
  };
};

export type AuditRuntimeStats = {
  activeAudits: number;
  activeByHost: Record<string, number>;
  queued: number;
  limits: {
    global: number;
    perHost: number;
  };
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  allowPrivateTargets: boolean;
};

export type AiTraceStats = {
  window: {
    sinceDays: number | null;
    total: number;
  };
  usage: {
    byOperation: Record<string, number>;
    bySource: Record<string, number>;
    byModel: Record<string, number>;
    fallbackRate: number;
    openAiRate: number;
  };
  latency: {
    avgMs: number;
    openAiAvgMs: number;
  };
  attempts: {
    byStatus: Record<string, number>;
  };
};

export type AiTraceItem = {
  id: number;
  createdAt: string;
  operation: string;
  source: 'heuristic' | 'openai';
  model: string | null;
  auditId: number | null;
  compareOldAudit: number | null;
  compareNewAudit: number | null;
  ruleId: string | null;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  requestMeta: unknown;
  responseMeta: unknown;
};
