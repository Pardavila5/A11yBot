import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  compareAudits,
  getAiCompareSummary,
  getAiCompareSummaryAB,
  listAudits,
} from '../api';
import {
  AiCompareSummary,
  AiCompareSummaryAB,
  AuditListResponse,
  CompareResult,
} from '../types';
import { formatDate, formatErrorMessage } from '../lib/format';
import AiAbComparisonCard from '../ui/AiAbComparisonCard';
import {
  aiResolutionStatusLabel,
  aiSourceLabel,
  impactLabel,
  priorityChipColor,
  priorityLabel,
  severityChipSx,
  wcagTagInfo,
} from '../ui/aiSummaryPresentation';
import { useToast } from '../ui/ToastProvider';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

type CompareIds = { old?: number; new?: number };

type CompareAuditOption = {
  id: number;
  url: string;
  host: string;
  label: string;
};

function getAuditHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function CompareList({ title, items }: { title: string; items: CompareResult['newViolations'] }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
        {title}
      </Typography>
      {items.length === 0 && <Typography color="text.secondary">Vacío</Typography>}
      <Stack spacing={1}>
        {items.map((v, idx) => (
          <Card key={`${v.ruleId}-${idx}`} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Typography sx={{ fontWeight: 800 }}>{v.ruleId}</Typography>
                <Chip
                  size="small"
                  label={impactLabel(v.impact)}
                  variant="filled"
                  sx={{ ...severityChipSx(v.impact), fontWeight: 700 }}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {v.description}
              </Typography>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                {v.wcag.map((t) => {
                  const info = wcagTagInfo(t);
                  return (
                    <Tooltip key={t} title={info.title}>
                      <Chip size="small" label={info.label} variant="outlined" />
                    </Tooltip>
                  );
                })}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Ocurrencias: {v.occurrences.length}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

function renderCompareSummaryDetails(summary: AiCompareSummary) {
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
        <Chip
          size="small"
          label={`Delta reglas: ${summary.summary.deltaViolationRules}`}
          variant="outlined"
        />
        <Chip
          size="small"
          label={`Nuevas: ${summary.summary.newViolationRules}`}
          color="error"
          variant="outlined"
        />
        <Chip
          size="small"
          label={`Resueltas: ${summary.summary.resolvedViolationRules}`}
          color="success"
          variant="outlined"
        />
        <Chip
          size="small"
          label={`Persistentes: ${summary.summary.persistentViolationRules}`}
          variant="outlined"
        />
      </Stack>
    </Stack>
  );
}

export default function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  const optionsRequestIdRef = useRef(0);
  const compareRequestIdRef = useRef(0);

  const [compareIds, setCompareIds] = useState<CompareIds>({});
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareOptions, setCompareOptions] = useState<CompareAuditOption[]>(
    [],
  );
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<AiCompareSummary | null>(null);
  const [aiSummaryAbLoading, setAiSummaryAbLoading] = useState(false);
  const [aiSummaryAb, setAiSummaryAb] = useState<AiCompareSummaryAB | null>(null);

  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);

  const oldSelection = compareOptions.find((item) => item.id === compareIds.old);
  const newSelection = compareOptions.find((item) => item.id === compareIds.new);
  const selectableOldOptions = newSelection
    ? compareOptions.filter(
        (item) => item.host === newSelection.host || item.id === newSelection.id,
      )
    : compareOptions;
  const selectableNewOptions = oldSelection
    ? compareOptions.filter(
        (item) => item.host === oldSelection.host || item.id === oldSelection.id,
      )
    : compareOptions;

  useEffect(() => {
    void loadCompareOptions();
  }, []);

  useEffect(() => {
    const oldParam = searchParams.get('old');
    const newParam = searchParams.get('new');
    const oldId = oldParam ? Number(oldParam) : undefined;
    const newId = newParam ? Number(newParam) : undefined;
    if (oldId && newId && oldId !== newId) {
      setCompareIds({ old: oldId, new: newId });
      void runCompare(oldId, newId);
    }
  }, [searchParams]);

  async function loadCompareOptions() {
    const requestId = ++optionsRequestIdRef.current;
    try {
      setOptionsLoading(true);
      const pageSize = 200;
      let page = 1;
      let totalPages = 1;
      const allItems: AuditListResponse['items'] = [];

      while (page <= totalPages) {
        const data: AuditListResponse = await listAudits({
          page,
          pageSize,
          order: 'desc',
        });
        if (requestId !== optionsRequestIdRef.current) return;
        allItems.push(...data.items);
        totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
        page += 1;
      }

      if (requestId !== optionsRequestIdRef.current) return;
      setCompareOptions(
        allItems.map((a) => ({
          id: a.id,
          url: a.website,
          host: getAuditHost(a.website),
          label: `#${a.id} - ${a.website} (${formatDate(a.timestamp)})`,
        })),
      );
    } catch {
      if (requestId !== optionsRequestIdRef.current) return;
      setCompareOptions([]);
    } finally {
      if (requestId !== optionsRequestIdRef.current) return;
      setOptionsLoading(false);
    }
  }

  async function runCompare(oldId: number, newId: number) {
    const requestId = ++compareRequestIdRef.current;
    try {
      setLoading(true);
      setAiSummary(null);
      setAiSummaryAb(null);
      const data = await compareAudits(oldId, newId);
      if (requestId !== compareRequestIdRef.current) return;
      setCompareResult(data);
    } catch (err: unknown) {
      if (requestId !== compareRequestIdRef.current) return;
      setCompareResult(null);
      setAiSummary(null);
      setAiSummaryAb(null);
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      if (requestId !== compareRequestIdRef.current) return;
      setLoading(false);
    }
  }

  async function handleCompare(e: React.FormEvent) {
    e.preventDefault();
    if (!compareIds.old || !compareIds.new || compareIds.old === compareIds.new) {
      showToast({ message: 'Selecciona dos auditorías distintas', severity: 'warning' });
      return;
    }
    if (oldSelection && newSelection && oldSelection.host !== newSelection.host) {
      showToast({
        message: 'Selecciona auditorias del mismo dominio para comparar',
        severity: 'warning',
      });
      return;
    }
    setSearchParams({ old: String(compareIds.old), new: String(compareIds.new) });
    await runCompare(compareIds.old, compareIds.new);
  }

  async function handleGenerateAiCompareSummary() {
    if (!compareIds.old || !compareIds.new) {
      showToast({ message: 'Ejecuta primero una comparación válida', severity: 'warning' });
      return;
    }
    try {
      setAiSummaryLoading(true);
      const data = await getAiCompareSummary(compareIds.old, compareIds.new);
      setAiSummary(data);
      showToast({
        message: `Resumen IA de comparación generado (${aiSourceLabel(data.source)})`,
        severity: 'success',
      });
    } catch (err: unknown) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      setAiSummaryLoading(false);
    }
  }

  async function handleGenerateAiCompareSummaryAB() {
    if (!compareIds.old || !compareIds.new) {
      showToast({ message: 'Ejecuta primero una comparacion valida', severity: 'warning' });
      return;
    }
    try {
      setAiSummaryAbLoading(true);
      const data = await getAiCompareSummaryAB(compareIds.old, compareIds.new);
      setAiSummaryAb(data);
      showToast({
        message: 'Comparativa A/B de comparacion generada',
        severity: 'success',
      });
    } catch (err: unknown) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      setAiSummaryAbLoading(false);
    }
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: '-0.03em' }}>
            Comparar
          </Typography>
          <Typography color="text.secondary">
            Compara dos auditorías del mismo dominio para ver nuevas, resueltas y persistentes.
          </Typography>
        </Box>
        <Tooltip title="Volver al histórico de auditorías">
          <Button component={Link} to="/audits" variant="outlined">
            Volver al histórico
          </Button>
        </Tooltip>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>
              Selección
            </Typography>
            <Tooltip title="Actualizar la lista de auditorías disponibles">
              <span>
                <Button variant="outlined" onClick={() => void loadCompareOptions()} disabled={optionsLoading} startIcon={<RefreshIcon />}>
                  Recargar lista
                </Button>
              </span>
            </Tooltip>
          </Stack>

          {optionsLoading && compareOptions.length === 0 ? (
            <Box
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr auto' },
                gap: 1.25,
                alignItems: 'center',
              }}
            >
              <Skeleton variant="rounded" height={56} />
              <Skeleton variant="rounded" height={56} />
              <Skeleton variant="rounded" height={56} />
            </Box>
          ) : (
            <Box
              component="form"
              onSubmit={handleCompare}
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr auto' },
                gap: 1.25,
                alignItems: 'center',
              }}
            >
              <FormControl fullWidth>
                <InputLabel id="old-label">Old</InputLabel>
                <Select
                  labelId="old-label"
                  label="Old"
                  value={compareIds.old ?? ''}
                  onChange={(e) => {
                    const nextOld = e.target.value ? Number(e.target.value) : undefined;
                    const nextOldOption = compareOptions.find((item) => item.id === nextOld);
                    setCompareIds((previous) => {
                      const currentNewOption = compareOptions.find(
                        (item) => item.id === previous.new,
                      );
                      const keepNew =
                        !nextOldOption ||
                        !currentNewOption ||
                        currentNewOption.host === nextOldOption.host;
                      return {
                        ...previous,
                        old: nextOld,
                        new: keepNew ? previous.new : undefined,
                      };
                    });
                  }}
                  disabled={optionsLoading}
                >
                <MenuItem value="">Old</MenuItem>
                {selectableOldOptions.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel id="new-label">New</InputLabel>
                <Select
                  labelId="new-label"
                  label="New"
                  value={compareIds.new ?? ''}
                  onChange={(e) => {
                    const nextNew = e.target.value ? Number(e.target.value) : undefined;
                    const nextNewOption = compareOptions.find((item) => item.id === nextNew);
                    setCompareIds((previous) => {
                      const currentOldOption = compareOptions.find(
                        (item) => item.id === previous.old,
                      );
                      const keepOld =
                        !nextNewOption ||
                        !currentOldOption ||
                        currentOldOption.host === nextNewOption.host;
                      return {
                        ...previous,
                        old: keepOld ? previous.old : undefined,
                        new: nextNew,
                      };
                    });
                  }}
                  disabled={optionsLoading}
                >
                <MenuItem value="">New</MenuItem>
                {selectableNewOptions.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
                </Select>
              </FormControl>

              <Tooltip title="Comparar auditorías seleccionadas">
                <span>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={loading || optionsLoading}
                    sx={{ height: 56 }}
                    startIcon={<CompareArrowsIcon />}
                  >
                    {loading ? 'Comparando…' : 'Comparar'}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          )}
        </CardContent>
      </Card>

      {loading && (
        <Box sx={{ mt: 2 }}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={1}>
                <Skeleton variant="rounded" height={28} />
                <Skeleton variant="rounded" height={36} />
              </Stack>
            </CardContent>
          </Card>
          <Stack spacing={1} sx={{ mt: 2 }}>
            {Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} variant="rounded" height={110} />
            ))}
          </Stack>
        </Box>
      )}

      {!loading && compareResult && (
        <Box sx={{ mt: 2 }}>
          <Card variant="outlined">
            <CardContent>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>
                  Resultado
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  #{compareResult.audits.old.id} → #{compareResult.audits.new.id}
                </Typography>
              </Stack>
              <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  Old: {compareResult.audits.old.url}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  New: {compareResult.audits.new.url}
                </Typography>
              </Stack>
              {compareResult.audits.old.url !== compareResult.audits.new.url && (
                <Chip
                  size="small"
                  color="warning"
                  variant="filled"
                  icon={<WarningAmberIcon />}
                  label="Atención: comparas páginas distintas (mismo dominio, distinta ruta)"
                  sx={{
                    mt: 1,
                    fontWeight: 700,
                    height: 'auto',
                    '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 },
                  }}
                />
              )}
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                <Chip
                  sx={{ fontWeight: 700 }}
                  label={`Reglas con incidencias: ${compareResult.summary.totalViolationRulesOld} → ${
                    compareResult.summary.totalViolationRulesNew
                  } (${compareResult.summary.deltaViolationRules > 0 ? '+' : ''}${
                    compareResult.summary.deltaViolationRules
                  })`}
                />
                <Chip color="error" variant="filled" label={`Nuevas: ${compareResult.summary.newViolationRules}`} />
                <Chip color="success" variant="filled" label={`Resueltas: ${compareResult.summary.resolvedViolationRules}`} />
                <Chip color="warning" variant="filled" label={`Persistentes: ${compareResult.summary.persistentViolationRules}`} />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mt: 1.25 }}>
                <Tooltip title="Generar resumen IA de esta comparacion">
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => void handleGenerateAiCompareSummary()}
                      disabled={aiSummaryLoading}
                    >
                      {aiSummaryLoading ? 'Generando IA...' : 'Resumen IA comparacion'}
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Comparar salida heuristica y salida asistida">
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => void handleGenerateAiCompareSummaryAB()}
                      disabled={aiSummaryAbLoading}
                    >
                      {aiSummaryAbLoading ? 'Generando A/B...' : 'Comparativa A/B'}
                    </Button>
                  </span>
                </Tooltip>
                {aiSummary && (
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                    <Chip size="small" label={`Fuente: ${aiSourceLabel(aiSummary.source)}`} variant="outlined" />
                    {aiSummary.resolution.status && (
                      <Chip
                        size="small"
                        label={`Estado: ${aiResolutionStatusLabel(aiSummary.resolution.status)}`}
                        variant="outlined"
                      />
                    )}
                    {aiSummary.resolution.usedFallback && (
                      <Chip size="small" label="Fallback aplicado" color="warning" variant="outlined" />
                    )}
                    {aiSummary.resolution.latencyMs !== null && (
                      <Chip size="small" label={`${aiSummary.resolution.latencyMs}ms`} variant="outlined" />
                    )}
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
                      Resumen IA comparacion
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
                    <Stack spacing={0.75} sx={{ mt: 1 }}>
                      {aiSummary.recommendations.map((item, index) => (
                        <Stack key={`${item.title}-${index}`} direction="row" spacing={0.75} alignItems="flex-start">
                          <Chip
                            size="small"
                            color={priorityChipColor(item.priority)}
                            label={priorityLabel(item.priority)}
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
              {aiSummaryAb && (
                <AiAbComparisonCard
                  title="Comparativa A/B de comparacion"
                  heuristic={aiSummaryAb.heuristic}
                  assisted={aiSummaryAb.assisted}
                  diff={aiSummaryAb.diff}
                  renderHeuristicDetails={(item) =>
                    renderCompareSummaryDetails(item as AiCompareSummary)
                  }
                  renderAssistedDetails={(item) =>
                    renderCompareSummaryDetails(item as AiCompareSummary)
                  }
                />
              )}
            </CardContent>
          </Card>

          <CompareList title="Nuevas" items={compareResult.newViolations} />
          <CompareList title="Resueltas" items={compareResult.resolvedViolations} />
          <CompareList title="Persistentes" items={compareResult.persistentViolations} />
        </Box>
      )}
    </Box>
  );
}
