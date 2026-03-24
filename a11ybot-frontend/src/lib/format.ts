export function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatErrorMessage(err: unknown): string {
  if (!err) return 'Error desconocido';
  const anyErr = err as any;
  const msg = anyErr?.message ?? anyErr?.toString?.();
  if (typeof msg === 'string') {
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.message) {
        if (Array.isArray(parsed.message)) return parsed.message.join(' | ');
        return String(parsed.message);
      }
    } catch {
      // ignore
    }
    return msg;
  }
  if (Array.isArray(msg)) return msg.join(' | ');
  return 'Error desconocido';
}

