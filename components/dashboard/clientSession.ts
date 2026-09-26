// Client-side session helpers shared by the top bar and the Account page.

export async function revokeCurrentSession(): Promise<void> {
    try {
        await fetch('/api/sessions', { method: 'DELETE' });
    } catch {
        // Best effort: the cookie is cleared locally regardless.
    }
}

export function clearAuthCookie(): void {
    localStorage.removeItem('authToken');
    document.cookie = 'auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;';
}
