<!-- generated-by: gsd-doc-writer -->
# Astronex — HTTP API

The Astronex API (product name "Astro-Magister") is a FastAPI application exposing
ephemeris and astrological calculations (planets, houses, transits, synastry, solar returns,
age points, lunar nodes, fixed stars) plus an authenticated interpretation layer that streams
AI-generated German-language text over Server-Sent Events (SSE).

## Base URLs

The API is served by uvicorn on port `8000` inside the API container. Clients reach it
through one of the following entry points:

| Environment | Base URL | Notes |
|-------------|----------|-------|
| Local development (direct) | `http://localhost:8000` | uvicorn `--host 0.0.0.0 --port 8000` |
| Via nginx (production) | `https://www.astro-magister.de/api/` | nginx rewrites `/api/<path>` → `/<path>` and proxies to the API container |
| Via nginx (local HTTPS) | `https://<SERVER_NAME>/api/` | see `docker/nginx.https.conf.template` |
| Vite dev proxy | `http://localhost:5173/api/<path>` | `app/frontend/vite.config.js` proxies the single prefix `/api/` to `http://localhost:8000` and strips it (`rewrite: path => path.replace(/^\/api/, '')`), byte-identical to nginx `location /api/`. There are no per-feature prefixes; the same proxy object is used by `server` and `preview` |

The nginx `/api/` location strips the `/api` prefix (`rewrite ^/api/(.*)$ /$1 break;`),
so a request to `https://www.astro-magister.de/api/planets` reaches the API as `POST /planets`.
Only `/sitemap.xml` is *not* stripped by nginx: it is proxied explicitly to
`http://api:8000/sitemap.xml`. Theme requests use `/api/theme/...` and are rewritten like every
other API path; there is no separate `/theme/` location any more.

<!-- VERIFY: Production host `https://www.astro-magister.de` is configured in docker/nginx.*.conf.template (server_name `__SERVER_NAME__`, redirect to `https://www.astro-magister.de`), but the live DNS/TLS state cannot be verified from the repository. -->

The OpenAPI docs are disabled in production configuration (`docs_url=None`, `redoc_url=None`,
`openapi_url=None` in `app/main.py`).

## Authentication

Authentication uses **JWT access tokens** issued by the application itself (the `fastapi-users`
library is used under the hood for user storage, but the endpoints are custom). Two transport
mechanisms are supported and interchangeable:

1. **`Authorization: Bearer <access_token>` header** — used by API clients.
2. **HTTP-only cookies** — the login/refresh endpoints set `astronex_access_token` and
   `astronex_refresh_token` cookies; the frontend uses them with `credentials: 'include'`.

Cookie names are configurable via `AUTH_ACCESS_COOKIE_NAME` / `AUTH_REFRESH_COOKIE_NAME`
(defaults `astronex_access_token` / `astronex_refresh_token`). Cookies are `HttpOnly`,
`SameSite=lax` (configurable via `AUTH_COOKIE_SAMESITE`), and `Secure` when `AUTH_COOKIE_SECURE`
is enabled (default on).

### Token details

- **Access token**: JWT signed with `SECRET_KEY` (HS256), audience `astronex:auth`
  (`TOKEN_AUDIENCE` in `app/services/auth.py`), expires after `ACCESS_TOKEN_EXPIRE_MINUTES`
  (default **60 minutes**). Contains a `jti` claim used for blacklisting on logout.
- **Refresh token**: opaque token (not a JWT), created by `create_refresh_token(user_id)`,
  valid for **7 days** — that lifetime is the hardcoded default `days=7` in
  `app/services/auth.py` and reads no environment variable. Rotation: each `/auth/refresh`
  call revokes the old refresh token and issues a new one. `REFRESH_TOKEN_EXPIRE_SECONDS`
  sets only the refresh cookie `max_age` in `app/routers/auth.py`, not the token validity.
- Access tokens presented via header *or* cookie are validated; blacklisted `jti` values
  (after logout) are rejected.

### Auth flow

1. `POST /auth/register` — create an account (`username`, `password`, optional `captcha_token`).
   Cloudflare Turnstile verification runs unless `BYPASS_CAPTCHA=true` — the only switch
   that skips verification (see `verify_turnstile_token()` in
   `app/services/auth_security.py`). A placeholder `TURNSTILE_SECRET_KEY` is *not* a
   bypass: with `DEBUG=true` it only suppresses the startup error in `app/main.py`,
   while `/auth/register` and `/auth/login` still call `verify_turnstile_token` and fail
   with `400` "Captcha-Prüfung fehlgeschlagen".
