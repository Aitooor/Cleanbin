import type { NextApiRequest } from 'next';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

function resolveHost(req: NextApiRequest): string {
    return (
        firstHeaderValue(req.headers['x-forwarded-host']) ||
        firstHeaderValue(req.headers.host) ||
        'localhost'
    );
}

// Relying Party origin used to validate WebAuthn ceremonies. Prefer the explicit
// PASSKEY_ORIGIN setting (e.g. behind a proxy) and fall back to the request Host.
export function resolveOrigin(req: NextApiRequest): string {
    const configured = process.env.PASSKEY_ORIGIN?.trim();
    if (configured) return configured;

    const proto =
        firstHeaderValue(req.headers['x-forwarded-proto']) ||
        ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? 'https' : 'http');
    return `${proto}://${resolveHost(req)}`;
}

// Relying Party ID is the bare domain (no scheme, no port). Prefer PASSKEY_RP_ID.
export function resolveRpID(req: NextApiRequest): string {
    const configured = process.env.PASSKEY_RP_ID?.trim();
    if (configured) return configured;
    return resolveHost(req).split(':')[0];
}
