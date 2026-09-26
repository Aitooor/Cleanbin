import type { NextApiRequest, NextApiResponse } from 'next';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { requireSession } from '../../../../utils/auth';
import {
    fromBase64Url,
    getPasskey,
    getUserID,
    saveChallenge,
} from '../../../../utils/passkeys';
import { resolveRpID } from '../../../../utils/passkeyRequest';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', ['POST']);
            return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
        }

        const session = requireSession(req, res);
        if (!session) return;

        const rpID = resolveRpID(req);
        // Each account owns its passkey: the session email decides which record
        // is touched, never the environment admin.
        const email = session.email;
        const userID = getUserID(email);
        const existing = await getPasskey(email);

        const options = await generateRegistrationOptions({
            rpName: 'Cleanbin',
            rpID,
            userName: email,
            userID: fromBase64Url(userID),
            attestationType: 'none',
            excludeCredentials: existing
                ? [{ id: existing.credentialID, transports: existing.transports }]
                : [],
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
        });

        saveChallenge(`registration:${email}`, options.challenge);
        return res.status(200).json(options);
    } catch (error) {
        console.error('POST /api/auth/passkey/register-options error:', error);
        return res.status(500).json({ message: 'Failed to create registration options' });
    }
}
