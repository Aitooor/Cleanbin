// Small shared formatters for the dashboard pages.

export function formatDateTime(value: string | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function formatDate(value: string | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
}

// Turns a raw User-Agent into a short device label for the sessions list.
export function describeUserAgent(userAgent: string): string {
    if (!userAgent) return 'Unknown device';

    const os = /Windows/.test(userAgent)
        ? 'Windows'
        : /iPhone|iPad|iPod/.test(userAgent)
          ? 'iOS'
          : /Android/.test(userAgent)
            ? 'Android'
            : /Mac OS X|Macintosh/.test(userAgent)
              ? 'macOS'
              : /Linux/.test(userAgent)
                ? 'Linux'
                : 'Unknown OS';

    const browser = /Edg\//.test(userAgent)
        ? 'Edge'
        : /OPR\/|Opera/.test(userAgent)
          ? 'Opera'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : /Chrome\//.test(userAgent)
              ? 'Chrome'
              : /Safari\//.test(userAgent)
                ? 'Safari'
                : 'Browser';

    return `${browser} · ${os}`;
}

