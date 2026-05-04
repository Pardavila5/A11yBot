import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  createAudit,
  deleteAudits,
  explainAiRule,
  getAiAuditSummary,
  getAiAuditSummaryAB,
  getAudit,
  listAudits,
} from '../api';
import {
  AiAuditSummary,
  AiAuditSummaryAB,
  AiRuleExplanation,
  AuditDetail,
  AuditListItem,
  AuditListResponse,
  AuditStatusFilter,
} from '../types';
import { formatDate, formatErrorMessage } from '../lib/format';
import AiAbComparisonCard from '../ui/AiAbComparisonCard';
import {
  aiResolutionStatusLabel,
  aiSourceLabel,
  auditStatusLabel,
  impactChipColor,
  impactLabel,
  metricLabels,
  priorityChipColor,
  priorityLabel,
} from '../ui/aiSummaryPresentation';
import { useToast } from '../ui/ToastProvider';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Pagination,
  Skeleton,
  Stack,
  TextField,
  Tabs,
  Tab,
  Tooltip,
  Typography,
  Select,
  type ChipProps,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

const DEFAULT_PAGE_SIZE = 5;

type StatusChipConfig = {
  label: string;
  color?: ChipProps['color'];
  variant?: ChipProps['variant'];
};

function statusChipProps(status: string | null | undefined): StatusChipConfig | null {
  if (!status) return null;
  if (status === 'running') return { label: auditStatusLabel(status), color: 'warning', variant: 'filled' };
  if (status === 'failed') return { label: auditStatusLabel(status), color: 'error', variant: 'filled' };
  if (status === 'completed') return { label: auditStatusLabel(status), color: 'success', variant: 'outlined' };
  return { label: auditStatusLabel(status), variant: 'outlined' };
}

