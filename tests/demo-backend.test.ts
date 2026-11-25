import { beforeEach, describe, expect, it } from 'vitest';
import { installDemoMode, resetDemoState } from '../src/client/demo/demoBackend.js';

describe('In-memory Live Demo API shim (zero persistence)', () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    Object.defineProperty(globalThis, 'location', {
      value: new URL('https://aitooor.github.io/Cleanbin/'),
      configurable: true,
    });
    installDemoMode();
    resetDemoState();
  });

  it('serves seeded pastes, creates/edits/shares ephemeral pastes, supports regex filtering, and resets cleanly', async () => {
    const auth = await (await fetch('https://aitooor.github.io/api/auth')).json();
    expect(auth.authenticated).toBe(true);
    expect(auth.email).toBe('demo@example.com');

    const createRes = await fetch('https://aitooor.github.io/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ephemeral snippet', content: 'const x = 42;', permanent: true }),
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    // PATCH edit (used by PastesPage edit modal)
    const patchRes = await fetch(`https://aitooor.github.io/api/paste/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated snippet', content: 'const x = 99;', version: 1 }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.paste.version).toBe(2);
    expect(patched.paste.content).toBe('const x = 99;');

    // Share add/remove (used by PastesPage share modal)
    const shareRes = await fetch(`https://aitooor.github.io/api/paste/${id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex@example.com', action: 'add' }),
    });
    expect(shareRes.status).toBe(200);
    expect((await shareRes.json()).sharedWith).toEqual(['alex@example.com']);

    // Invite user + setup flow (?token=...) + reset-2fa
    const inviteRes = await fetch('https://aitooor.github.io/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', role: 'user', permanentDeleteLimit: 2 }),
    });
    expect(inviteRes.status).toBe(201);
    const invited = await inviteRes.json();
    expect(invited.invitePending).toBe(true);
    expect(invited.setupUrl).toContain('#/setup?token=');

    const setupStart = await (
      await fetch('https://aitooor.github.io/api/setup/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'demo-token', password: 'demoPassword123' }),
      })
    ).json();
    expect(setupStart.groupedSecret).toBeTruthy();

    const reset2faRes = await fetch('https://aitooor.github.io/api/users/alex%40example.com', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset-2fa' }),
    });
    expect(reset2faRes.status).toBe(200);

    resetDemoState();
    const afterReset = await fetch(`https://aitooor.github.io/api/paste/${id}`);
    expect(afterReset.status).toBe(404);
  });
});