2. `POST /auth/login` — returns `{access_token, token_type, refresh_token}` and sets auth cookies.
3. Call protected endpoints with `Authorization: Bearer <access_token>` (or cookies).
4. `POST /auth/refresh` — exchange a valid refresh token (body or cookie) for a new token pair.
5. `POST /auth/logout` — blacklists the access token `jti`, revokes all refresh tokens,
   clears cookies. `POST /auth/logout-refresh` only revokes the refresh token and clears cookies
   (no access-token blacklist).

### Authorization levels

- **Authenticated** — any logged-in user. Most calculation and interpretation endpoints.
- **Power user** (`is_poweruser`) — required for `POST /auth/persons` and AI follow-up
  questions (`POST /interpretations/{id}/messages`); raised AI daily limit.
- **Admin** (`isadmin`) — required for user management, audit logs, cache, theme, and wiki
  write endpoints. Admin endpoints are protected by the `require_admin_user` dependency
  (returns `403 Forbidden` for non-admins, `401` when unauthenticated).

## Endpoints overview

### System

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | API name/version info | No |
| GET | `/health` | Health check; reports `status: ok` or `degraded` plus font accessibility | No |
| GET | `/sitemap.xml` | XML sitemap for SEO (wiki entries + static pages) | No |

### Authentication & accounts (`app/routers/auth.py`, `app/routers/persons.py`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/auth/register` | Register a new user (Turnstile + rate limited) | No |
| POST | `/auth/login` | Login, returns JWT pair and sets cookies | No |
| POST | `/auth/refresh` | Refresh access token (rotates refresh token) | No |
| POST | `/auth/logout-refresh` | Revoke refresh token + clear cookies | No |
| POST | `/auth/logout` | Blacklist access token, revoke refresh tokens, clear cookies | Bearer/cookie |
| GET | `/auth/roles` | List available roles | Bearer |
| POST | `/auth/change-password` | Change own password | Bearer |
| GET | `/auth/profile` | Get own profile | Bearer |
| PUT | `/auth/profile` | Update own profile | Bearer |
| GET | `/auth/persons` | List saved persons | Bearer |
| POST | `/auth/persons` | Create a person (power user only) | Bearer (power) |
| GET | `/auth/persons/{person_id}` | Get one saved person | Bearer |
| PUT | `/auth/persons/{person_id}` | Update a person | Bearer |
| DELETE | `/auth/persons/{person_id}` | Delete a person | Bearer |
| GET | `/auth/users` | List users (`query`, `limit`, `offset`) | Admin |
| GET | `/auth/users/{user_id}` | Get user by ID | Admin |
| PUT | `/auth/users/{user_id}` | Update user (username, role, flags) | Admin |
| POST | `/auth/users/{user_id}/password` | Set user password | Admin |
| DELETE | `/auth/users/{user_id}` | Delete user | Admin |
| DELETE | `/auth/users/cleanup-empty-profile` | Delete users with empty profiles older than `older_than_months` (default 1) | Admin |
| GET | `/auth/audit-log` | Auth audit log (`query`, `event_type`, `success`, `limit`, `offset`) | Admin |
| DELETE | `/auth/audit-log` | Delete audit log entries older than `older_than_months` (default 3) | Admin |
| GET | `/auth/admin/provider-config` | Get active chat provider + available providers | Admin |
| PUT | `/auth/admin/provider-config` | Set chat provider (validated against known providers) | Admin |
| GET | `/auth/cache/redis` | Cache overview (backends, TTL, entries) | Admin |
| DELETE | `/auth/cache/redis` | Delete one cache entry (`?key=`) or clear all caches | Admin |

### Ephemeris / calculations (require authentication unless noted)

