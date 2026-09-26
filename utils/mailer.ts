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

interface SetupEmailContent {
    subject: string;
    intro: string;
}

function buildSetupText(intro: string, setupUrl: string): string {
    return [
        intro,
        '',
        'Open the link below to choose your password and enable two-factor authentication:',
        setupUrl,
        '',
        'This link expires in 48 hours and can only be used once.',
    ].join('\n');
}

function buildSetupHtml(intro: string, setupUrl: string): string {
    return [
        `<p>${intro}</p>`,
        '<p>Open the link below to choose your password and enable two-factor authentication:</p>',
        `<p><a href="${setupUrl}">${setupUrl}</a></p>`,
        '<p>This link expires in 48 hours and can only be used once.</p>',
    ].join('');
}

async function sendSetupEmail(
    to: string,
    setupUrl: string,
    content: SetupEmailContent
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
                subject: content.subject,
                text: buildSetupText(content.intro, setupUrl),
                html: buildSetupHtml(content.intro, setupUrl),
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

export async function sendInvitationEmail(
    to: string,
    setupUrl: string
): Promise<EmailDeliveryResult> {
    return sendSetupEmail(to, setupUrl, {
        subject: 'Set up your Cleanbin account',
        intro: 'You have been invited to Cleanbin.',
    });
}

export async function sendPasswordResetEmail(
    to: string,
    setupUrl: string
): Promise<EmailDeliveryResult> {
    return sendSetupEmail(to, setupUrl, {
        subject: 'Reset your Cleanbin password',
        intro: 'A password reset was requested for your Cleanbin account.',
    });
}
