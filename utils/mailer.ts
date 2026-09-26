// Transactional email through the Resend HTTP API. Deliberately dependency-free:
// a single fetch keeps the surface small and avoids pulling an SDK into the
// production image.
//
// Configuration (all optional): RESEND_API_KEY, MAIL_FROM, APP_URL. When any of
// the former two is missing, or the provider call fails, we fail soft and let
// the caller fall back to a manual setup link. Secrets are never logged.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailDeliveryResult {
    sent: boolean;
    error?: string;
}

function buildInviteSubject(): string {
    return 'Set up your Cleanbin account';
}

function buildInviteText(setupUrl: string): string {
    return [
        'You have been invited to Cleanbin.',
        '',
        'Open the link below to choose your password and enable two-factor authentication:',
        setupUrl,
        '',
        'This link expires in 48 hours and can only be used once.',
    ].join('\n');
}

function buildInviteHtml(setupUrl: string): string {
    return [
        '<p>You have been invited to Cleanbin.</p>',
        '<p>Open the link below to choose your password and enable two-factor authentication:</p>',
        `<p><a href="${setupUrl}">${setupUrl}</a></p>`,
        '<p>This link expires in 48 hours and can only be used once.</p>',
    ].join('');
}

export async function sendInvitationEmail(
    to: string,
    setupUrl: string
): Promise<EmailDeliveryResult> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.MAIL_FROM?.trim();
    if (!apiKey || !from) {
        return { sent: false, error: 'Email delivery is not configured' };
    }

    try {
        const response = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from,
                to: [to],
                subject: buildInviteSubject(),
                text: buildInviteText(setupUrl),
                html: buildInviteHtml(setupUrl),
            }),
        });

        if (!response.ok) {
            return { sent: false, error: `Email provider responded with status ${response.status}` };
        }
        return { sent: true };
    } catch {
        return { sent: false, error: 'Email delivery failed' };
    }
}
