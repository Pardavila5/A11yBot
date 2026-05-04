import { useEffect, useState } from 'react';
import {
  getAiTraceStats,
  getAuditRuntimeStats,
  listAiTraces,
} from '../api';
import { AiTraceItem, AiTraceStats, AuditRuntimeStats } from '../types';
import { useToast } from '../ui/ToastProvider';
import { formatDate, formatErrorMessage } from '../lib/format';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';

export default function OpsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [runtime, setRuntime] = useState<AuditRuntimeStats | null>(null);
  const [stats, setStats] = useState<AiTraceStats | null>(null);
  const [traces, setTraces] = useState<AiTraceItem[]>([]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setLoading(true);
      const [runtimeData, statsData, tracesData] = await Promise.all([
        getAuditRuntimeStats(),
        getAiTraceStats({ sinceDays: 7 }),
        listAiTraces({ limit: 10 }),
      ]);
      setRuntime(runtimeData);
      setStats(statsData);
      setTraces(tracesData.items);
    } catch (error: unknown) {
      showToast({ message: formatErrorMessage(error), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'flex-end' }}
        sx={{ mb: 2 }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: '-0.03em' }}>
            Operaciones
          </Typography>
          <Typography color="text.secondary">
            Estado runtime de auditorias y analitica IA para seguimiento del TFG.
          </Typography>
        </Box>
        <Tooltip title="Actualizar metricas operativas">
          <span>
            <Button variant="outlined" onClick={() => void refresh()} disabled={loading}>
              Recargar
            </Button>
          </span>
        </Tooltip>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          gap: 2,
        }}
      >
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Runtime auditorias
            </Typography>
            <Divider sx={{ my: 1 }} />
            {loading && !runtime && <Skeleton variant="rounded" height={120} />}
            {runtime && (
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip label={`Activas: ${runtime.activeAudits}`} />
                  <Chip label={`En cola: ${runtime.queued}`} />
                  <Chip label={`Limite global: ${runtime.limits.global}`} />
                  <Chip label={`Limite por host: ${runtime.limits.perHost}`} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  timeout={runtime.timeoutMs}ms retries={runtime.retries} retryDelay={runtime.retryDelayMs}ms
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  privateTargets={runtime.allowPrivateTargets ? 'enabled' : 'blocked'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Hosts activos:{' '}
                  {Object.keys(runtime.activeByHost).length === 0
                    ? 'ninguno'
                    : Object.entries(runtime.activeByHost)
                        .map(([host, count]) => `${host}(${count})`)
                        .join(', ')}
                </Typography>
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              IA (ultimos 7 dias)
            </Typography>
            <Divider sx={{ my: 1 }} />
            {loading && !stats && <Skeleton variant="rounded" height={120} />}
            {stats && (
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip label={`Trazas: ${stats.window.total}`} />
                  <Chip label={`OpenAI: ${(stats.usage.openAiRate * 100).toFixed(1)}%`} />
                  <Chip label={`Fallback: ${(stats.usage.fallbackRate * 100).toFixed(1)}%`} />
                  <Chip label={`Lat media: ${stats.latency.avgMs}ms`} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Latencia OpenAI media: {stats.latency.openAiAvgMs}ms
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Operaciones: {Object.entries(stats.usage.byOperation).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Estados intento: {Object.entries(stats.attempts.byStatus).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}
                </Typography>
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Ultimas trazas IA
          </Typography>
          <Divider sx={{ my: 1 }} />
          {loading && traces.length === 0 && (
            <Stack spacing={1}>
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} variant="rounded" height={56} />
              ))}
            </Stack>
          )}
          {!loading && traces.length === 0 && (
            <Typography color="text.secondary">Sin trazas registradas.</Typography>
          )}
          <Stack spacing={1}>
            {traces.map((trace) => (
              <Card key={trace.id} variant="outlined">
                <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                    <Typography sx={{ fontWeight: 800 }}>#{trace.id}</Typography>
                    <Chip size="small" label={trace.operation} variant="outlined" />
                    <Chip size="small" label={trace.source} />
                    <Chip
                      size="small"
                      label={trace.success ? 'ok' : 'fallback'}
                      color={trace.success ? 'success' : 'warning'}
                      variant="outlined"
                    />
                    <Chip size="small" label={`${trace.latencyMs}ms`} variant="outlined" />
                    {trace.model && <Chip size="small" label={trace.model} variant="outlined" />}
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(trace.createdAt)}
                    </Typography>
                  </Stack>
                  {trace.errorMessage && (
                    <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                      {trace.errorMessage}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
