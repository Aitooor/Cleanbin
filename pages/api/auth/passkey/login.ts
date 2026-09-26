import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import {
    createSessionToken,
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
} from '../../../../utils/auth';
import {
    consumeChallenge,
    fromBase64Url,
    getPasskey,
    savePasskey,
} from '../../../../utils/passkeys';
import { resolveOrigin, resolveRpID } from '../../../../utils/passkeyRequest';

// Public: this is the passkey login endpoint itself.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', ['POST']);
            return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
        }

        const response = (req.body?.response ?? req.body) as AuthenticationResponseJSON | undefined;
        if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
            return res.status(400).json({ message: 'Missing authentication response' });
        }

        const passkey = await getPasskey();
        if (!passkey) {
            return res.status(400).json({ message: 'No passkey is registered' });
        }
        if (response.id !== passkey.credentialID) {
            return res.status(401).json({ message: 'Unknown passkey' });
        }

        const expectedChallenge = consumeChallenge(`authentication:${passkey.credentialID}`);
        if (!expectedChallenge) {
            return res.status(400).json({ message: 'Authentication challenge expired. Please try again.' });
        }

        const credential: WebAuthnCredential = {
            id: passkey.credentialID,
            publicKey: fromBase64Url(passkey.credentialPublicKey),
            counter: passkey.counter,
            transports: passkey.transports,
        };

        const verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge,
            expectedOrigin: resolveOrigin(req),
            expectedRPID: resolveRpID(req),
            credential,
            requireUserVerification: false,
        });

        if (!verification.verified) {
            return res.status(401).json({ message: 'Passkey authentication failed' });
        }

        await savePasskey({
            ...passkey,
            counter: verification.authenticationInfo.newCounter,
        });

        const token = createSessionToken(passkey.email, 'admin');
        res.setHeader(
            'Set-Cookie',
            serialize(SESSION_COOKIE_NAME, token, {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                path: '/',
                maxAge: SESSION_MAX_AGE_SECONDS,
            })
        );
        return res.status(200).json({ message: 'Login successful', email: passkey.email, role: 'admin' });
    } catch (error) {
        console.error('POST /api/auth/passkey/login error:', error);
        return res.status(401).json({ message: 'Passkey authentication failed' });
    }
}