All calculation routers declare `dependencies=[Depends(require_authenticated_user)]` at the
router level, so **every endpoint below requires a valid access token** unless stated otherwise.
Endpoints accept a `DateTimeRequest` JSON body (see [Request/response formats](#requestresponse-formats)).

#### Positions (`app/routers/positions.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/calc?planet_id=0..12` | Single-planet position (Sun..Pluto, Node=10, Lilith=11, Chiron=12) + AI summary |
| POST | `/planets` | All 13 planet positions + AI summary |
| POST | `/planets/stream` | Same calculation, AI summary streamed via SSE |
| GET | `/getPosition?country=&city=&district=` | Geocode a city from the location DB → `PositionResponse` |

#### Houses (`app/routers/houses.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/houses` | 12 house cusps (Koch) + AI summary |
| POST | `/houses/stream` | Houses + streamed AI summary (SSE) |
| POST | `/houses/graphic?width=&height=` | House chart rendered as PNG |

#### Horoscope (`app/routers/horoscope.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/horoscope` | Full natal chart: planets, houses, aspects + AI interpretation |
| POST | `/horoscope/stream` | Full chart + streamed AI interpretation (SSE) |
| POST | `/horoscope/graphic?width=&height=` | Natal chart PNG |

#### Solar return (`app/routers/solar.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/solar-return` | Compute exact solar return instant for `target_year` + chart data + AI summary |
| POST | `/solar-return/stream` | Solar return + streamed AI summary (SSE) |
| POST | `/solar-return/graphic?width=&height=` | Solar return chart PNG |

#### Transits (`app/routers/transits.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/transits` | Transit aspects between birth chart and transit date, `groupby` (aspect/planet), optional `filterplanets` |
| POST | `/transits/stream` | Transits + streamed AI summary (SSE) |
| POST | `/transits/graphic?width=&height=` | Transit chart PNG (natal + transit overlay) |

#### Synastry (`app/routers/synastry.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/synastry/stream` | Two-person comparison (`comparison_mode`: `hh` house-house, `rr` radix-radix); birth data resolved from `user_persons` IDs; SSE stream |
| POST | `/synastry/graphic?width=&height=` | Synastry comparison chart PNG |

#### Lunar nodes (`app/routers/nodes.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/nodes/stream` | Rahu/Ketu positions + mirrored planet chart + streamed AI interpretation (SSE) |
| POST | `/nodes/graphic?width=&height=` | Node chart PNG (`draw_ur_nodal`) |

#### Age points (`app/routers/age_points.py`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/age-points` | Age points for `kind` (`radix`/`local`/`soul`/`nodal`), optional `target_year/month/day` filter + AI summary | Bearer |
| POST | `/age-points/stream` | Age points + streamed AI summary (SSE) | Bearer |
| POST | `/age-points/full` | Full ~72-year age-point chain (no AI summary) | Bearer |
| POST | `/age-points/ap-marker` | Marker position (degrees + x/y percentages) for a transit date | Bearer |
| GET | `/age-points/ap-graphic` | Static `ap.png` legend image | No |

#### Chart data (`app/routers/chart_data.py`)

Data-only entry for the chart boxes: one generic path dispatches over an explicit mapping table
onto the existing calculation of each chart type and projects the result onto the shared DTO
`{ chart_type, groups[] }` (`groups[]` entries carry `label`, `planets`, `aspects`, `houses`).
No AI call and no second calculation path.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chart-data/{chart_type}` | Chart data as `{ chart_type, groups[] }`. `chart_type` is one of `horoscope`, `nodes`, `synastry`, `transits`, `solar_return`, `age_points`; the body is the request model of that chart type (`DateTimeRequest` for horoscope/nodes, `TransitRequest` for transits/age points, `SolarReturnRequest`, `SynastryRequest`). An unknown `chart_type` is rejected by the path `Literal` with 422 |

#### Date/time helpers (`app/routers/date_time.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/julday` | Calendar date → Julian Day |
| POST | `/revjul` | Julian Day → calendar date (Gregorian flag) |
| POST | `/sidtime` | Sidereal time for a datetime |

#### Fixed stars (`app/routers/fixed_stars.py`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/fixstar?star_name=Sirius` | Fixed star position, latitude, speeds at a given date |

#### Ascendant (public, `app/routers/ascendant.py`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/ascendant?birth_year=&birth_month=&birth_day=&birth_hour=&birth_minute=&birth_second=&birth_timezone=&birth_latitude=&birth_longitude=` | Ascendant sign index + name | No |

### Locations (`app/routers/locations.py`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/locations/countries?lang=de|en|es|ca` | List countries with localized names (falls back to `Accept-Language` header, default `de`) |
| GET | `/locations/regions?country=DE` | List regions/admin districts for a country |
| GET | `/locations/cities?country=DE&region=` | List cities for a country, optionally filtered by region |

### Timezone (`app/routers/timezone.py`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tzfromcoords?lat=&lon=&timestamp=` | IANA timezone name + UTC offset seconds for coordinates |

### Interpretations (`app/routers/interpretations.py`, prefix `/interpretations`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/interpretations` | Create an interpretation session (returns `{id}`) |
| GET | `/interpretations` | List own sessions (`context_type`, `user_persons_id`, `own_profile_only`, `limit`, `offset`) |
| GET | `/interpretations/{interpretation_id}` | Full session incl. message history |
| DELETE | `/interpretations/{interpretation_id}` | Delete a session (204) |
| POST | `/interpretations/{interpretation_id}/messages` | Ask a follow-up question; answer streamed via SSE (power users only) |

### Wiki (`app/routers/wiki.py` — read endpoints public, write endpoints admin)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/wiki/sections` | List sections (`active_only`, `wiki_active_only`) | No |
| POST | `/wiki/sections` | Create section | Admin |
| GET | `/wiki/sections/{section_id}` | Get section | No |
| PUT | `/wiki/sections/{section_id}` | Update section | Admin |
| DELETE | `/wiki/sections/{section_id}` | Delete section | Admin |
| GET | `/wiki/categories` | List categories (`section_id`, `parent_category_id`, `active_only`) | No |
| POST | `/wiki/categories` | Create category | Admin |
| GET | `/wiki/categories/{category_id}` | Get category | No |
| PUT | `/wiki/categories/{category_id}` | Update category | Admin |
| DELETE | `/wiki/categories/{category_id}` | Delete category | Admin |
| GET | `/wiki/entries` | List entries (`category_id`, `section_id`, `q`, `active_only`, `wiki_active_only`, `limit`, `offset`) | No |
| POST | `/wiki/entries` | Create entry | Admin |
| GET | `/wiki/entries/{entry_id}` | Get entry | No |
| PUT | `/wiki/entries/{entry_id}` | Update entry | Admin |
| DELETE | `/wiki/entries/{entry_id}` | Delete entry | Admin |
| POST | `/wiki/entries/{entry_id}/generate-text` | Generate/update entry content via AI | Admin |
| POST | `/wiki/entries/refresh-slugs` | Backfill missing entry slugs | Admin |
| GET | `/wiki/{category_slug}/{entry_slug}` | Get entry by public URL slugs | No |
| GET | `/wiki/relations` | List entry-to-entry relations | No |
| POST | `/wiki/relations` | Create relation | Admin |
| GET | `/wiki/relations/{relation_id}` | Get relation | No |
| PUT | `/wiki/relations/{relation_id}` | Update relation | Admin |
| DELETE | `/wiki/relations/{relation_id}` | Delete relation | Admin |
| GET | `/wiki/pages` | List pages | No |
| POST | `/wiki/pages` | Create page | Admin |
| GET | `/wiki/page-entries?page_name=` | Entries linked to a page | No |
| GET | `/wiki/pages/{page_id}` | Get page | No |
| PUT | `/wiki/pages/{page_id}` | Update page | Admin |
| DELETE | `/wiki/pages/{page_id}` | Delete page | Admin |
| GET | `/wiki/page-content` | List page content (`page_id`, `entry_id`) | No |
| POST | `/wiki/page-content` | Create page content | Admin |
| GET | `/wiki/page-content/{page_content_id}` | Get page content | No |
| PUT | `/wiki/page-content/{page_content_id}` | Update page content | Admin |
| DELETE | `/wiki/page-content/{page_content_id}` | Delete page content | Admin |
| GET | `/wiki/home-cards` | Homepage cards: marked ∧ public ∧ active ∧ static page exists (wiki-active section, no legal-page title), curated order, `limit` 1–12, card fields only incl. `entry_published` and `cover_url` | No |
| GET | `/wiki/home-selection` | Complete homepage curation list (every mark, no `limit`, incl. `home_order`, `ispublic`, `entry_active`, `cover_url`) | Admin |
| GET | `/wiki/build-entries` | Complete source set of the static wiki build (slug, content, section), no `limit` | No |
| PUT | `/wiki/home-order` | Homepage card order as a dense 1..n sequence (`{order: [entry_id, …]}`, max. 12); the only writer of `home_order` — `POST`/`PUT /wiki/entries` reject a non-null `home_order` with 422, and unmarking (`home_featured: false`) clears it | Admin |
| GET | `/wiki/content-stamp` | Change stamp for the rebuild hint (`{stamp: ISO-8601 \| null}`) | Admin |
| GET | `/wiki/cover-options` | Glyph whitelist (35: 12 Tierkreiszeichen, 11 Planeten, 12 gezeichnete Häuser) and colour presets for the image picker, incl. the default pair and the neutral tile pair (`tile_background`, `tile_glyph_color`) | Admin |
| GET | `/wiki/cover-preview` | Rendered WebP for `glyph`/`bg`/`fg` (`variant=full\|tile`), writes nothing | Admin |
| GET | `/wiki/cover-suggestion` | Glyph suggestion from title/category (`{glyph, name}`) | Admin |
| POST | `/wiki/cover-bulk-apply` | Apply the suggestion to up to 100 entries of a category without an image (`{checked, updated, skipped, remaining, stamp}`) | Admin |
| POST | `/wiki/build` | Trigger the external Astro wiki build (`http://wiki-builder:9000/build`) | Admin |

The build and curation rows all hang on the same server-side definition of "public"
(`public_entry_criteria()` in `app/services/wiki.py`). `GET /wiki/build-entries` is **public on
purpose**: the `wiki-builder` container fetches it without credentials, and it returns exactly what
the public wiki shows anyway — legal-page titles (`Impressum`, `Datenschutz`, `Kontakt`) and all
internal columns are excluded server-side. `GET /wiki/home-selection`, `PUT /wiki/home-order` and
`GET /wiki/content-stamp` are admin-only because they also carry private and inactive marks.

**Visibility of entries for anonymous callers (D-14).** Every public entry read — `GET /wiki/entries`,
`GET /wiki/entries/{entry_id}`, `GET /wiki/by-slug/{slug}`, `GET /wiki/{category_slug}/{entry_slug}`
and `GET /wiki/page-entries` — applies `public_entry_criteria()` (`ispublic` ∧ `entry_active`) when
the request carries no session: private or inactive entries are omitted from lists and answer
`404` on single reads. **Any** valid session (not only admins) keeps the unfiltered view, so
`ispublic = false` is an anonymous-visibility boundary, not a confidentiality boundary between
registered users.

**Redis outage (fail-closed).** The `Auth: No` column above is not weakened by an outage: a
session is still not required. Four of the five reads are listed as their own table row —
`GET /wiki/entries`, `GET /wiki/entries/{entry_id}`, `GET /wiki/{category_slug}/{entry_slug}` and
`GET /wiki/page-entries`; the fifth, `GET /wiki/by-slug/{slug}`, is named in the D-14 paragraph
above and has no row of its own. If a request to one of these optional-auth reads nevertheless
carries a session (access cookie or bearer token), the JWT blacklist is checked; while Redis is
unreachable it answers `503` with `Retry-After` and the fixed message
`Authentifizierung ist vorübergehend nicht verfügbar` instead of the anonymous view. An anonymous
request to the same URL still answers `200`. `/chart-data` is not an optional-auth path (its
router hangs on `require_authenticated_user`), so its `503` is the ordinary fail-closed rule.
Operator view: `docs/CONFIGURATION.md`, section
`Operator notes: Redis failure behaviour (fail-closed auth)`.

#### Artikelbilder (Cover)

A cover is a file under `/static/wiki-covers/<hash>.webp`, rendered by the API but served by nginx
with `Cache-Control: public, max-age=31536000, immutable`; that path lies **outside** `/api`, so the
edge prefix never applies to it. The file name is a hash over glyph, both colour presets, the layout
and the renderer version, derived on every read and delivered as the computed `cover_url` field — no
`cover_url` column and no stored hash exist, and a visible change (or a `COVER_RENDER_VERSION` bump)
simply produces a new URL while old files stay valid.

The rendered master is **400x210 px**; the CMS preview tile (`variant=tile`) is half of that at
**200x105 px**. Both keep the same 40:21 composition — one geometry, two output sizes — so the CSS
`aspect-ratio` of every cover surface is unchanged.

A missing file is rendered on the first request (render-on-miss,
`app/routers/covers.py`); a hash outside the whitelist (35 glyphs × 50 allowed colour pairs) answers
404 without rendering, without a database read and without creating a file. The preview endpoint is
the exception: `GET /wiki/cover-preview` composes the same image in memory, writes nothing, and
answers with `Cache-Control: private, max-age=60`.

### Theme & glyphs

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/auth/admin/theme-settings` | Get zodiac theme (12-sign palette), archive, enabled flag | Admin |
| PUT | `/auth/admin/theme-settings` | Save theme (validates all 12 signs, archives previous) | Admin |
| POST | `/auth/admin/theme-settings/restore` | Restore previous theme from archive | Admin |
| GET | `/api/theme/settings` | Public theme palette (used by the public site) | No |
| GET | `/api/theme/glyph/sign/{index}?opacity=&padding=` | Zodiac sign glyph PNG (index 0–11), cached | No |
| GET | `/api/theme/glyph/planet/{index}` | Not implemented (always 404) | No |
| GET | `/api/theme/glyph/background` | Not implemented (always 404) | No |

Public theme paths are reached through the `/api/` edge prefix; the backend route itself is still
declared as `/theme/...` (the `/api` prefix is only stripped at the edge).

## Request/response formats

### `DateTimeRequest` (body of most calculation endpoints)

```json
{
  "person_id": null,
  "interpretation_id": null,
  "additional_question": "Optional follow-up for the AI interpretation",
  "year": 2000,
  "month": 1,
  "day": 1,
  "hour": 12,
  "minute": 0,
  "second": 0,
  "timezone": "Europe/Berlin",
  "latitude": 48.8566,
  "longitude": 2.3522
}
```

- `year`, `month`, `day` are required; `hour` defaults to `12`, `minute`/`second` to `0`.
- `timezone` is an IANA name; when present, the given local time is converted to UTC before
  calculation, otherwise the time is treated as UT.
- `person_id` selects a saved person whose role is used for the AI interpretation tier;
  `interpretation_id` appends the result to an existing interpretation session.
- `additional_question` (max 255 chars) is appended to the AI prompt.

### `PlanetPosition` (element of `planets` arrays)

```json
{
  "planet_id": 0,
  "planet_name": "Sun",
  "longitude": 283.5432,
  "house_index": 9,
  "house": 10,
  "sign_index": 9,
  "sign": "Capricorn",
  "sign_degree": "13° 32′",
  "house_degree": "01° 17′"
}
```

Planet IDs: `0` Sun, `1` Moon, `2` Mercury, `3` Venus, `4` Mars, `5` Jupiter, `6` Saturn,
`7` Uranus, `8` Neptune, `9` Pluto, `10` Node (mean lunar node), `11` Lilith, `12` Chiron.

### `POST /planets` response (`CalcResponse`)

```json
{
  "year": 2000,
  "month": 1,
  "day": 1,
  "hour": 11.5,
  "julian_day": 2451545.0,
  "planets": [ { "planet_id": 0, "planet_name": "Sun", "...": "..." } ],
  "status": 0,
  "summary": "Huber Astrologische Psychologie. ..."
}
```

### `POST /houses` response (`HousesResponse`)

```json
{
  "year": 2000,
  "month": 1,
  "day": 1,
  "hour": 11.5,
  "julian_day": 2451545.0,
  "latitude": 48.8566,
  "longitude": 2.3522,
  "houses": [
    { "house": 1, "longitude": 312.5, "sign_index": 10, "sign": "Aquarius", "sign_degree": "12° 30′" }
  ],
  "summary": "AC - Aquarius (12°30′); ..."
}
```

### `POST /transits` request/response

Request body (`TransitRequest`) — note the nested date/location objects:

```json
{
  "person_id": null,
  "interpretation_id": null,
  "additional_question": null,
  "birthday": { "year": 1990, "month": 6, "day": 15, "hour": 10, "minute": 30, "second": 0, "timezone": "Europe/Berlin" },
  "birth_location": { "latitude": 48.8566, "longitude": 2.3522 },
  "transitdate": { "year": 2026, "month": 8, "day": 15, "hour": 12, "minute": 0, "second": 0, "timezone": "Europe/Berlin" },
  "transit_location": { "latitude": 48.8566, "longitude": 2.3522 },
  "groupby": "aspect",
  "filterplanets": null
}
```

Response (`TransitResponse`):

```json
{
  "aspects": [
    {
      "transit_index": 0, "transit_name": "Sun",
      "transit_sign_index": 4, "transit_sign": "Leo", "transit_house_index": 1, "transit_house": 1,
      "natal_index": 2, "natal_name": "Mercury",
      "natal_sign_index": 6, "natal_sign": "Libra", "natal_house_index": 3, "natal_house": 4,
      "aspect": "trig", "separation": 120.1234, "orb": 0.5, "f1": 0.2, "f2": 0.4, "gw": false, "within_orb": true
    }
  ],
  "grouped_aspects": { "trig": [ "..." ] },
  "summary": "Huber Astrologische Psychologie. ..."
}
```

### `POST /solar-return` response (`SolarReturnResponse`)

```json
{
  "target_year": 2026,
  "return_year": 2026,
  "return_month": 6,
  "return_day": 20,
  "return_hour": 14.25,
  "julian_day": 2461272.0,
  "natal_sun_longitude": 84.5,
  "solar_return_longitude": 84.500001,
  "longitude_difference": 0.000001,
  "iterations": 4,
  "planets": [ "PlanetPosition entries" ],
  "houses": [ 312.5, 342.1, "..." ],
  "aspects": [ "Aspect entries" ],
  "summary": "Huber Astrologische Psychologie. ..."
}
```

### `POST /age-points` request/response

Request (`AgePointsRequest`): `year/month/day/hour/minute/second`, `latitude`, `longitude`,
`timezone`, `kind` (`radix|local|soul|nodal`, default `radix`), optional `target_year`,
`target_month`, `target_day`.

Response (`AgePointsResponse`):

```json
{
  "kind": "radix",
  "target_year": 2035,
  "age_points": [
    { "day": "12", "mon": "6", "year": 2035, "lab": "Persoenlichkeitsintegration / Haus: ...", "cl": "..." }
  ],
  "summary": "Huber Astrologische Psychologie. ..."
}
```

### `POST /synastry/stream` request

```json
{
  "person_a_id": 1,
  "person_b_id": null,
  "comparison_mode": "hh",
  "interpretation_id": null,
  "additional_question": null,
  "person_a_name": "Anna",
  "person_b_name": "Ben"
}
```

`person_a_id`/`person_b_id` reference rows in `user_persons`; `null` resolves to the logged-in
user's own profile. Birth data is fetched server-side. Response is an SSE stream.

### `POST /auth/login` response

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "refresh_token": "5f8a..."
}
```

### Wiki response example

`GET /wiki/entries/{entry_id}` → `EntryOut`:

```json
{
  "entry_id": 1,
  "entry_name": "Sonne",
  "slug": "sonne-1",
  "entry_short": "...",
  "entry_content": "...",
  "generate_text": null,
  "ispublic": true,
  "entry_number": 0,
  "category_id": 2,
  "entry_generate": null,
  "entry_active": true,
  "entry_published": "2026-01-01",
  "created": "2026-01-01T10:00:00Z",
  "updated": "2026-01-01T10:00:00Z"
}
```

## Server-Sent Events (SSE)

All streaming endpoints return `Content-Type: text/event-stream` with
`Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no` headers.
The body is a sequence of named events, each formatted as:

```
event: <name>
data: <json>

```

Streaming endpoints:

- `POST /planets/stream`
- `POST /houses/stream`
- `POST /horoscope/stream`
- `POST /solar-return/stream`
- `POST /transits/stream`
- `POST /nodes/stream`
- `POST /synastry/stream`
- `POST /age-points/stream`
- `POST /interpretations/{interpretation_id}/messages`

### Event sequence

1. **`meta`** — the full calculation payload (planets, houses, aspects, etc.) with the AI
   prompt field removed. For synastry: `comparison_mode`, `planet_entries_a`,
   `planet_entries_b`, `cross_aspects`.
2. **`summary_delta`** — repeated; `{"content": "<chunk>"}`. Concatenate chunks to rebuild
   the interpretation.
3. **`done`** — `{"summary": "<full text>"}`. Emitted even when the AI answer was served from
   cache (then no `summary_delta` events occur). If no AI prompt could be built, an `error`
   event carrying `MISSING_CHART_DATA_DETAIL` is sent immediately after `meta` instead — no
   `done`, and nothing is saved (`missing_chart_data_event()` in `app/routers/_sse_utils.py`).
4. **`saved`** — `{"interpretation_id": <int>}`. Emitted for authenticated users after the
   result is persisted to the interpretation store. Some endpoints emit this only when a
   summary actually exists.
5. **`error`** — `{"detail": "<message>"}` on streaming failure.

When `DISABLE_AI=true`, the interpretations follow-up endpoint emits a placeholder
`summary_delta` + `done` instead of calling the provider.

## Error codes

The API uses standard HTTP status codes. Errors are returned as
`{"detail": "<message>"}` (FastAPI default). Common cases:

| Status | Meaning |
|--------|---------|
| `400` | Validation or calculation error (e.g. invalid planet data, house computation fails above the Arctic Circle, weak password, captcha failed, `target_year` precedes `birth_year`) |
| `401` | Missing/invalid/blacklisted access token, invalid credentials, invalid/expired refresh token (`WWW-Authenticate: Bearer` header set) |
| `403` | Authenticated but not allowed: non-admin on admin endpoints, non-power-user on `POST /auth/persons` or follow-up questions, non-power-user on `/horoscope` AI interpretation |
| `404` | Resource not found (user, person, location, wiki entry/section/category, interpretation, glyph) |
| `422` | Pydantic request validation failure (missing field, out-of-range value) |
| `423` | Account temporarily locked after too many failed logins (with `Retry-After` header) |
| `429` | Rate limit exceeded — login/register/refresh or AI daily quota (with `Retry-After` header) |
| `500` | Internal server error / unexpected calculation failure |
| `503` | Wiki build server unreachable (`/wiki/build`); or the auth store unreachable while `REDIS_URL` is set — every auth path and blacklist read answers `503` with `Retry-After` and `Authentifizierung ist vorübergehend nicht verfügbar` (fail-closed, `app/services/auth_store.py`) |

Note: several detail strings are German (auth rate limits, captcha, power-user messages,
theme messages, age-point errors). `POST /age-points` returns `502` when the AI provider
call fails.

## Rate limits

### Authentication rate limits (`app/services/auth_security.py`)

Values are configurable via environment variables; defaults shown. Limits are keyed per
client IP (trusted proxies via `TRUSTED_PROXIES`, default the nginx container IP
`172.28.0.15`).

| Scope | Default limit | Window | Exceeded → |
|-------|---------------|--------|-----------|
| Login | `LOGIN_RATE_LIMIT_ATTEMPTS` = 5 | `LOGIN_RATE_LIMIT_WINDOW_SECONDS` = 900 s (15 min) | `429` + `Retry-After` |
| Register | `REGISTER_RATE_LIMIT_ATTEMPTS` = 5 | `REGISTER_RATE_LIMIT_WINDOW_SECONDS` = 3600 s (1 h) | `429` + `Retry-After` |
| Refresh | `REFRESH_RATE_LIMIT_ATTEMPTS` = 30 | `REFRESH_RATE_LIMIT_WINDOW_SECONDS` = 300 s (5 min) | `429` + `Retry-After` |
| Failed logins | `FAILED_LOGIN_LOCKOUT_THRESHOLD` = 5 | `FAILED_LOGIN_LOCKOUT_SECONDS` = 3600 s (1 h) | `423` + `Retry-After` |

### AI interpretation limits

AI interpretation endpoints (`/horoscope`, `/planets`, `/houses`, `/transits`, `/synastry`,
`/nodes`, `/age-points`, `/solar-return`, interpretation follow-ups) check a per-user daily
quota (`check_ai_rate_limit`, scope `ai:<context_type>`), reset at UTC midnight:

- Default: `AI_DAILY_LIMIT_DEFAULT` = **5 requests/day**
- Power users: `AI_DAILY_LIMIT_POWERUSER` = **50 requests/day**
- Admins: unlimited
- Exceeding the quota returns `429` with a German `detail` (see
  `build_ai_rate_limit_error_detail`) and `Retry-After`.

Responses are cached per prompt+system-prompt combination (local in-memory or Redis via
`REDIS_URL` / `PERPLEXITY_CACHE_BACKEND`); cached answers do not consume the daily quota.

### Nginx

The `/api/` location additionally applies `limit_req zone=api burst=50 nodelay;`
(`docker/nginx.http.conf.template` and `docker/nginx.https.conf.template`). Since Phase 37 the
whole SPA traffic traverses this location, so the whole page load counts against the IP-level
burst limiter on top of the application limits. The burst is derived from the measured 1-second
peak of API requests per client (24 req/s → 2× = 48, rounded to 50, minimum 40, cap 50).

<!-- VERIFY: The effective rate limit is only visible in the rendered /etc/nginx/conf.d/default.conf at runtime: nginx applies `limit_req zone=api` with burst 50 from this template, while the zone rate (10 r/s) is declared in docker/nginx.conf; neither is covered by the API test suite. -->
