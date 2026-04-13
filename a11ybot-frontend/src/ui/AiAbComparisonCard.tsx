import type { ReactNode } from 'react';
import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import type { AiSummaryBase } from '../types';
import {
  aiResolutionStatusLabel,
  aiSourceLabel,
  priorityChipColor,
  priorityLabel,
} from './aiSummaryPresentation';

function SummaryColumn({
  title,
  item,
  details,
}: {
  title: string;
  item: AiSummaryBase;
  details?: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              {title}
            </Typography>
            <Chip size="small" label={aiSourceLabel(item.source)} variant="outlined" />
            {item.resolution.status && (
              <Chip
                size="small"
                label={aiResolutionStatusLabel(item.resolution.status) ?? item.resolution.status}
                variant="outlined"
              />
            )}
            {item.resolution.usedFallback && (
              <Chip size="small" label="fallback aplicado" color="warning" variant="outlined" />
            )}
            {item.resolution.latencyMs !== null && (
              <Chip size="small" label={`${item.resolution.latencyMs}ms`} variant="outlined" />
            )}
            {item.model && <Chip size="small" label={item.model} variant="outlined" />}
            {item.traceId !== undefined && (
              <Chip size="small" label={`traceId: ${item.traceId ?? 'n/a'}`} variant="outlined" />
            )}
          </Stack>

          {item.resolution.reason && (
            <Typography variant="caption" color="text.secondary">
              Motivo: {item.resolution.reason}
            </Typography>
          )}

          {details}

          <Box>
            <Typography variant="caption" color="text.secondary">
              Resumen ejecutivo
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {item.executiveSummary}
            </Typography>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary">
              Resumen tecnico
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {item.technicalSummary}
            </Typography>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary">
              Recomendaciones
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 0.75 }}>
              {item.recommendations.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  Sin recomendaciones adicionales.
                </Typography>
              )}
              {item.recommendations.map((recommendation, index) => (
                <Stack
                  key={`${title}-${recommendation.title}-${index}`}
                  direction="row"
                  spacing={0.75}
                  alignItems="flex-start"
                >
                  <Chip
                    size="small"
                    color={priorityChipColor(recommendation.priority)}
                    label={priorityLabel(recommendation.priority)}
                    variant="outlined"
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {recommendation.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {recommendation.reason}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function AiAbComparisonCard({
  title,
  heuristic,
  assisted,
  diff,
  renderHeuristicDetails,
  renderAssistedDetails,
}: {
  title: string;
  heuristic: AiSummaryBase;
  assisted: AiSummaryBase;
  diff: {
    sourceChanged: boolean;
    recommendationDelta: number;
    fallbackTriggered: boolean;
    assistedStatus: string | null;
  };
  renderHeuristicDetails?: (item: AiSummaryBase) => ReactNode;
  renderAssistedDetails?: (item: AiSummaryBase) => ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ mt: 1.25 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
          <Chip
            size="small"
            label={diff.sourceChanged ? 'Fuente distinta' : 'Misma fuente'}
            color={diff.sourceChanged ? 'warning' : 'default'}
            variant="outlined"
          />
          <Chip
            size="small"
            label={`Delta recomendaciones: ${diff.recommendationDelta >= 0 ? '+' : ''}${diff.recommendationDelta}`}
            variant="outlined"
          />
          {diff.fallbackTriggered && (
            <Chip size="small" label="Asistido con fallback" color="warning" variant="outlined" />
          )}
          {diff.assistedStatus && (
            <Chip
              size="small"
              label={`Estado asistido: ${aiResolutionStatusLabel(diff.assistedStatus) ?? diff.assistedStatus}`}
              variant="outlined"
            />
          )}
        </Stack>

        <Divider sx={{ my: 1.25 }} />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
            gap: 1.25,
          }}
        >
          <SummaryColumn
            title="Heurístico"
            item={heuristic}
            details={renderHeuristicDetails?.(heuristic)}
          />
          <SummaryColumn
            title="Asistido"
            item={assisted}
            details={renderAssistedDetails?.(assisted)}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
