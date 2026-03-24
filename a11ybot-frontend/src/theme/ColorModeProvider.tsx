import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { CssBaseline, GlobalStyles, ThemeProvider, createTheme } from '@mui/material';

export type ColorMode = 'light' | 'dark';

type ColorModeContextValue = {
  mode: ColorMode;
  toggleMode: () => void;
  setMode: (mode: ColorMode) => void;
};

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

const STORAGE_KEY = 'a11ybot-theme';

function getInitialMode(): ColorMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  return prefersDark ? 'dark' : 'light';
}

export function useColorMode(): ColorModeContextValue {
  const value = useContext(ColorModeContext);
  if (!value) {
    throw new Error('useColorMode must be used within ColorModeProvider');
  }
  return value;
}

export default function ColorModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(() => getInitialMode());

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }, [mode]);

  const theme = useMemo(() => {
    const isDark = mode === 'dark';
    return createTheme({
      palette: {
        mode,
        primary: {
          main: isDark ? '#e5e7eb' : '#111827',
          contrastText: isDark ? '#0b1020' : '#ffffff',
        },
        background: {
          default: isDark ? '#0b1020' : '#f6f7fb',
          paper: isDark ? '#0f172a' : '#ffffff',
        },
        divider: isDark ? '#223049' : '#e5e8f0',
      },
      shape: {
        borderRadius: 12,
      },
      typography: {
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      components: {
        MuiButton: {
          styleOverrides: {
            root: {
              textTransform: 'none',
              borderRadius: 12,
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              backgroundImage: 'none',
            },
          },
        },
      },
    });
  }, [mode]);

  const value = useMemo<ColorModeContextValue>(
    () => ({
      mode,
      setMode,
      toggleMode: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')),
    }),
    [mode],
  );

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GlobalStyles
          styles={(t) => ({
            ':root': {
              colorScheme: mode,
            },
            body: {
              background:
                t.palette.mode === 'dark'
                  ? 'radial-gradient(circle at 20% 20%, rgba(59,130,246,0.24), transparent 30%), radial-gradient(circle at 80% 10%, rgba(244,114,182,0.16), transparent 28%), radial-gradient(circle at 50% 80%, rgba(16,185,129,0.14), transparent 34%), #0b1020'
                  : 'radial-gradient(circle at 20% 20%, #e5ecff, transparent 30%), radial-gradient(circle at 80% 10%, #ffe8f0, transparent 28%), radial-gradient(circle at 50% 80%, #e8fff4, transparent 34%), #f6f7fb',
              transition: 'background-color 160ms ease, color 160ms ease',
            },
            '@media (prefers-reduced-motion: reduce)': {
              body: { transition: 'none' },
            },
          })}
        />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

