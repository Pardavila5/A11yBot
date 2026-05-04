import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createAudit, listAudits } from '../api';
import { AuditListItem } from '../types';
import { formatDate, formatErrorMessage } from '../lib/format';
import { useToast } from '../ui/ToastProvider';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';

const RECENT_PAGE_SIZE = 5;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const recentRequestIdRef = useRef(0);

  const [urlInput, setUrlInput] = useState('https://example.com');
  const [auditing, setAuditing] = useState(false);
  const [loading, setLoading] = useState(false);

  const [recent, setRecent] = useState<AuditListItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  useEffect(() => {
    void loadRecent();
  }, []);

  async function loadRecent() {
    const requestId = ++recentRequestIdRef.current;
    try {
      setRecentLoading(true);
      const data = await listAudits({
        page: 1,
        pageSize: RECENT_PAGE_SIZE,
        order: 'desc',
      });
      if (requestId !== recentRequestIdRef.current) return;
      setRecent(data.items);
    } catch {
      if (requestId !== recentRequestIdRef.current) return;
      setRecent([]);
    } finally {
      if (requestId !== recentRequestIdRef.current) return;
      setRecentLoading(false);
    }
  }

  async function handleCreateAudit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      setAuditing(true);
      await createAudit(urlInput.trim());
      showToast({ message: 'Auditoría lanzada correctamente', severity: 'success' });
      await loadRecent();
      navigate('/audits');
    } catch (err: unknown) {
      showToast({ message: formatErrorMessage(err), severity: 'error' });
    } finally {
      setLoading(false);
      setAuditing(false);
    }
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3" sx={{ fontWeight: 900, letterSpacing: '-0.03em' }}>
            Inicio
          </Typography>
          <Typography color="text.secondary">
            Lanza auditorías, revisa el histórico y compara resultados entre ejecuciones.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Tooltip title="Abrir el histórico de auditorías">
            <Button component={Link} to="/audits" variant="outlined">
              Ver auditorías
            </Button>
          </Tooltip>
          <Tooltip title="Ir al comparador">
            <Button component={Link} to="/compare" variant="outlined">
              Ir a comparar
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2,
        }}
      >
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
              Nueva auditoría
            </Typography>
            <Stack component="form" direction={{ xs: 'column', sm: 'row' }} spacing={1.25} onSubmit={handleCreateAudit}>
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
              El backend abre la URL con Playwright y ejecuta axe-core. El resultado queda guardado en el histórico.
            </Typography>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Últimas auditorías
              </Typography>
              <Tooltip title="Actualizar últimas auditorías">
                <span>
                  <Button variant="outlined" onClick={() => void loadRecent()} disabled={recentLoading}>
                    Recargar
                  </Button>
                </span>
              </Tooltip>
            </Stack>
            <Divider sx={{ mb: 1 }} />
            {recentLoading && (
              <Stack spacing={1}>
                {Array.from({ length: 4 }).map((_, idx) => (
                  <Skeleton key={idx} variant="rounded" height={56} />
                ))}
              </Stack>
            )}
            {!recentLoading && recent.length === 0 && (
              <Typography color="text.secondary">Aún no hay auditorías.</Typography>
            )}
            <List dense disablePadding>
              {recent.map((a) => (
                <ListItemButton key={a.id} component={Link} to={`/audits/${a.id}`} sx={{ borderRadius: 2, mb: 0.75 }}>
                  <ListItemText
                    primary={
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Typography sx={{ fontWeight: 800 }}>#{a.id}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(a.timestamp)}
                        </Typography>
                      </Stack>
                    }
                    secondary={<Typography color="text.secondary">{a.website}</Typography>}
                  />
                </ListItemButton>
              ))}
            </List>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
