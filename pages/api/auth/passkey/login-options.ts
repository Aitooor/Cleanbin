import type { NextApiRequest, NextApiResponse } from 'next';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getPasskey, saveChallenge } from '../../../../utils/passkeys';
import { resolveRpID } from '../../../../utils/passkeyRequest';

// Public: anyone reaching the login page may start a passkey ceremony.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', ['POST']);
            return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
        }

        const passkey = await getPasskey();
        const options = await generateAuthenticationOptions({
            rpID: resolveRpID(req),
            allowCredentials: passkey
                ? [{ id: passkey.credentialID, transports: passkey.transports }]
                : undefined,
            userVerification: 'preferred',
        });

        // Correlate the one-time challenge with the credential the browser will use.
        const challengeKey = passkey
            ? `authentication:${passkey.credentialID}`
            : 'authentication:discoverable';
        saveChallenge(challengeKey, options.challenge);

        return res.status(200).json(options);
    } catch (error) {
        console.error('POST /api/auth/passkey/login-options error:', error);
        return res.status(500).json({ message: 'Failed to create authentication options' });
    }
}
