import { beforeEach, describe, expect, it } from 'vitest';
import { installDemoMode, resetDemoState } from '../src/client/demo/demoBackend.js';

describe('In-memory Live Demo API shim (zero persistence)', () => {
  beforeEach(() => {
    // Provide minimal browser globals for node test environment
    (globalThis as unknown as { window: unknown }).window = globalThis;
    Object.defineProperty(globalThis, 'location', {
      value: new URL('https://aitooor.github.io/Cleanbin/'),
      configurable: true,
    });
    installDemoMode();
    resetDemoState();
  });

  it('serves seeded pastes, creates ephemeral pastes, supports regex filtering, and resets cleanly', async () => {
    const authRes = await fetch('https://aitooor.github.io/api/auth');
    expect(authRes.status).toBe(200);
    const auth = await authRes.json();
    expect(auth.authenticated).toBe(true);
    expect(auth.email).toBe('demo@example.com');

    const initialList = await (await fetch('https://aitooor.github.io/api/pastes?page=1&limit=50')).json();
    expect(initialList.total).toBe(5);

    const createRes = await fetch('https://aitooor.github.io/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ephemeral snippet', content: 'const x = 42;', permanent: false }),
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const getCreated = await (await fetch(`https://aitooor.github.io/api/paste/${id}?touch=1`)).json();
    expect(getCreated.content).toBe('const x = 42;');

    const rules = encodeURIComponent(JSON.stringify([{ field: 'content', op: 'regex', value: 'x\\s*=\\s*42' }]));
    const filtered = await (await fetch(`https://aitooor.github.io/api/pastes?filterRules=${rules}`)).json();
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].id).toBe(id);

    resetDemoState();
    const afterReset = await fetch(`https://aitooor.github.io/api/paste/${id}`);
    expect(afterReset.status).toBe(404);
  });
});
