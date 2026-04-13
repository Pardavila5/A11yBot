import { NavLink, Outlet } from 'react-router-dom';
import {
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useColorMode } from '../theme/ColorModeProvider';

function NavButton({
  to,
  label,
  end,
}: {
  to: string;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <Button
          color={isActive ? 'primary' : 'inherit'}
          variant={isActive ? 'contained' : 'text'}
          disableElevation
          sx={{ borderRadius: 999, px: 1.25 }}
        >
          {label}
        </Button>
      )}
    </NavLink>
  );
}

export default function Layout() {
  const { mode, toggleMode } = useColorMode();

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>

      <AppBar
        position="sticky"
        elevation={0}
        color="transparent"
        sx={(theme) => ({
          backdropFilter: 'blur(10px)',
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor:
            theme.palette.mode === 'dark'
              ? 'rgba(11,16,32,0.72)'
              : 'rgba(246,247,251,0.76)',
        })}
      >
        <Container maxWidth="xl">
          <Toolbar disableGutters sx={{ py: 1, gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                component={NavLink}
                to="/"
                variant="h6"
                color="inherit"
                sx={{
                  fontWeight: 900,
                  letterSpacing: '-0.03em',
                  textDecoration: 'none',
                }}
              >
                A11yBot
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                Auditoría automática de accesibilidad
              </Typography>
            </Box>

            <Box sx={{ flex: 1 }} />

            <Box component="nav" aria-label="Navegacion principal" sx={{ display: 'flex', gap: 1 }}>
              <NavButton to="/" label="Inicio" end />
              <NavButton to="/audits" label="Auditorias" />
              <NavButton to="/compare" label="Comparar" />
              <NavButton to="/ops" label="Ops" />
            </Box>

            <Tooltip title={mode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
              <IconButton
                onClick={toggleMode}
                aria-label={mode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                color="inherit"
                sx={{ ml: 0.5 }}
              >
                {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>
          </Toolbar>
        </Container>
      </AppBar>

      <main id="main">
        <Container maxWidth="xl" sx={{ py: 4 }}>
          <Outlet />
        </Container>
      </main>

      <Container maxWidth="xl" sx={{ py: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Backend: NestJS + Playwright + axe-core · DB: Prisma/SQLite
        </Typography>
      </Container>
    </Box>
  );
}
