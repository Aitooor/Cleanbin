const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailDeliveryResult {
  sent: boolean;
  error?: string;
}

interface SetupEmailContent {
  subject: string;
  intro: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const safeIntro = escapeHtml(intro);
  const safeUrl = escapeHtml(setupUrl);
  return [
    `<p>${safeIntro}</p>`,
    '<p>Open the link below to choose your password and enable two-factor authentication:</p>',
    `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
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

export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim());
}

export async function sendInvitationEmail(to: string, setupUrl: string): Promise<EmailDeliveryResult> {
  return sendSetupEmail(to, setupUrl, {
    subject: 'Set up your Cleanbin account',
    intro: 'You have been invited to Cleanbin.',
  });
}

export async function sendRegistrationVerificationEmail(
  to: string,
  setupUrl: string
): Promise<EmailDeliveryResult> {
  return sendSetupEmail(to, setupUrl, {
    subject: 'Verify your Cleanbin account',
    intro: 'Confirm your email address to activate your Cleanbin account and configure 2FA.',
  });
}

export async function sendPasswordResetEmail(to: string, setupUrl: string): Promise<EmailDeliveryResult> {
  return sendSetupEmail(to, setupUrl, {
    subject: 'Reset your Cleanbin password',
    intro: 'A password reset was requested for your Cleanbin account.',
  });
}
