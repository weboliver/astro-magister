# Secrets and rotation

> Every secret class this stack really uses: where the value comes from, how it is rotated and
> what the rotation invalidates. `.env.example` is the variable reference; this file is the
> runbook. `.env` is never committed.

Throughout this runbook, **"restart" means recreation**. The stack receives `.env` through
`env_file` and `environment` only when a container is *created*, so `docker restart` keeps the old
values. Recreate the affected service with `docker/build.sh <service …>`
(Review 2026-11-20).

## At a glance

| Secret | Variables (`.env`) | Where it comes from | Rotation affects |
|---|---|---|---|
| Database password | `DB_PASSWORD`, `DATABASE_URL` | Chosen by the operator; read by SQLAlchemy (`app/db/session.py`) | New database connections; no user login |
| JWT signing secret | `SECRET_KEY` | Generated: `python -c "import secrets; print(secrets.token_hex(32))"` | All access tokens; refresh tokens only if they are revoked as well (see below) |
| Perplexity API key | `API_KEY` | Perplexity dashboard (perplexity.ai) | In-flight provider calls; only while Perplexity is the active provider |
| Mistral API key | `MISTRAL_API_KEY` | Mistral console (console.mistral.ai) | In-flight provider calls; only while Mistral is the active provider |
| Cloudflare Turnstile | `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY` | Cloudflare dashboard (Turnstile widget) | In-flight challenges and tokens; with `DEBUG=false` additionally a frontend build |
| SMTP | — not applicable — | No mail feature exists in this codebase | — |

## DB_PASSWORD

`DB_PASSWORD` is the password of the PostgreSQL role. When `DATABASE_URL` is set it carries the same
password inside the URL; `app/db/session.py` prefers `DATABASE_URL` and only falls back to a URL
built from `DB_HOST`, `DB_NAME`, `DB_USER` and `DB_PASSWORD`.

1. Generate a new password.
2. Set it **in the running database**. Open a shell in the database container:

   ```bash
   docker exec -it astronex-db psql -U <DB_USER> -d <DB_NAME>
   ```

   and inside psql prefer `\password <DB_USER>`. `\password` asks for the new password twice and
   sends only its hash to the server, so the plaintext appears neither in the terminal scrollback
   nor in `~/.psql_history`.
3. The SQL equivalent is `ALTER ROLE <DB_USER> WITH PASSWORD '<new>'`. Prefer the `\password` form
   above: this statement writes the plaintext password into the psql history file
   (Review 2026-11-20).
4. Update `.env`: `DB_PASSWORD`, and `DATABASE_URL` when that variable holds a full URL — the
   password is part of it.
5. Recreate the api container: `docker/build.sh api`.

**Changing `POSTGRES_PASSWORD` alone does nothing.** The Postgres image applies
`POSTGRES_PASSWORD` only when it initialises an empty data directory. This stack keeps its data in
the named volume `docker_postgres_data` (compose key `postgres_data` with an explicit `name:`), so
the database is already initialised and the image ignores the new value
(`docker/docker-compose.yml:239-240`).

**Invalidates:** no user login. Existing sessions keep working; new connections authenticate with
the new password, which is why the api container is recreated. Whether connections already open in
the pool survive the `ALTER ROLE` was not measured, so this runbook makes no claim about them.

## SECRET_KEY

`SECRET_KEY` signs every access token (HS256, `app/services/auth.py`) and is also used by
FastAPI-Users for its password-reset and verification tokens.

1. Generate a new secret of at least 32 characters:

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

   `app/config.py` refuses to start with a shorter value when `DEBUG` is not `true`.
2. Put it into `.env` as `SECRET_KEY`.
3. Recreate the api container: `docker/build.sh api`.

**Invalidates:** every access token and every cookie that carries one — the signature no longer
verifies. Password-reset and verification links minted with the old secret stop working as well.

**Refresh tokens survive — this is the part that is easy to get wrong.** A refresh token is not a
signed JWT; it is an opaque random string (`secrets.token_urlsafe(32)`) stored as a row in the
`refresh_tokens` table. `POST /auth/refresh` redeems it **without** an access token and issues a new
access token signed with the *current* secret. A client that still holds a valid refresh cookie
therefore gets a working session back immediately after the rotation.

If the rotation is meant to end every session, delete the refresh rows in the same maintenance
window:

```sql
DELETE FROM refresh_tokens;
```

(or delete only the rows of the users in question). Without that step a `SECRET_KEY` rotation logs
nobody out.

## API_KEY

`API_KEY` is the Perplexity key (`app/services/perplexity.py`).

