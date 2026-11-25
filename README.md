# Cleanbin

[![CI](https://github.com/Aitooor/Cleanbin/actions/workflows/ci.yml/badge.svg)](https://github.com/Aitooor/Cleanbin/actions/workflows/ci.yml)
[![Live Demo](https://img.shields.io/badge/Live_Demo-Try_in_Browser-2ea043?style=flat)](https://aitooor.github.io/Cleanbin/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Minimalist, self-hosted pastebin built with **Hono + Vite + React 19 + SQL** (`SQLite`, `MariaDB/MySQL`, or `PostgreSQL`).

> **[Try the Live Demo →](https://aitooor.github.io/Cleanbin/)**
> Runs 100% client-side in your browser's memory on GitHub Pages — **nothing is saved** to any server or database, and refreshing the tab resets all state. Jump directly to the **[Editor](https://aitooor.github.io/Cleanbin/)**, **[Syntax Viewer](https://aitooor.github.io/Cleanbin/#/hono-rate-limiter)**, or **[Admin Dashboard](https://aitooor.github.io/Cleanbin/#/dashboard)**.

---

## Preview

### Distraction-Free Editor (`/`) & Collapsible Syntax Viewer (`/:id`)

| Full-screen `#1e1e1e` Editor | Highlighted Paste Viewer (Collapsible `import`s) |
| :---: | :---: |
| ![Cleanbin Editor](docs/screenshots/editor.png) | ![Cleanbin Paste Viewer](docs/screenshots/paste-view.png) |

### Minimalist Management Dashboard (`/dashboard`)

| Overview & Metrics | Search, Regex Filters & Bulk Actions |
| :---: | :---: |
| ![Cleanbin Dashboard Overview](docs/screenshots/dashboard-overview.png) | ![Cleanbin Dashboard Pastes](docs/screenshots/dashboard-pastes.png) |

---

## Features

- **Minimalist Dark UI (`#1e1e1e`)**: Full-screen distraction-free editor (`/`), syntax-highlighted viewer with collapsible `import` blocks (`/:id`), and a matching flat 4-section dashboard (`/dashboard`).
- **Temporary & Permanent Pastes**: Anonymous pastes expire automatically after `PASTE_EXPIRATION_DAYS` (refreshed when viewed); authenticated accounts can store named permanent pastes, share edit access with teammates, and resolve concurrent edits safely (`409` optimistic locking + live editing indicator).
- **Zero-Trust Account Security**: Mandatory RFC 6238 **TOTP 2FA** (with anti-replay protection) or **WebAuthn Passkeys**, signed `HttpOnly` session cookies backed by revocable per-device SQL sessions, single-use email/manual invitations, and built-in sliding-window rate limiting.
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
| `npm run build` | Builds production Vite SPA (`dist/client`) and server TypeScript (`dist/server`) |
| `npm run build:demo` | Builds the static in-memory browser demo (`VITE_DEMO_MODE=1` → `dist/demo`) |
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

## Development Workflow

 Feature and documentation changes land on the `dev` branch first (verified by CI across `npm audit`, strict TypeScript checks, Vitest suite, production build, and static demo build) before merging into `main`.

## License

MIT
