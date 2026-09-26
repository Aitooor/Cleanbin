import type { NextApiRequest, NextApiResponse } from 'next';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getPasskey, listCredentialIds, saveChallenge } from '../../../../utils/passkeys';
import { resolveRpID } from '../../../../utils/passkeyRequest';

// Public: anyone reaching the login page may start a passkey ceremony.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', ['POST']);
            return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
        }

        const requestedEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

        let allowCredentials: { id: string; transports: string[] }[] | undefined;
        let challengeKey: string;

        if (requestedEmail) {
            // When the caller names an account, only that account's passkey is
            // offered; otherwise every registered credential is, so any account
            // can sign in without typing its email.
            const passkey = await getPasskey(requestedEmail);
            allowCredentials = passkey
                ? [{ id: passkey.credentialID, transports: passkey.transports }]
                : [];
            challengeKey = passkey ? `authentication:${passkey.credentialID}` : 'authentication:discoverable';
        } else {
            const credentials = await listCredentialIds();
            allowCredentials = credentials.length > 0 ? credentials : undefined;
            challengeKey = 'authentication:discoverable';
        }

        const options = await generateAuthenticationOptions({
            rpID: resolveRpID(req),
            allowCredentials,
            userVerification: 'preferred',
        });

        // Correlate the one-time challenge with the credential the browser will use.
        saveChallenge(challengeKey, options.challenge);

        return res.status(200).json(options);
    } catch (error) {
        console.error('POST /api/auth/passkey/login-options error:', error);
        return res.status(500).json({ message: 'Failed to create authentication options' });
    }
}