1. Create the new key in the Perplexity dashboard (perplexity.ai).
2. Put it into `.env` as `API_KEY`.
3. Recreate the api container: `docker/build.sh api`.
4. **After** the new key works, revoke the old one.

**Invalidates:** in-flight provider calls. The response cache stays valid, because its key is the
prompt and the model, not the API key.

**Is this key even active?** The provider is resolved in this order: the `app_settings.chat_provider`
row in the database wins, then the `CHAT_PROVIDER` environment variable, then `perplexity`
(`app/services/providers/__init__.py`). While another provider is active, `API_KEY` has no runtime
effect.

## MISTRAL_API_KEY

`MISTRAL_API_KEY` is the Mistral key (`app/services/providers/mistral_client.py`) and is only needed
when Mistral is the active provider.

1. Create the new key in the Mistral console (console.mistral.ai).
2. Put it into `.env` as `MISTRAL_API_KEY`.
3. Recreate the api container: `docker/build.sh api`.
4. **After** the new key works, revoke the old one.

**Invalidates:** in-flight provider calls. The response cache stays valid (its key is the prompt and
the model, not the key). The same resolution order applies: `app_settings.chat_provider` →
`CHAT_PROVIDER` → `perplexity`; with `perplexity` active the Mistral key has no runtime effect.

## TURNSTILE_SECRET_KEY

`TURNSTILE_SECRET_KEY` is the server half of the Cloudflare Turnstile widget; it verifies the
challenge token on login and registration (`app/services/auth_security.py`).

1. Create a new widget — or new keys for the existing widget — in the Cloudflare dashboard
   (Turnstile).
2. Put the secret into `.env` as `TURNSTILE_SECRET_KEY` and the site key as
   `VITE_TURNSTILE_SITE_KEY`; the two halves belong together.
3. Recreate **both** containers: `docker/build.sh api frontend`.

**Why a recreation in both modes:** `.env` reaches the containers only through `env_file` and
`environment` at creation time (Review 2026-11-20, `docker/docker-compose.yml`). `docker restart`
reuses the old environment, so the new values would never arrive.

**Invalidates:** in-flight challenges and tokens; the old keys are rejected by Cloudflare.

## VITE_TURNSTILE_SITE_KEY

`VITE_TURNSTILE_SITE_KEY` is the public site key. It may ship to the browser by design, but it has to
match the widget whose secret is rotated, so both values change together.

The build mode decides what "the new key is live" means:

- `DEBUG=true`: the Vite dev server reads `import.meta.env.VITE_TURNSTILE_SITE_KEY` when it starts.
  Once the container has been recreated there is no build artifact to refresh — a process restart is
  enough to read the value.
- `DEBUG=false`: the frontend container runs `npm run build` at start and bakes the key into the
  bundle. The site key is a **build-time** substitution here, so the frontend must be rebuilt; the
  container start performs exactly that build.

`docker restart` alone is never a sufficient step in either mode: the container keeps its old
environment, so neither the dev server nor the build would see the new value.

## SMTP — not applicable

There is no mail feature in this codebase: no SMTP client, no mail-related login flow and no
variable for one. The evidence is a search over the tracked files (as of 2026-11-20):

```bash
git grep -il smtp -- app astronex docker docs scripts ':!docs/SECRETS.md'
```

Result: 0 lines. The exclusion `':!docs/SECRETS.md'` is mandatory — `docs/` is part of the search and
this runbook itself contains the word SMTP, so without the exclusion the documented command would
report this file after the commit and the "0 lines" claim would be false immediately
(Review 2026-11-20).

The same search without the tracked-file filter also walks `node_modules/` and does find matches
there (measured: 11 files, all under `node_modules`) — hence the tracked-only `git grep` form above.

A future feature that sends mail brings its own variables **and** its own rotation row here. No
`SMTP_*` variable exists today, and this runbook does not invent one.

## What is not a secret here

`TURNSTILE_VERIFY_URL`, `LETSENCRYPT_EMAIL`, `NGINX_SERVER_NAME`, the rate limits
(`LOGIN_RATE_LIMIT_*`, `REGISTER_RATE_LIMIT_*`, `REFRESH_RATE_LIMIT_*`, `FAILED_LOGIN_LOCKOUT_*`,
`AI_RATE_LIMIT_*`), the cache settings (`PERPLEXITY_CACHE_*`, `MISTRAL_CACHE_*`) and token lifetimes
such as `ACCESS_TOKEN_EXPIRE_MINUTES` are configuration, not secrets. They have no rotation row:
changing them is a configuration change, nothing is invalidated.

`VITE_TURNSTILE_SITE_KEY` is listed above because it belongs to the rotated widget, although the site
key itself is public and ships to the browser by design.
