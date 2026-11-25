import crypto from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { getConfig } from '../config.js';
import { requireBrowserSession } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { resolveOrigin, resolveRpID, setSessionCookie } from '../services/auth.js';
import {
  consumeChallenge,
  deletePasskey,
  findPasskeyByCredentialId,
  fromBase64Url,
  getPasskey,
  getUserID,
  hasAnyPasskey,
  hasPasskey,
  listCredentialIds,
  saveChallenge,
  savePasskey,
  toBase64Url,
  type PasskeyRecord,
} from '../services/passkeys.js';
import { createUserSession } from '../services/sessions.js';
import { getAccountState } from '../services/users.js';

export const passkeyRoutes = new Hono();

const CEREMONY_COOKIE = 'passkey-ceremony';

const passkeyLoginLimiter = rateLimit({
  name: 'passkey-login',
  windowMs: 5 * 60_000,
  limit: () => getConfig().rateLimit.authPer5Min,
});

passkeyRoutes.get('/api/auth/passkey/status', async (c) => {
  const rpId = resolveRpID(c);
  const email = (c.req.query('email') || '').trim();
  const registered = await hasAnyPasskey(rpId);
  if (!email) {
    return c.json({ registered });
  }
  return c.json({ registered, hasPasskey: await hasPasskey(email, rpId) });
});

passkeyRoutes.post('/api/auth/passkey/login-options', passkeyLoginLimiter, async (c) => {
  const rpID = resolveRpID(c);
  const body = await c.req.json().catch(() => ({}));
  const requestedEmail = typeof body?.email === 'string' ? body.email.trim() : '';

  let allowCredentials: { id: string; transports?: WebAuthnCredential['transports'] }[] | undefined;
  if (requestedEmail) {
    const passkey = await getPasskey(requestedEmail, rpID);
    allowCredentials = passkey
      ? [{ id: passkey.credentialID, transports: passkey.transports as WebAuthnCredential['transports'] }]
      : [];
  } else {
    const credentials = await listCredentialIds(rpID);
    allowCredentials =
      credentials.length > 0
        ? credentials.map((cred) => ({
            id: cred.id,
            transports: cred.transports as WebAuthnCredential['transports'],
          }))
        : undefined;
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred',
  });

  const ceremonyId = crypto.randomUUID();
  saveChallenge(`authentication:${ceremonyId}`, options.challenge);
  setCookie(c, CEREMONY_COOKIE, ceremonyId, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 300,
  });

  return c.json(options);
});

passkeyRoutes.post('/api/auth/passkey/login', passkeyLoginLimiter, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const response = (body?.response ?? body) as AuthenticationResponseJSON | undefined;
  if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
    return c.json({ message: 'Missing authentication response' }, 400);
  }

  const passkey = await findPasskeyByCredentialId(response.id);
  if (!passkey) {
    return c.json({ message: 'Unknown passkey' }, 401);
  }

  const ceremonyId = getCookie(c, CEREMONY_COOKIE);
  deleteCookie(c, CEREMONY_COOKIE, { path: '/' });

  const expectedChallenge = ceremonyId ? consumeChallenge(`authentication:${ceremonyId}`) : null;
  if (!expectedChallenge) {
    return c.json({ message: 'Authentication challenge expired. Please try again.' }, 400);
  }

  const credential: WebAuthnCredential = {
    id: passkey.credentialID,
    publicKey: fromBase64Url(passkey.credentialPublicKey),
    counter: passkey.counter,
    transports: passkey.transports as WebAuthnCredential['transports'],
  };

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: resolveOrigin(c),
      expectedRPID: resolveRpID(c),
      credential,
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return c.json({ message: 'Passkey authentication failed' }, 401);
    }

    await savePasskey({
      ...passkey,
      counter: verification.authenticationInfo.newCounter,
    });

    const account = await getAccountState(passkey.email);
    const role = account?.role ?? 'user';
    const session = await createUserSession(
      passkey.email,
      role,
      c.req.header('user-agent') ?? ''
    );
    setSessionCookie(c, passkey.email, role, session.id);
    return c.json({ message: 'Login successful', email: passkey.email, role });
  } catch {
    return c.json({ message: 'Passkey authentication failed' }, 401);
  }
});

passkeyRoutes.post('/api/auth/passkey/register-options', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  const rpID = resolveRpID(c);
  const email = session.email;
  const userID = getUserID(email);
  const existing = await getPasskey(email, rpID);

  const options = await generateRegistrationOptions({
    rpName: 'Cleanbin',
    rpID,
    userName: email,
    userID: fromBase64Url(userID),
    attestationType: 'none',
    excludeCredentials: existing
      ? [{ id: existing.credentialID, transports: existing.transports as WebAuthnCredential['transports'] }]
      : [],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  saveChallenge(`registration:${rpID}:${email}`, options.challenge);
  return c.json(options);
});

passkeyRoutes.post('/api/auth/passkey/register', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  const body = await c.req.json().catch(() => ({}));
  const response = (body?.response ?? body) as RegistrationResponseJSON | undefined;
  if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
    return c.json({ message: 'Missing registration response' }, 400);
  }

  const rpID = resolveRpID(c);
  const email = session.email;
  const userID = getUserID(email);
  const expectedChallenge = consumeChallenge(`registration:${rpID}:${email}`);
  if (!expectedChallenge) {
    return c.json({ message: 'Registration challenge expired. Please try again.' }, 400);
  }

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: resolveOrigin(c),
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ message: 'Passkey registration could not be verified' }, 400);
    }

    const { credential } = verification.registrationInfo;
    const record: PasskeyRecord = {
      credentialID: credential.id,
      credentialPublicKey: toBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      userID,
      email,
      rpID,
      createdAt: new Date().toISOString(),
    };
    await savePasskey(record);

    // Keep TOTP enabled on the account so the user can still sign in on other
    // domains (when serving multiple hostnames) until they also register a
    // passkey there; password login is disabled per-domain where a passkey exists.
    return c.json({ verified: true, passwordLoginDisabled: true, totpRemoved: false });
  } catch {
    return c.json({ message: 'Passkey registration failed' }, 400);
  }
});

passkeyRoutes.delete('/api/auth/passkey', async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;

  const rpID = resolveRpID(c);
  const existing = await getPasskey(session.email, rpID);
  if (!existing) {
    return c.json({ message: 'No passkey is registered for this account on this domain' }, 404);
  }

  await deletePasskey(session.email, rpID);
  return c.json({ message: 'Passkey removed' });
});
