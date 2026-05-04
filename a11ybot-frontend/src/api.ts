import {
  AiAuditSummary,
  AiAuditSummaryAB,
  AiCompareSummary,
  AiCompareSummaryAB,
  AiRuleExplanation,
  AiTraceItem,
  AiTraceStats,
  AuditDetail,
  AuditStatusFilter,
  AuditListResponse,
  AuditRuntimeStats,
  CompareResult,
} from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function createAudit(url: string) {
  const res = await fetch(`${API_BASE}/audits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<{ url: string; timestamp: string }>;
}

export async function listAudits(params?: {
  page?: number;
  pageSize?: number;
  order?: 'asc' | 'desc';
  status?: Exclude<AuditStatusFilter, 'all'>;
  search?: string;
}): Promise<AuditListResponse> {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 10;
  const order = params?.order ?? 'desc';
  const qs = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    order,
  });
  if (params?.status) {
    qs.set('status', params.status);
  }
  if (params?.search) {
    qs.set('search', params.search);
  }
  const res = await fetch(`${API_BASE}/audits?${qs.toString()}`);
  if (!res.ok) throw new Error('No se pudieron cargar las auditorias');
  return res.json();
}

export async function getAudit(id: number): Promise<AuditDetail> {
  const res = await fetch(`${API_BASE}/audits/${id}`);
  if (!res.ok) throw new Error(`No se pudo cargar la auditoria ${id}`);
  return res.json();
}

export async function compareAudits(
  oldId: number,
  newId: number,
): Promise<CompareResult> {
  const res = await fetch(`${API_BASE}/audits/compare?old=${oldId}&new=${newId}`);
  if (!res.ok) throw new Error('No se pudo comparar');
  return res.json();
}

export async function deleteAudits(): Promise<void> {
  const res = await fetch(`${API_BASE}/audits`, { method: 'DELETE' });
  if (!res.ok) throw new Error('No se pudo borrar el historico');
}

export async function getAiAuditSummary(
  auditId: number,
  params?: {
    reuseOnly?: boolean;
    forceHeuristic?: boolean;
    maxRecommendations?: number;
    maxRules?: number;
  },
): Promise<AiAuditSummary> {
  const query = new URLSearchParams();
  if (params?.reuseOnly !== undefined) {
    query.set('reuseOnly', String(params.reuseOnly));
  }
  if (params?.forceHeuristic !== undefined) {
    query.set('forceHeuristic', String(params.forceHeuristic));
  }
  if (params?.maxRecommendations !== undefined) {
    query.set('maxRecommendations', String(params.maxRecommendations));
  }
  if (params?.maxRules !== undefined) {
    query.set('maxRules', String(params.maxRules));
  }
  const qs = query.toString();
  const res = await fetch(
    `${API_BASE}/ai/audits/${auditId}/summary${qs ? `?${qs}` : ''}`,
  );
  if (!res.ok) {
    throw new Error(`No se pudo generar el resumen IA de la auditoria ${auditId}`);
  }
  return res.json();
}

export async function getAiAuditSummaryAB(
  auditId: number,
): Promise<AiAuditSummaryAB> {
  const res = await fetch(`${API_BASE}/ai/audits/${auditId}/summary/ab`);
  if (!res.ok) {
    throw new Error(
      `No se pudo generar la comparativa A/B de la auditoria ${auditId}`,
    );
  }
  return res.json();
}

export async function explainAiRule(
  auditId: number,
  ruleId: string,
  params?: {
    ruleType?: 'violations' | 'passes' | 'incomplete';
    reuseOnly?: boolean;
    forceHeuristic?: boolean;
    maxOccurrences?: number;
  },
): Promise<AiRuleExplanation> {
  const query = new URLSearchParams();
  if (params?.ruleType) {
    query.set('ruleType', params.ruleType);
  }
  if (params?.reuseOnly !== undefined) {
    query.set('reuseOnly', String(params.reuseOnly));
  }
  if (params?.forceHeuristic !== undefined) {
    query.set('forceHeuristic', String(params.forceHeuristic));
  }
  if (params?.maxOccurrences !== undefined) {
    query.set('maxOccurrences', String(params.maxOccurrences));
  }
  const qs = query.toString();
  const encodedRuleId = encodeURIComponent(ruleId);
  const res = await fetch(
    `${API_BASE}/ai/audits/${auditId}/rules/${encodedRuleId}/explain${
      qs ? `?${qs}` : ''
    }`,
  );
  if (!res.ok) throw new Error(`No se pudo explicar la regla ${ruleId}`);
  return res.json();
}

export async function getAiCompareSummary(
  oldId: number,
  newId: number,
  params?: {
    forceHeuristic?: boolean;
    maxRecommendations?: number;
  },
): Promise<AiCompareSummary> {
  const query = new URLSearchParams({
    old: String(oldId),
    new: String(newId),
  });
  if (params?.forceHeuristic !== undefined) {
    query.set('forceHeuristic', String(params.forceHeuristic));
  }
  if (params?.maxRecommendations !== undefined) {
    query.set('maxRecommendations', String(params.maxRecommendations));
  }
  const res = await fetch(`${API_BASE}/ai/compare?${query.toString()}`);
  if (!res.ok) throw new Error('No se pudo generar el resumen IA de comparacion');
  return res.json();
}

export async function getAiCompareSummaryAB(
  oldId: number,
  newId: number,
): Promise<AiCompareSummaryAB> {
  const query = new URLSearchParams({
    old: String(oldId),
    new: String(newId),
  });
  const res = await fetch(`${API_BASE}/ai/compare/ab?${query.toString()}`);
  if (!res.ok) {
    throw new Error('No se pudo generar la comparativa A/B de comparacion');
  }
  return res.json();
}

export async function getAuditRuntimeStats(): Promise<AuditRuntimeStats> {
  const res = await fetch(`${API_BASE}/audits/runtime`);
  if (!res.ok) throw new Error('No se pudo obtener el estado runtime de auditorias');
  return res.json();
}

export async function getAiTraceStats(params?: {
  sinceDays?: number;
  operation?: 'audit_summary' | 'compare_summary' | 'rule_explain';
  source?: 'openai' | 'heuristic';
}): Promise<AiTraceStats> {
  const query = new URLSearchParams();
  if (params?.sinceDays !== undefined) {
    query.set('sinceDays', String(params.sinceDays));
  }
  if (params?.operation) query.set('operation', params.operation);
  if (params?.source) query.set('source', params.source);
  const qs = query.toString();
  const res = await fetch(`${API_BASE}/ai/traces/stats${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('No se pudo obtener la estadistica IA');
  return res.json();
}

export async function listAiTraces(params?: {
  limit?: number;
  operation?: 'audit_summary' | 'compare_summary' | 'rule_explain';
  source?: 'openai' | 'heuristic';
  auditId?: number;
}): Promise<{ total: number; items: AiTraceItem[] }> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  if (params?.operation) query.set('operation', params.operation);
  if (params?.source) query.set('source', params.source);
  if (params?.auditId !== undefined) query.set('auditId', String(params.auditId));
  const qs = query.toString();
  const res = await fetch(`${API_BASE}/ai/traces${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('No se pudo obtener la traza IA');
  return res.json();
}
