import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  createAudit,
  deleteAudits,
  explainAiRule,
  getAiAuditSummary,
  getAudit,
  listAudits,
} from '../api';
import {
  AiAuditSummary,
  AiRuleExplanation,
  AuditDetail,
  AuditListItem,
  AuditListResponse,
} from '../types';
import { formatDate, formatErrorMessage } from '../lib/format';
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
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

const DEFAULT_PAGE_SIZE = 5;

function statusChipProps(status: string | null | undefined): { label: string; color?: any; variant?: any } | null {
  if (!status) return null;
  if (status === 'running') return { label: 'running', color: 'warning', variant: 'filled' };
  if (status === 'failed') return { label: 'failed', color: 'error', variant: 'filled' };
  if (status === 'completed') return { label: 'completed', color: 'success', variant: 'outlined' };
  if (status === 'pending') return { label: 'pending', color: 'info', variant: 'outlined' };
  return { label: status, variant: 'outlined' };
}

function priorityChipColor(priority: 'high' | 'medium' | 'low'): 'error' | 'warning' | 'default' {
  if (priority === 'high') return 'error';
  if (priority === 'medium') return 'warning';
  return 'default';
}

function Occurrences({
  items,
}: {
  items: { id: number; htmlSnippet: string; target: string[]; failureSummary: string | null }[];
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

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {visibleItems.map((o) => (
        <Card key={o.id} variant="outlined">
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">
              target: {o.target.join(', ')}
            </Typography>
            {o.failureSummary && (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {o.failureSummary}
              </Typography>
            )}
            <Box
              component="pre"
              sx={(t) => ({
                mt: 1,
                mb: 0,
                p: 1.25,
                borderRadius: 2,
                overflowX: 'auto',
                fontSize: 13,
                backgroundColor: t.palette.mode === 'dark' ? '#020617' : '#0b0b12',
                color: '#f8fafc',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              })}
            >
              {o.htmlSnippet}
            </Box>
          </CardContent>
        </Card>
      ))}
      {remaining > 0 && (
        <Button variant="text" onClick={() => setVisibleCount((c) => Math.min(items.length, c + STEP))}>
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
  const [aiRuleLoading, setAiRuleLoading] = useState<Record<string, boolean>>({});
  const [aiRuleExplanations, setAiRuleExplanations] = useState<Record<string, AiRuleExplanation>>({});

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'completed' | 'failed' | 'pending'>('all');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const filteredAudits = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return audits.filter((a) => {
      const matchesText = term.length === 0 || a.website.toLowerCase().includes(term);
      const matchesStatus =
        statusFilter === 'all' ? true : (a.status ?? '').toLowerCase() === statusFilter;
      return matchesText && matchesStatus;
    });
  }, [audits, searchTerm, statusFilter]);

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
    void refreshAudits(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    setAiSummary(null);
    setAiRuleLoading({});
    setAiRuleExplanations({});
    if (!selectedId || Number.isNaN(selectedId)) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function refreshAudits(nextPage = 1) {
    const requestId = ++listRequestIdRef.current;
    try {
      setListLoading(true);
      const data: AuditListResponse = await listAudits({
        page: nextPage,
        pageSize,
        order: 'desc',
      });
      if (requestId !== listRequestIdRef.current) return;
      setAudits(data.items);
      setTotal(data.total);
      setPage(data.page);
    } catch (err: any) {
      if (requestId !== listRequestIdRef.current) return;
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      if (requestId !== listRequestIdRef.current) return;
      setListLoading(false);
    }
  }

  async function loadDetail(id: number) {
    const requestId = ++detailRequestIdRef.current;
    try {
      setDetailLoading(true);
      const data = await getAudit(id);
      if (requestId !== detailRequestIdRef.current) return;
      setDetail(data);
    } catch (err: any) {
      if (requestId !== detailRequestIdRef.current) return;
      setDetail(null);
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      if (requestId !== detailRequestIdRef.current) return;
      setDetailLoading(false);
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
    } catch (err: any) {
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
    } catch (err: any) {
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
        message: `Resumen IA generado (${data.source})`,
        severity: 'success',
      });
    } catch (err: any) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      setAiSummaryLoading(false);
    }
  }

  function getRuleKey(ruleType: string, ruleId: string) {
    return `${ruleType}::${ruleId}`;
  }

  async function handleExplainRule(ruleType: string, ruleId: string) {
    if (!detail) return;
    const key = getRuleKey(ruleType, ruleId);
    try {
      setAiRuleLoading((prev) => ({ ...prev, [key]: true }));
      const data = await explainAiRule(detail.id, ruleId, { maxOccurrences: 3 });
      setAiRuleExplanations((prev) => ({ ...prev, [key]: data }));
      showToast({
        message: `Explicación IA generada para ${ruleId} (${data.source})`,
        severity: 'success',
      });
    } catch (err: any) {
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
          gridTemplateColumns: { xs: '1fr', lg: '1.1fr 0.9fr' },
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
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="status-filter-label">Estado</InputLabel>
                <Select
                  labelId="status-filter-label"
                  label="Estado"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                >
                  <MenuItem value="all">Todos</MenuItem>
                  <MenuItem value="running">Running</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                  <MenuItem value="failed">Failed</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                </Select>
              </FormControl>
              {(searchTerm.length > 0 || statusFilter !== 'all') && (
                <Tooltip title="Restablecer filtros">
                  <Button
                    variant="text"
                    onClick={() => {
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
              {filteredAudits.map((a) => {
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
            {!listLoading && audits.length > 0 && filteredAudits.length === 0 && (
              <Typography color="text.secondary">No hay coincidencias con esos filtros.</Typography>
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
                  <Chip size="small" label={`Reglas: ${detail.rules.length}`} />
                  <Chip size="small" label={`Ocurr.: ${detail.occurrences.length}`} />
                  {detail.status && <Chip size="small" label={`Status: ${detail.status}`} variant="outlined" />}
                </Stack>
                {detail.notes && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Notas: {detail.notes}
                  </Typography>
                )}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mt: 1.5 }}>
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
                  {aiSummary && (
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                    <Chip size="small" label={`Fuente: ${aiSummary.source}`} variant="outlined" />
                    {aiSummary.model && (
                      <Chip size="small" label={aiSummary.model} variant="outlined" />
                    )}
                    {aiSummary.traceId !== undefined && (
                      <Chip size="small" label={`traceId: ${aiSummary.traceId ?? 'n/a'}`} variant="outlined" />
                    )}
                  </Stack>
                )}
                </Stack>

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
                        {aiSummary.metrics.topViolations.length > 0 && (
                          <Box sx={{ mt: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              Top violaciones detectadas
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
                          {aiSummary.recommendations.map((item, index) => (
                            <Stack key={`${item.title}-${index}`} direction="row" spacing={0.75} alignItems="flex-start">
                            <Chip
                              size="small"
                              color={priorityChipColor(item.priority)}
                              label={item.priority}
                              variant="outlined"
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
                        ))}
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                <Tabs
                  value={detailTab}
                  onChange={(_, value) => setDetailTab(value)}
                  sx={{ mt: 2 }}
                  variant="scrollable"
                  allowScrollButtonsMobile
                >
                  <Tab
                    icon={<ErrorOutlineIcon fontSize="small" />}
                    iconPosition="start"
                    label={`Violations (${detailCounts.violations})`}
                    value="violations"
                  />
                  <Tab
                    icon={<CheckCircleOutlineIcon fontSize="small" />}
                    iconPosition="start"
                    label={`Passes (${detailCounts.passes})`}
                    value="passes"
                  />
                  <Tab
                    icon={<HelpOutlineIcon fontSize="small" />}
                    iconPosition="start"
                    label={`Incomplete (${detailCounts.incomplete})`}
                    value="incomplete"
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
                      const impactChipColor =
                        detailTab === 'violations'
                          ? 'error'
                          : detailTab === 'passes'
                            ? 'success'
                            : 'warning';
                      return (
                        <Accordion key={r.id} variant="outlined" disableGutters TransitionProps={{ unmountOnExit: true }}>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                              <Typography sx={{ fontWeight: 900, flex: 1 }}>{r.ruleId}</Typography>
                              <Chip size="small" label={r.impact ?? 'n/a'} color={impactChipColor as any} variant="outlined" />
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
                              <Tooltip title="Generar explicacion practica de esta regla">
                                <span>
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={() => void handleExplainRule(r.type, r.ruleId)}
                                    disabled={aiRuleBusy}
                                  >
                                    {aiRuleBusy ? 'Generando IA...' : aiRuleItem ? 'Actualizar IA' : 'Explicar IA'}
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
                                      Explicacion IA
                                    </Typography>
                                    <Chip size="small" variant="outlined" label={aiRuleItem.source} />
                                    {aiRuleItem.model && (
                                      <Chip size="small" variant="outlined" label={aiRuleItem.model} />
                                    )}
                                    {aiRuleItem.traceId !== undefined && (
                                      <Chip size="small" variant="outlined" label={`traceId: ${aiRuleItem.traceId ?? 'n/a'}`} />
                                    )}
                                  </Stack>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                                    {aiRuleItem.explanation.summary}
                                  </Typography>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                    {aiRuleItem.explanation.whyItMatters}
                                  </Typography>
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
                            <Occurrences items={occ} />
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
