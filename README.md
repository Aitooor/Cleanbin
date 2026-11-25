# Cleanbin

Minimalist, self-hosted pastebin built with **Hono + Vite + React 19 + SQL** (`SQLite`, `MariaDB/MySQL`, or `PostgreSQL`).

## Features

- **Minimalist dark UI (`#1e1e1e`)**: Distraction-free full-screen editor (`/`), syntax-highlighted viewer with collapsible `import` blocks (`/:id`), and a matching flat 4-section dashboard (`/dashboard`).
- **Temporary & Permanent Pastes**: Anonymous pastes expire automatically after `PASTE_EXPIRATION_DAYS` (refreshed when viewed); authenticated accounts can store named permanent pastes, share edit access with teammates, and resolve concurrent edits safely (`409` optimistic locking + live editing indicator).
- **Zero-trust Account Security**: Mandatory RFC 6238 **TOTP 2FA** (with anti-replay protection) or **WebAuthn Passkeys**, signed `HttpOnly` session cookies backed by revocable per-device SQL sessions, single-use email/manual invitations, and built-in sliding-window rate limiting.
- **Unified SQL Storage + Automatic v1 Migration**: Stores pastes (Brotli-compressed), users, sessions, and passkeys in `SQLite` (default), `MariaDB/MySQL`, or `PostgreSQL`. Automatically upgrades existing Cleanbin v1 `data/pastes.db` and imports legacy `users.json` / `sessions.json` / `passkeys.json` on first boot without deleting the original files.

## Quick Start

```bash
cp .env_example .env
# Edit .env and set AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run dev
```

### Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Starts Hono API + Vite HMR dev server |
| `npm run build` | Builds Vite SPA (`dist/client`) and server TypeScript (`dist/server`) |
| `npm run start` | Runs the production Hono server on `0.0.0.0:${PORT:-3000}` |
| `npm run typecheck` | Runs strict TypeScript checks across client, shared, tests, and server |
| `npm test` | Runs the Vitest automated test suite |
| `npm run backup` | Creates a hot consistent snapshot in `DATA_DIR/backups/` |

## SQL Engines

Configure via `DATABASE__SAVE_TYPE` in `.env`:

- `SQLite` (default): `DATABASE__SQLITE_DB_PATH=./data/pastes.db`
- `PostgreSQL`: `DATABASE__POSTGRES_URI=postgresql://user:pass@host:5432/cleanbin`
- `MariaDB` / `MySQL`: `DATABASE__MARIADB_URI=mysql://user:pass@host:3306/cleanbin`

## Reverse Proxy & Multi-Domain Support

When running behind a reverse proxy (such as Nginx, Caddy, or Cloudflare), set `TRUST_PROXY=1` and forward `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`. Leave `APP_URL` and `PASSKEY_RP_ID` unset if you want setup links and WebAuthn Relying Party IDs derived automatically from each incoming domain.

## License

MIT