function renderAuditSummaryDetails(summary: AiAuditSummary) {
  const labels = metricLabels({
    totalRules: summary.metrics.rules.total,
    violationRules: summary.metrics.rules.violations,
    occurrences: summary.metrics.occurrences,
  });
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
        <Chip size="small" label={labels[0]} variant="outlined" />
        <Chip
          size="small"
          label={labels[1]}
          color="error"
          variant="outlined"
        />
        {summary.metrics.rules.incomplete > 0 && (
          <Chip
            size="small"
            label={`Revisión manual: ${summary.metrics.rules.incomplete}`}
            color="warning"
            variant="outlined"
          />
        )}
        <Chip size="small" label={labels[2]} variant="outlined" />
      </Stack>
      {summary.metrics.topViolations.length > 0 && (
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {summary.metrics.topViolations.map((item) => (
            <Chip
              key={item.ruleId}
              size="small"
              label={`${item.ruleId} (${item.occurrences})`}
              variant="outlined"
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

const CHIP_PILL_SX = {
  borderRadius: 999,
};

const SEVERITY_CHIP_SX = {
  borderRadius: 999,
  minWidth: 84,
  justifyContent: 'center',
};

function ruleExplainTooltip(ruleType: string): string {
  if (ruleType === 'passes') return 'Interpretar por qué esta comprobación ha pasado correctamente';
  if (ruleType === 'incomplete') return 'Analizar qué debe revisarse manualmente en esta comprobación';
  return 'Generar explicación práctica de esta regla';
}

function ruleExplainButtonLabel(
  ruleType: string,
  loading: boolean,
  hasExplanation: boolean,
): string {
  if (loading) return 'Generando IA...';
  if (ruleType === 'passes') return hasExplanation ? 'Actualizar análisis' : 'Analizar pass';
  if (ruleType === 'incomplete') return hasExplanation ? 'Actualizar revisión' : 'Revisar IA';
  return hasExplanation ? 'Actualizar IA' : 'Explicar IA';
}

function ruleAiCardTitle(ruleType: string): string {
  if (ruleType === 'passes') return 'Análisis IA del pass';
  if (ruleType === 'incomplete') return 'Análisis IA de revisión manual';
  return 'Explicación IA';
}

function getRecommendationBadge(
  recommendation: AiAuditSummary['recommendations'][number],
  rules: AuditDetail['rules'],
): { label: string; color: 'error' | 'warning' | 'default' } {
  if (recommendation.ruleId) {
    const matchingRule = rules.find((rule) => rule.ruleId === recommendation.ruleId);
    if (matchingRule?.impact) {
      return {
        label: impactLabel(matchingRule.impact),
        color: impactChipColor(matchingRule.impact),
      };
    }
  }

  return {
    label: priorityLabel(recommendation.priority),
    color: priorityChipColor(recommendation.priority),
  };
}

function parseFailureSummary(summary: string | null | undefined): {
  heading: string | null;
  items: string[];
} {
  const normalized = (summary ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { heading: null, items: [] };
  }

  const headingMatch = normalized.match(/^(Fix any of the following|Fix all of the following):\s*/i);
  const heading = headingMatch ? headingMatch[1] : null;
  let body = headingMatch ? normalized.slice(headingMatch[0].length) : normalized;

  const splitPatterns = [
    / (?=aria-label attribute)/g,
    / (?=aria-labelledby attribute)/g,
    / (?=Element does not have )/g,
    / (?=Element is in tab order)/g,
    / (?=Element does not have text that is visible to screen readers)/g,
    / (?=Element has no title attribute)/g,
    / (?=Element's default semantics were not overridden)/g,
    / (?=Document does not have )/g,
    / (?=Some page content is not contained by landmarks)/g,
    / (?=Element's background color could not be determined)/g,
  ];

  for (const pattern of splitPatterns) {
    body = body.replace(pattern, '\n');
  }

  const items = body
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return {
    heading,
    items: items.length > 0 ? items : [normalized],
  };
}

function OccurrenceGroups({
  items,
  ruleType,
}: {
  items: { id: number; htmlSnippet: string; target: string[]; failureSummary: string | null }[];
  ruleType: 'violations' | 'passes' | 'incomplete';
}) {
  const STEP = 20;
  const [visibleCount, setVisibleCount] = useState(STEP);

  useEffect(() => {
    setVisibleCount(STEP);
  }, [items]);

  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Sin ocurrencias vinculadas.
      </Typography>
    );
  }

  const visibleItems = items.slice(0, visibleCount);
  const remaining = items.length - visibleItems.length;
  const allSummaryGroups = new Map<string, typeof items>();

  for (const item of items) {
    const summary = item.failureSummary?.trim() ?? '';
    if (!summary) continue;
    const group = allSummaryGroups.get(summary) ?? [];
    group.push(item);
    allSummaryGroups.set(summary, group);
  }

  const visibleSummaryGroups = new Map<string, typeof items>();
  for (const item of visibleItems) {
    const summary = item.failureSummary?.trim() ?? '';
    if (!summary) continue;
    const group = visibleSummaryGroups.get(summary) ?? [];
    group.push(item);
    visibleSummaryGroups.set(summary, group);
  }

  const renderedSummaryGroups = new Set<string>();

  function renderOccurrenceCard(
    occurrence: (typeof items)[number],
    index: number,
    hideFailureSummary: boolean,
  ) {
    const parsedFailureSummary = parseFailureSummary(occurrence.failureSummary);

    return (
      <Card key={occurrence.id} variant="outlined">
        <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
          <Stack spacing={1}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              useFlexGap
              flexWrap="wrap"
            >
              <Typography variant="caption" color="text.secondary">
                Ocurrencia {index + 1}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={occurrence.target.join(', ')}
                sx={{
                  maxWidth: '100%',
                  height: 'auto',
                  alignSelf: 'flex-start',
                  '& .MuiChip-label': {
                    display: 'block',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    lineHeight: 1.35,
                    paddingTop: '8px',
                    paddingBottom: '8px',
                  },
                }}
              />
            </Stack>
            {occurrence.failureSummary && !hideFailureSummary && (
              <Box
                sx={(theme) => ({
                  px: 1.25,
                  py: 1,
                  borderRadius: 2,
                  border: `1px solid ${theme.palette.divider}`,
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(148, 163, 184, 0.06)'
                      : 'rgba(15, 23, 42, 0.03)',
                })}
              >
                {parsedFailureSummary.heading && (
                  <Typography variant="caption" color="text.secondary">
                    {parsedFailureSummary.heading}
                  </Typography>
                )}
                <Stack
                  spacing={0.4}
                  sx={{ mt: parsedFailureSummary.heading ? 0.5 : 0 }}
                >
                  {parsedFailureSummary.items.map((item, failureIndex) => (
                    <Typography
                      key={`${occurrence.id}-failure-${failureIndex}`}
                      variant="body2"
                    >
                      - {item}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}
            <Box
              sx={(theme) => ({
                p: 1.25,
                borderRadius: 2,
                border: `1px solid ${theme.palette.divider}`,
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(2, 6, 23, 0.92)'
                    : 'rgba(15, 23, 42, 0.04)',
              })}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.75 }}
              >
                HTML detectado
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  overflowX: 'auto',
                  fontSize: 13,
                  color: '#f8fafc',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {occurrence.htmlSnippet}
              </Box>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {ruleType === 'incomplete' && (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label="Evidencia automática de revisión manual"
          sx={{ alignSelf: 'flex-start' }}
        />
      )}
      {visibleItems.map((item, index) => {
        const normalizedSummary = item.failureSummary?.trim() ?? '';
        const visibleGroup = normalizedSummary
          ? visibleSummaryGroups.get(normalizedSummary) ?? []
          : [];
        const allGroup = normalizedSummary
          ? allSummaryGroups.get(normalizedSummary) ?? []
          : [];
        const hasGroupedSummary = normalizedSummary.length > 0;

        if (!hasGroupedSummary) {
          return renderOccurrenceCard(item, index, false);
        }

        if (renderedSummaryGroups.has(normalizedSummary)) {
          return null;
        }

        renderedSummaryGroups.add(normalizedSummary);
        const parsedSummary = parseFailureSummary(normalizedSummary);

        return (
          <Card
            key={`group-${normalizedSummary}`}
            variant="outlined"
            sx={{ borderStyle: 'dashed' }}
          >
            <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="caption" color="text.secondary">
                Motivo automático detectado en {allGroup.length}{' '}
                {allGroup.length === 1 ? 'ocurrencia' : 'ocurrencias'}
              </Typography>
              {parsedSummary.heading && (
                <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 700 }}>
                  {parsedSummary.heading}
                </Typography>
              )}
              <Stack spacing={0.4} sx={{ mt: 0.75 }}>
                {parsedSummary.items.map((summaryItem, summaryIndex) => (
                  <Typography
                    key={`${normalizedSummary}-${summaryIndex}`}
                    variant="body2"
                  >
                    - {summaryItem}
                  </Typography>
                ))}
              </Stack>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {visibleGroup.map((groupItem) => {
                  const visibleIndex = visibleItems.findIndex(
                    (candidate) => candidate.id === groupItem.id,
                  );
                  return renderOccurrenceCard(groupItem, visibleIndex, true);
                })}
              </Stack>
            </CardContent>
          </Card>
        );
      })}
      {remaining > 0 && (
        <Button
          variant="text"
          onClick={() => setVisibleCount((c) => Math.min(items.length, c + STEP))}
        >
          Mostrar {Math.min(STEP, remaining)} más
        </Button>
      )}
      {items.length > STEP && remaining <= 0 && (
        <Button variant="text" onClick={() => setVisibleCount(STEP)}>
          Mostrar menos
        </Button>
      )}
    </Stack>
  );
}

export default function AuditsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const selectedId = params.id ? Number(params.id) : null;
  const { showToast } = useToast();

  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

  const [urlInput, setUrlInput] = useState('https://example.com');

  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [audits, setAudits] = useState<AuditListItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);

  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [detailTab, setDetailTab] = useState<'violations' | 'passes' | 'incomplete'>('violations');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<AiAuditSummary | null>(null);
  const [aiSummaryAbLoading, setAiSummaryAbLoading] = useState(false);
  const [aiSummaryAb, setAiSummaryAb] = useState<AiAuditSummaryAB | null>(null);
  const [aiRuleLoading, setAiRuleLoading] = useState<Record<string, boolean>>({});
  const [aiRuleExplanations, setAiRuleExplanations] = useState<Record<string, AiRuleExplanation>>({});
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | false>(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<AuditStatusFilter>('all');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const detailCounts = useMemo(() => {
    if (!detail) return { violations: 0, passes: 0, incomplete: 0 };
    const counts = { violations: 0, passes: 0, incomplete: 0 };
    for (const r of detail.rules) {
      if (r.type === 'violations') counts.violations += 1;
      if (r.type === 'passes') counts.passes += 1;
      if (r.type === 'incomplete') counts.incomplete += 1;
    }
    return counts;
  }, [detail]);

  useEffect(() => {
    const requestId = ++listRequestIdRef.current;

    async function fetchAudits() {
      try {
        setListLoading(true);
        const data: AuditListResponse = await listAudits({
          page,
          pageSize,
          order: 'desc',
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: searchTerm.trim() || undefined,
        });
        if (requestId !== listRequestIdRef.current) return;
        setAudits(data.items);
        setTotal(data.total);
        setPage(data.page);
      } catch (err: unknown) {
        if (requestId !== listRequestIdRef.current) return;
        showToast({ message: formatErrorMessage(err), severity: 'error' });
      } finally {
        if (requestId !== listRequestIdRef.current) return;
        setListLoading(false);
      }
    }

    void fetchAudits();
  }, [page, pageSize, searchTerm, showToast, statusFilter]);

  useEffect(() => {
    setAiSummary(null);
    setAiSummaryAb(null);
    setAiRuleLoading({});
    setAiRuleExplanations({});
    setExpandedRuleKey(false);
    if (!selectedId || Number.isNaN(selectedId)) {
      setDetail(null);
      return;
    }

    const auditId = selectedId;
    const requestId = ++detailRequestIdRef.current;

    async function fetchDetail() {
      try {
        setDetailLoading(true);
        const data = await getAudit(auditId);
        if (requestId !== detailRequestIdRef.current) return;
        setDetail(data);
      } catch (err: unknown) {
        if (requestId !== detailRequestIdRef.current) return;
        setDetail(null);
        showToast({ message: formatErrorMessage(err), severity: 'error' });
      } finally {
        if (requestId !== detailRequestIdRef.current) return;
        setDetailLoading(false);
      }
    }

    void fetchDetail();
  }, [selectedId, showToast]);

  useEffect(() => {
    if (!detail) return;
    const auditId = detail.id;
    let cancelled = false;

    async function hydratePersistedAiSummary() {
      try {
        setAiSummaryLoading(true);
        const data = await getAiAuditSummary(auditId, { reuseOnly: true });
        if (!cancelled) setAiSummary(data);
      } catch {
        if (!cancelled) setAiSummary(null);
      } finally {
        if (!cancelled) setAiSummaryLoading(false);
      }
    }

    void hydratePersistedAiSummary();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  async function refreshAudits(nextPage = 1) {
    if (nextPage !== page) {
      setPage(nextPage);
      return;
    }

    const requestId = ++listRequestIdRef.current;
    try {
      setListLoading(true);
      const data: AuditListResponse = await listAudits({
        page: nextPage,
        pageSize,
        order: 'desc',
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: searchTerm.trim() || undefined,
      });
      if (requestId !== listRequestIdRef.current) return;
      setAudits(data.items);
      setTotal(data.total);
      setPage(data.page);
    } catch (err: unknown) {
      if (requestId !== listRequestIdRef.current) return;
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      if (requestId !== listRequestIdRef.current) return;
      setListLoading(false);
    }
  }

  async function handleCreateAudit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      setAuditing(true);

      const tempId = -Date.now();
      const optimisticItem: AuditListItem = {
        id: tempId,
        website: urlInput.trim(),
        timestamp: new Date().toISOString(),
        status: 'running',
        notes: null,
      };
      setAudits((prev) => [optimisticItem, ...prev]);
      setTotal((t) => t + 1);

      await createAudit(urlInput.trim());
      showToast({ message: 'Auditoría lanzada correctamente', severity: 'success' });
      await refreshAudits(1);
      navigate('/audits');
    } catch (err: unknown) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
      await refreshAudits(1);
    } finally {
      setLoading(false);
      setAuditing(false);
    }
  }

  async function handleDeleteAll() {
    if (!confirm('¿Borrar todo el histórico?')) return;
    try {
      setLoading(true);
      await deleteAudits();
      setAudits([]);
      setTotal(0);
      setPage(1);
      setDetail(null);
      navigate('/audits');
      showToast({ message: 'Histórico borrado', severity: 'success' });
    } catch (err: unknown) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateAiSummary() {
    if (!detail) return;
    try {
      setAiSummaryLoading(true);
      const data = await getAiAuditSummary(detail.id);
      setAiSummary(data);
      showToast({
        message: `Resumen IA generado (${aiSourceLabel(data.source)})`,
        severity: 'success',
      });
    } catch (err: unknown) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      setAiSummaryLoading(false);
    }
  }

  async function handleGenerateAiSummaryAB() {
    if (!detail) return;
    try {
      setAiSummaryAbLoading(true);
      const data = await getAiAuditSummaryAB(detail.id);
      setAiSummaryAb(data);
      showToast({
        message: 'Comparativa A/B generada correctamente',
        severity: 'success',
      });
    } catch (err: unknown) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      setAiSummaryAbLoading(false);
    }
  }

  function getRuleKey(ruleType: string, ruleId: string) {
    return `${ruleType}::${ruleId}`;
  }

  async function hydratePersistedRuleExplanation(ruleType: string, ruleId: string) {
    if (!detail) return;
    const key = getRuleKey(ruleType, ruleId);
    if (aiRuleExplanations[key] || aiRuleLoading[key]) return;

    try {
      setAiRuleLoading((prev) => ({ ...prev, [key]: true }));
      const data = await explainAiRule(detail.id, ruleId, {
        ruleType: ruleType as 'violations' | 'passes' | 'incomplete',
        reuseOnly: true,
        maxOccurrences: 3,
      });
      setAiRuleExplanations((prev) => ({ ...prev, [key]: data }));
    } catch {
      // Si no existe explicación persistida todavía, no mostramos error.
    } finally {
      setAiRuleLoading((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function handleExplainRule(ruleType: string, ruleId: string) {
    if (!detail) return;
    const key = getRuleKey(ruleType, ruleId);
    try {
      setAiRuleLoading((prev) => ({ ...prev, [key]: true }));
      const data = await explainAiRule(detail.id, ruleId, {
        ruleType: ruleType as 'violations' | 'passes' | 'incomplete',
        maxOccurrences: 3,
      });
      setAiRuleExplanations((prev) => ({ ...prev, [key]: data }));
      showToast({
        message: `Explicación IA generada para ${ruleId} (${aiSourceLabel(data.source)})`,
        severity: 'success',
      });
    } catch (err: unknown) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      setAiRuleLoading((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: '-0.03em' }}>
            Auditorías
          </Typography>
          <Typography color="text.secondary">
            Histórico paginado y detalle por auditoría. Abre una auditoría para ver reglas y ocurrencias.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Tooltip title="Ir al comparador">
            <Button component={Link} to="/compare" variant="outlined">
              Comparar
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1.1fr 0.9fr' },
          gap: 2,
          mb: 2,
        }}
      >
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
              Nueva auditoría
            </Typography>
            <Stack
              component="form"
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.25}
              onSubmit={handleCreateAudit}
            >
              <TextField
                fullWidth
                label="URL"
                placeholder="https://ejemplo.com"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={loading}
              />
              <Tooltip title="Lanzar nueva auditoría">
                <span>
                  <Button type="submit" variant="contained" disabled={loading}>
                    {auditing ? 'Auditando…' : 'Auditar'}
                  </Button>
                </span>
              </Tooltip>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
              Se ejecuta Playwright + axe-core desde el backend y se persiste en la base de datos.
            </Typography>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
              Acciones
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Tooltip title="Recargar la página actual">
                <span>
                  <Button variant="outlined" onClick={() => void refreshAudits(page)} disabled={loading}>
                    Recargar
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Eliminar todas las auditorías">
                <span>
                  <Button variant="contained" color="error" onClick={() => void handleDeleteAll()} disabled={loading || audits.length === 0}>
                    Borrar histórico
                  </Button>
                </span>
              </Tooltip>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
              Página {page} / {totalPages} ({total} auditorías)
            </Typography>
          </CardContent>
        </Card>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: '0.92fr 1.08fr' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Histórico
              </Typography>
              {listLoading && <Typography variant="caption" color="text.secondary">Cargando…</Typography>}
            </Stack>
            <Divider sx={{ my: 1 }} />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
              <TextField
                fullWidth
                size="small"
                label="Buscar por URL"
                placeholder="example.com"
                value={searchTerm}
                onChange={(e) => {
                  setPage(1);
                  setSearchTerm(e.target.value);
                }}
              />
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="status-filter-label">Estado</InputLabel>
                <Select
                  labelId="status-filter-label"
                  label="Estado"
                  value={statusFilter}
                  onChange={(e) => {
                    setPage(1);
                    setStatusFilter(e.target.value as AuditStatusFilter);
                  }}
                >
                  <MenuItem value="all">Todos</MenuItem>
                  <MenuItem value="running">En ejecución</MenuItem>
                  <MenuItem value="completed">Completadas</MenuItem>
                  <MenuItem value="failed">Fallidas</MenuItem>
                </Select>
              </FormControl>
              {(searchTerm.length > 0 || statusFilter !== 'all') && (
                <Tooltip title="Restablecer filtros">
                  <Button
                    variant="text"
                    onClick={() => {
                      setPage(1);
                      setSearchTerm('');
                      setStatusFilter('all');
                    }}
                  >
                    Limpiar
                  </Button>
                </Tooltip>
              )}
            </Stack>

            {listLoading && audits.length === 0 && (
              <Stack spacing={1}>
                {Array.from({ length: 5 }).map((_, idx) => (
                  <Skeleton key={idx} variant="rounded" height={62} />
                ))}
              </Stack>
            )}

            <List disablePadding>
              {audits.map((a) => {
                const chip = statusChipProps(a.status ?? null);
                const isSelected = selectedId === a.id;
                const disabled = a.id < 0;
                return (
                  <ListItemButton
                    key={a.id}
                    selected={isSelected}
                    disabled={disabled}
                    onClick={() => navigate(`/audits/${a.id}`)}
                    sx={{
                      borderRadius: 2,
                      mb: 0.75,
                      alignItems: 'flex-start',
                    }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                          <Typography sx={{ fontWeight: 900 }}>
                            #{disabled ? '…' : a.id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(a.timestamp)}
                          </Typography>
                        </Stack>
                      }
                      secondary={
                        <Box sx={{ mt: 0.25 }}>
                          <Typography variant="body2" color="text.secondary">
                            {a.website}
                          </Typography>
                          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
                            {chip && (
                              <Chip size="small" label={chip.label} color={chip.color} variant={chip.variant} />
                            )}
                            {a.notes && <Chip size="small" label={a.notes} variant="outlined" />}
                          </Stack>
                        </Box>
                      }
                    />
                  </ListItemButton>
                );
              })}
            </List>

            {!listLoading && audits.length === 0 && (
              <Typography color="text.secondary">Sin auditorías todavía.</Typography>
            )}
            {!listLoading && total === 0 && (searchTerm.length > 0 || statusFilter !== 'all') && (
              <Typography color="text.secondary">No hay auditorias que coincidan con esos filtros.</Typography>
            )}

            {totalPages > 1 && (
              <Stack direction="row" justifyContent="center" sx={{ mt: 1 }}>
                <Pagination
                  count={totalPages}
                  page={page}
                  onChange={(_, value) => setPage(value)}
                  color="primary"
                  siblingCount={0}
                />
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Detalle
              </Typography>
              {selectedId && selectedId > 0 && (
                <Typography variant="caption" color="text.secondary">
                  #{selectedId}
                </Typography>
              )}
            </Stack>
            <Divider sx={{ my: 1 }} />

            {!selectedId && <Typography color="text.secondary">Selecciona una auditoría para ver detalles.</Typography>}

            {selectedId && detailLoading && (
              <Stack spacing={1}>
                <Skeleton variant="rounded" height={26} />
                <Skeleton variant="rounded" height={16} />
                <Skeleton variant="rounded" height={90} />
              </Stack>
            )}

            {selectedId && !detailLoading && detail && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {formatDate(detail.timestamp)}
                </Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, mt: 0.5 }}>
                  {detail.url}
                </Typography>
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                  <Chip size="small" label={`Reglas: ${detail.rules.length}`} sx={CHIP_PILL_SX} />
                  <Chip size="small" label={`Ocurr.: ${detail.occurrences.length}`} sx={CHIP_PILL_SX} />
                  {detail.status && (
                    <Chip
                      size="small"
                      label={`Estado: ${auditStatusLabel(detail.status)}`}
                      variant="outlined"
                      sx={CHIP_PILL_SX}
                    />
                  )}
                </Stack>
                {detail.notes && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Notas: {detail.notes}
                  </Typography>
                )}

                <Box
                  sx={{
                    mt: 1.5,
                    p: 1.25,
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 3,
                    bgcolor: 'background.default',
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    alignItems={{ md: 'flex-start' }}
                    justifyContent="space-between"
                  >
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Tooltip title="Generar resumen inteligente de esta auditoría">
                        <span>
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => void handleGenerateAiSummary()}
                            disabled={aiSummaryLoading}
                          >
                            {aiSummaryLoading ? 'Generando IA...' : 'Resumen IA'}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Comparar salida heurística y salida asistida">
                        <span>
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => void handleGenerateAiSummaryAB()}
                            disabled={aiSummaryAbLoading}
                          >
                            {aiSummaryAbLoading ? 'Generando A/B...' : 'Comparativa A/B'}
                          </Button>
                        </span>
                      </Tooltip>
                    </Stack>
                    {aiSummary && (
                      <Stack
                        direction="row"
                        spacing={0.75}
                        useFlexGap
                        flexWrap="wrap"
                        sx={{ justifyContent: { md: 'flex-end' } }}
                      >
                        <Chip
                          size="small"
                          label={`Fuente: ${aiSourceLabel(aiSummary.source)}`}
                          variant="outlined"
                          sx={CHIP_PILL_SX}
                        />
                        {aiSummary.resolution.status && (
                          <Chip
                            size="small"
                            label={`Estado: ${aiResolutionStatusLabel(aiSummary.resolution.status)}`}
                            variant="outlined"
                            sx={CHIP_PILL_SX}
                          />
                        )}
                        {aiSummary.resolution.usedFallback && (
                          <Chip
                            size="small"
                            label="Fallback aplicado"
                            color="warning"
                            variant="outlined"
                            sx={CHIP_PILL_SX}
                          />
                        )}
                        {aiSummary.resolution.latencyMs !== null && (
                          <Chip
                            size="small"
                            label={`${aiSummary.resolution.latencyMs}ms`}
                            variant="outlined"
                            sx={CHIP_PILL_SX}
                          />
                        )}
                        {aiSummary.model && (
                          <Chip
                            size="small"
                            label={aiSummary.model}
                            variant="outlined"
                            sx={CHIP_PILL_SX}
                          />
                        )}
                        {aiSummary.traceId !== undefined && (
                          <Chip
                            size="small"
                            label={`traceId: ${aiSummary.traceId ?? 'n/a'}`}
                            variant="outlined"
                            sx={CHIP_PILL_SX}
                          />
                        )}
                      </Stack>
                    )}
                  </Stack>
                </Box>

                {aiSummary && (
                    <Card variant="outlined" sx={{ mt: 1.25 }}>
                      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          Resumen IA
                        </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {aiSummary.executiveSummary}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                          {aiSummary.technicalSummary}
                        </Typography>
                        {aiSummary.resolution.reason && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                            Motivo de resolucion: {aiSummary.resolution.reason}
                          </Typography>
                        )}
                        {aiSummary.metrics.topViolations.length > 0 && (
                          <Box sx={{ mt: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              Reglas en violación priorizadas ({aiSummary.metrics.topViolations.length}/
                              {aiSummary.metrics.rules.violations})
                            </Typography>
                            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
                              {aiSummary.metrics.topViolations.map((item) => (
                                <Chip
                                  key={item.ruleId}
                                  size="small"
                                  variant="outlined"
                                  label={`${item.ruleId} (${item.occurrences})`}
                                />
                              ))}
                            </Stack>
                          </Box>
                        )}
                        <Stack spacing={0.75} sx={{ mt: 1 }}>
                          {aiSummary.recommendations.map((item, index) => {
                            const badge = getRecommendationBadge(item, detail.rules);
                            return (
                              <Stack
                                key={`${item.title}-${index}`}
                                direction="row"
                                spacing={0.75}
                                alignItems="flex-start"
                              >
                                <Chip
                                  size="small"
                                  color={badge.color}
                                  label={badge.label}
                                  variant="outlined"
                                  sx={SEVERITY_CHIP_SX}
                                />
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    {item.title}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {item.reason}
                                  </Typography>
                                </Box>
                              </Stack>
                            );
                          })}
                        </Stack>
                      </CardContent>
                    </Card>
                )}

                {aiSummaryAb && (
                  <AiAbComparisonCard
                    title="Comparativa A/B del resumen"
                    heuristic={aiSummaryAb.heuristic}
                    assisted={aiSummaryAb.assisted}
                    diff={aiSummaryAb.diff}
                    renderHeuristicDetails={(item) =>
                      renderAuditSummaryDetails(item as AiAuditSummary)
                    }
                    renderAssistedDetails={(item) =>
                      renderAuditSummaryDetails(item as AiAuditSummary)
                    }
                  />
                )}

                <Tabs
                  value={detailTab}
                  onChange={(_, value) => setDetailTab(value)}
                  sx={{
                    mt: 2,
                    '& .MuiTab-root': {
                      minHeight: 56,
                      textTransform: 'none',
                      fontWeight: 800,
                      fontSize: { xs: '0.96rem', md: '1rem' },
                      px: 1.5,
                      color: 'text.secondary',
                    },
                    '& .Mui-selected': {
                      color: 'text.primary',
                    },
                    '& .MuiTabs-indicator': {
                      height: 3,
                      borderRadius: 999,
                    },
                  }}
                  variant="fullWidth"
                >
                  <Tab
                    icon={<ErrorOutlineIcon fontSize="small" />}
                    iconPosition="start"
                    label={`Violaciones (${detailCounts.violations})`}
                    value="violations"
                  />
                  <Tab
                    icon={<HelpOutlineIcon fontSize="small" />}
                    iconPosition="start"
                    label={`Revisión manual (${detailCounts.incomplete})`}
                    value="incomplete"
                  />
                  <Tab
                    icon={<CheckCircleOutlineIcon fontSize="small" />}
                    iconPosition="start"
                    label={`Correctas (${detailCounts.passes})`}
                    value="passes"
                  />
                </Tabs>

                <Stack sx={{ mt: 1 }} spacing={1}>
                  {detail.rules.filter((r) => r.type === detailTab).length === 0 && (
                    <Typography color="text.secondary">Sin resultados para esta sección.</Typography>
                  )}

                  {detail.rules
                    .filter((r) => r.type === detailTab)
                    .map((r) => {
                      const occ = detail.occurrences.filter((o) => o.ruleRef === r.id);
                      const aiRuleKey = getRuleKey(r.type, r.ruleId);
                      const aiRuleItem = aiRuleExplanations[aiRuleKey];
                      const aiRuleBusy = aiRuleLoading[aiRuleKey] === true;
                      return (
                        <Accordion
                          key={r.id}
                          variant="outlined"
                          disableGutters
                          expanded={expandedRuleKey === aiRuleKey}
                          onChange={(_, isExpanded) => {
                            setExpandedRuleKey(isExpanded ? aiRuleKey : false);
                            if (isExpanded) {
                              void hydratePersistedRuleExplanation(r.type, r.ruleId);
                            }
                          }}
                          TransitionProps={{ unmountOnExit: true }}
                        >
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                              <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1 }}>
                                {r.ruleId}
                              </Typography>
                              <Chip
                                size="small"
                                label={impactLabel(r.impact)}
                                color={impactChipColor(r.impact)}
                                variant="outlined"
                                sx={SEVERITY_CHIP_SX}
                              />
                            </Stack>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Typography variant="body2" color="text.secondary">
                              {r.description}
                            </Typography>
                            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                              {r.wcag.map((t) => (
                                <Chip key={t} size="small" label={t} variant="outlined" />
                              ))}
                            </Stack>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                              <Tooltip title="Abrir documentación de la regla">
                                <Button href={r.helpUrl} target="_blank" rel="noreferrer" variant="outlined" size="small">
                                  Ver ayuda
                                </Button>
                              </Tooltip>
                              <Tooltip title={ruleExplainTooltip(r.type)}>
                                <span>
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={() => void handleExplainRule(r.type, r.ruleId)}
                                    disabled={aiRuleBusy}
                                  >
                                    {ruleExplainButtonLabel(r.type, aiRuleBusy, !!aiRuleItem)}
                                  </Button>
                                </span>
                              </Tooltip>
                              <Typography variant="caption" color="text.secondary">
                                Ocurrencias: {occ.length}
                              </Typography>
                            </Stack>
                            {aiRuleItem && (
                              <Card variant="outlined" sx={{ mt: 1 }}>
                                <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                                  <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                      {ruleAiCardTitle(r.type)}
                                    </Typography>
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        label={aiSourceLabel(aiRuleItem.source)}
                                        sx={CHIP_PILL_SX}
                                      />
                                    {aiRuleItem.model && (
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        label={aiRuleItem.model}
                                        sx={CHIP_PILL_SX}
                                      />
                                    )}
                                    {aiRuleItem.traceId !== undefined && (
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        label={`traceId: ${aiRuleItem.traceId ?? 'n/a'}`}
                                        sx={CHIP_PILL_SX}
                                      />
                                    )}
                                  </Stack>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                                    {aiRuleItem.explanation.summary}
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                    {aiRuleItem.explanation.whyItMatters}
                                  </Typography>
                                  {r.type === 'incomplete' && (
                                    <Chip
                                      size="small"
                                      color="warning"
                                      variant="outlined"
                                      label="Resultado incomplete: requiere revisión manual"
                                      sx={{ mt: 0.75 }}
                                    />
                                  )}
                                  <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                                    {aiRuleItem.explanation.fixes.slice(0, 3).map((fix, index) => (
                                      <Typography key={`${r.ruleId}-fix-${index}`} variant="caption" color="text.secondary">
                                        - {fix}
                                      </Typography>
                                    ))}
                                  </Stack>
                                </CardContent>
                              </Card>
                            )}
                            <OccurrenceGroups
                              items={occ}
                              ruleType={r.type as 'violations' | 'passes' | 'incomplete'}
                            />
                          </AccordionDetails>
                        </Accordion>
                      );
                    })}
                </Stack>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
