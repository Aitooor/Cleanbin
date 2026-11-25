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

- **Minimalist Dark UI (`#1e1e1e`)**: Full-screen distraction-free editor (`/` with `Ctrl+S` save & 2-space `Tab`/`Shift+Tab` indentation), syntax-highlighted viewer across 20 languages (including `diff` and safe GFM **Markdown Preview** toggle), live state editing directly from `/:id` or `/dashboard/pastes` (`public`/`private`, `permanent`/`30d`/`7d`/`24h`/`1h`/`1 read`, owner reassignment), collapsible `import` blocks, clickable line-range links (`#L12` / `#L10-L25`), Copy / Raw (`/raw/:id`) / Smart Download / Clone actions, and a flat 5-section dashboard (`/dashboard`, `/dashboard/pastes`, `/dashboard/users`, `/dashboard/settings`, `/dashboard/account`).
- **Terminal Upload (`POST /raw`) & Personal API Tokens**: Pipe files or logs straight from any shell (`cat build.log | curl -fsS --data-binary @- https://your-host/raw` or `curl -fsS -T script.py https://your-host/raw/script.py`) with optional `X-TTL`, `X-Name`, and `X-Visibility: private` headers, and mint revocable SHA-256-hashed `cb_...` personal API tokens in `/dashboard/account`.
- **Public / Private Visibility, Selectable TTL & Burn-After-Read**: Toggle **Public** vs **Private** (visible strictly to owner, collaborators, and admins; returns `404` otherwise), choose per-paste expiration (`1h`, `24h`, `7d`, `30d`, `1 read` burn-after-read with atomic self-destruction on first open, or `Permanent` for signed-in users), and optionally enable **zero-knowledge client-side E2EE (`AES-256-GCM`)** where the decryption key stays strictly in the URL `#k=...` fragment.
- **Role-Scoped Auth, Granular Quotas & Flexible Registration**: Switch between **Invite-only** and **Open registration** (with optional Resend email verification and configurable per-user limits for **total**, **public**, **private** pastes, and **compressed MB on disk**) from `/dashboard/settings`. **Administrators** enforce mandatory RFC 6238 **TOTP 2FA** (with ISO high-contrast SVG QR onboarding & anti-replay protection) or **WebAuthn Passkeys**, while **standard users** can sign in immediately and opt into 2FA or Passkeys anytime in `/dashboard/account`.
- **Ultra-Compact SQL Storage**: Compresses pure paste text with **Brotli quality 11 (`BROTLI_MODE_TEXT`)** stored as raw binary `BLOB`s on `SQLite` (zero JSON wrapper or Base64 inflation, incremental auto-vacuum, and one-click `VACUUM` compaction in `/dashboard/settings`), while supporting `MariaDB/MySQL` and `PostgreSQL` out of the box.

## CLI Usage

```bash
# Anonymous paste (returns https://your-host/<id>)
cat app.log | curl -fsS --data-binary @- https://your-host/raw

# Upload file preserving filename + 24h TTL
curl -fsS -H "X-TTL: 24h" -T deploy.sh https://your-host/raw/deploy.sh

# Permanent owned paste using a personal API token from /dashboard/account
cat notes.md | curl -fsS \
  -H "Authorization: Bearer cb_your_token" \
  -H "X-TTL: permanent" \
  -H "X-Name: Architecture Notes.md" \
  --data-binary @- https://your-host/raw
```

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
| `npm run backup` | Creates a hot consistent snapshot in `DATA_DIR/backups/` (also runs automatically daily via `BACKUP_CRON`, retaining `BACKUP_KEEP=7` snapshots) |

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
