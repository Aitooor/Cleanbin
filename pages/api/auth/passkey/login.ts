import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import { setSessionCookie } from '../../../../utils/auth';
import {
    consumeChallenge,
    findPasskeyByCredentialId,
    fromBase64Url,
    savePasskey,
} from '../../../../utils/passkeys';
import { getAccountState } from '../../../../utils/users';
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

        // Locate the account that owns the presented credential; its email and
        // role decide the session, so no account can borrow another's passkey.
        const passkey = await findPasskeyByCredentialId(response.id);
        if (!passkey) {
            return res.status(401).json({ message: 'Unknown passkey' });
        }

        const expectedChallenge =
            consumeChallenge(`authentication:${passkey.credentialID}`) ??
            consumeChallenge('authentication:discoverable');
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

        const account = await getAccountState(passkey.email);
        const role = account?.role ?? 'user';
        setSessionCookie(res, passkey.email, role);
        return res.status(200).json({ message: 'Login successful', email: passkey.email, role });
    } catch (error) {
        console.error('POST /api/auth/passkey/login error:', error);
        return res.status(401).json({ message: 'Passkey authentication failed' });
    }
}
