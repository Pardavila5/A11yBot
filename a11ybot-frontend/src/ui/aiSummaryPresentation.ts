export function priorityChipColor(
  priority: 'high' | 'medium' | 'low',
): 'error' | 'warning' | 'default' {
  if (priority === 'high') return 'error';
  if (priority === 'medium') return 'warning';
  return 'default';
}

export function priorityLabel(priority: 'high' | 'medium' | 'low'): string {
  if (priority === 'high') return 'alta';
  if (priority === 'medium') return 'media';
  return 'baja';
}

export function metricLabels(metrics: {
  totalRules: number;
  violationRules: number;
  occurrences: number;
}): string[] {
  return [
    `Reglas: ${metrics.totalRules}`,
    `Violaciones: ${metrics.violationRules}`,
    `Ocurrencias: ${metrics.occurrences}`,
  ];
}

export function impactChipColor(
  impact: string | null | undefined,
): 'error' | 'warning' | 'default' {
  if (impact === 'critical' || impact === 'serious') return 'error';
  if (impact === 'moderate') return 'warning';
  return 'default';
}

export function impactLabel(impact: string | null | undefined): string {
  if (impact === 'critical') return 'crítica';
  if (impact === 'serious') return 'seria';
  if (impact === 'moderate') return 'moderada';
  if (impact === 'minor') return 'menor';
  return 'n/a';
}

export function aiSourceLabel(source: 'heuristic' | 'openai'): string {
  return source === 'openai' ? 'OpenAI' : 'heurístico';
}

export function aiResolutionStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === 'success') return 'correcto';
  if (status === 'forced_heuristic') return 'heurístico forzado';
  if (status === 'invalid_payload') return 'respuesta inválida';
  if (status === 'timeout') return 'timeout';
  if (status === 'http_error') return 'error HTTP';
  if (status === 'parse_error') return 'error de parseo';
  if (status === 'exception') return 'excepción';
  if (status === 'not_configured') return 'no configurado';
  return status;
}

export function auditStatusLabel(status: string | null | undefined): string {
  if (status === 'running') return 'en ejecución';
  if (status === 'failed') return 'fallida';
  if (status === 'completed') return 'completada';
  return status ?? 'n/a';
}
