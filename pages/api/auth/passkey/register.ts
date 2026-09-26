import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { requireSession } from '../../../../utils/auth';
import {
    consumeChallenge,
    getUserID,
    savePasskey,
    toBase64Url,
    type PasskeyRecord,
} from '../../../../utils/passkeys';
import { disableTotp, getAccountState } from '../../../../utils/users';
import { resolveOrigin, resolveRpID } from '../../../../utils/passkeyRequest';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', ['POST']);
            return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
        }

        const session = requireSession(req, res);
        if (!session) return;

        const response = (req.body?.response ?? req.body) as RegistrationResponseJSON | undefined;
        if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
            return res.status(400).json({ message: 'Missing registration response' });
        }

        const userID = await getUserID();
        const expectedChallenge = consumeChallenge(`registration:${userID}`);
        if (!expectedChallenge) {
            return res.status(400).json({ message: 'Registration challenge expired. Please try again.' });
        }

        const verification = await verifyRegistrationResponse({
            response,
            expectedChallenge,
            expectedOrigin: resolveOrigin(req),
            expectedRPID: resolveRpID(req),
            requireUserVerification: false,
        });

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ message: 'Passkey registration could not be verified' });
        }

        const { credential } = verification.registrationInfo;
        const accountEmail = process.env.ADMIN_EMAIL || session.email;
        const record: PasskeyRecord = {
            credentialID: credential.id,
            credentialPublicKey: toBase64Url(credential.publicKey),
            counter: credential.counter,
            transports: credential.transports ?? [],
            userID,
            email: accountEmail,
            createdAt: new Date().toISOString(),
        };
        await savePasskey(record);

        // Signing in with a passkey replaces both the password and the TOTP code,
        // so the second factor is removed as well. Report both effects to the UI.
        const account = await getAccountState(accountEmail);
        const totpRemoved = !!account?.totpEnabled;
        if (totpRemoved) {
            await disableTotp(accountEmail);
        }

        return res.status(200).json({ verified: true, passwordLoginDisabled: true, totpRemoved });
    } catch (error) {
        console.error('POST /api/auth/passkey/register error:', error);
        return res.status(400).json({ message: 'Passkey registration failed' });
    }
}
