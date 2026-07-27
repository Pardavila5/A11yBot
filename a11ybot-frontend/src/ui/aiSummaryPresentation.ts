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

/**
 * Estilo de chip de severidad con gradiente de rojo: cuanto mas critico, mas rojo.
 * Devuelve un objeto sx (compatible con MUI Chip).
 */
export function severityChipSx(impact: string | null | undefined) {
  switch (impact) {
    case 'critical':
      return { bgcolor: '#b71c1c', color: '#fff', borderColor: '#b71c1c' };
    case 'serious':
      return { bgcolor: '#e53935', color: '#fff', borderColor: '#e53935' };
    case 'moderate':
      return { bgcolor: '#fb8c00', color: '#fff', borderColor: '#fb8c00' };
    case 'minor':
      return { bgcolor: '#fbc02d', color: 'rgba(0,0,0,0.87)', borderColor: '#fbc02d' };
    default:
      return {
        bgcolor: 'action.selected',
        color: 'text.secondary',
        borderColor: 'divider',
      };
  }
}

const WCAG_SC_TITLES: Record<string, string> = {
  '1.1.1': 'Non-text Content',
  '1.2.1': 'Audio-only and Video-only (Prerecorded)',
  '1.3.1': 'Info and Relationships',
  '1.3.2': 'Meaningful Sequence',
  '1.3.4': 'Orientation',
  '1.3.5': 'Identify Input Purpose',
  '1.4.1': 'Use of Color',
  '1.4.2': 'Audio Control',
  '1.4.3': 'Contrast (Minimum)',
  '1.4.4': 'Resize Text',
  '1.4.10': 'Reflow',
  '1.4.11': 'Non-text Contrast',
  '1.4.12': 'Text Spacing',
  '2.1.1': 'Keyboard',
  '2.1.2': 'No Keyboard Trap',
  '2.2.1': 'Timing Adjustable',
  '2.2.2': 'Pause, Stop, Hide',
  '2.4.1': 'Bypass Blocks',
  '2.4.2': 'Page Titled',
  '2.4.3': 'Focus Order',
  '2.4.4': 'Link Purpose (In Context)',
  '2.4.6': 'Headings and Labels',
  '2.4.7': 'Focus Visible',
  '2.5.3': 'Label in Name',
  '3.1.1': 'Language of Page',
  '3.1.2': 'Language of Parts',
  '3.2.1': 'On Focus',
  '3.2.2': 'On Input',
  '3.3.1': 'Error Identification',
  '3.3.2': 'Labels or Instructions',
  '4.1.1': 'Parsing',
  '4.1.2': 'Name, Role, Value',
  '4.1.3': 'Status Messages',
};

const WCAG_LEVEL_LABELS: Record<string, string> = {
  wcag2a: 'WCAG 2.0 nivel A',
  wcag2aa: 'WCAG 2.0 nivel AA',
  wcag2aaa: 'WCAG 2.0 nivel AAA',
  wcag21a: 'WCAG 2.1 nivel A',
  wcag21aa: 'WCAG 2.1 nivel AA',
  wcag22aa: 'WCAG 2.2 nivel AA',
};

/**
 * Convierte una etiqueta WCAG de axe (p. ej. "wcag111", "wcag143", "wcag2aa")
 * en una etiqueta legible y un titulo completo para tooltip.
 */
export function wcagTagInfo(tag: string): { label: string; title: string } {
  const lower = tag.toLowerCase();
  if (WCAG_LEVEL_LABELS[lower]) {
    return { label: tag, title: WCAG_LEVEL_LABELS[lower] };
  }
  const match = lower.match(/^wcag(\d)(\d)(\d{1,2})$/);
  if (match) {
    const code = `${match[1]}.${match[2]}.${match[3]}`;
    const title = WCAG_SC_TITLES[code];
    return {
      label: `WCAG ${code}`,
      title: title ? `WCAG ${code}: ${title}` : `WCAG ${code}`,
    };
  }
  return { label: tag, title: tag };
}
