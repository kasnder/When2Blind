# When2Blind

Privacy-preserving meeting scheduling with end-to-end encrypted participant submissions. Like when2meet, but the server can't see your availability.

## Overview

This project lets an organizer create a room and share a participant link. Participants fill an availability grid manually or from Google Calendar. The server can read room metadata, but participant names and availability stay encrypted, and decryption, overlap calculation, and Google Calendar fetching all happen client-side in the browser.

Current design:

- organizer and participant access both start from secret capability links
- capability links are exchanged once for short-lived bearer sessions
- the browser immediately scrubs capability material from the visible URL
- participant submissions use a versioned `XChaCha20-Poly1305` envelope
- overlap is computed client-side after decrypting submissions locally
- Google Calendar imports use an in-memory access token that is revoked immediately after import

## Security Model

Protected data:

- participant display names
- participant availability by slot
- submission edit capability

Server-readable data:

- room id
- room title
- room timezone
- room start and end dates
- room expiry

Access model:

- organizer links grant room administration capability
- participant links grant room read/write capability plus the fragment decryption key
- bootstrap capabilities are not meant to be reused on API requests
- all post-bootstrap API requests use `Authorization: Bearer <session>`

## Crypto

Current crypto implementation:

- [`src/lib/crypto.ts`](/Users/konrad/Documents/privacy-meetings/src/lib/crypto.ts) encrypts submissions with `XChaCha20-Poly1305`
- ciphertext is wrapped in a versioned envelope:

```json
{
  "version": 2,
  "algorithm": "xchacha20poly1305-ietf",
  "nonce": "...",
  "ciphertext": "..."
}
```

- room context is authenticated as associated data, which prevents replaying a submission into a different room
- participant room keys come from the participant URL fragment and are never sent to the backend

Server-side secret handling:

- bootstrap capabilities, session secrets, and submission edit tokens are stored as salted `scrypt` hashes in [`server/security.ts`](/Users/konrad/Documents/privacy-meetings/server/security.ts)
- session secrets are verified server-side and never stored in plaintext

## Request Flow

### Room creation

1. The organizer creates a room.
2. The API creates:
   - an organizer capability
   - a participant capability
   - a participant decryption key
3. The organizer receives:
   - an organizer link with `?cap=...`
   - a participant link with `?cap=...#key=...`

### Bootstrap exchange

1. The browser reads `cap` from the URL query.
2. The browser reads `key` from the participant URL fragment when applicable.
3. The browser calls `POST /api/session/exchange`.
4. The API returns a short-lived scoped session token.
5. The browser immediately removes the capability from the visible URL with `history.replaceState`.

### Participant submission

1. The browser encrypts the submission locally.
2. The browser sends the envelope to the API with a participant bearer session.
3. The API stores only the encrypted envelope.
4. The API returns a rotated edit token.

### Google Calendar import

1. The participant connects Google Calendar from the browser.
2. The browser fetches busy events directly from Google APIs.
3. The browser converts those events into the room availability grid locally.
4. The Google access token is kept in memory only and revoked immediately after import.

### Organizer deletion

1. The organizer page exchanges its capability for an organizer session.
2. The browser calls `DELETE /api/rooms/:roomId` with bearer auth.
3. The API deletes the room and cascading submissions.

## Storage Behavior

Browser storage:

- organizer links are stored in `localStorage` only when the user explicitly opts in
- active organizer and participant sessions are stored in `sessionStorage`
- participant submission metadata such as `submissionId` and `editToken` are stored in `sessionStorage`
- participant decryption keys are kept in memory after bootstrap and are not persisted by default
- Google OAuth access tokens are kept in memory only and are never persisted

Database storage:

- `rooms` stores room metadata plus hashed organizer and participant bootstrap capabilities
- `submissions` stores encrypted envelopes and hashed edit tokens
- `auth_sessions` stores hashed session secrets, scope, expiry, and last-used metadata

Cleanup behavior:

- expired rooms are opportunistically deleted by the API
- expired auth sessions are opportunistically deleted by the API

## API

### `POST /api/rooms`

Creates a room.

Request body:

```json
{
  "title": "Team sync",
  "timezone": "Europe/Amsterdam",
  "startDate": "2026-03-24",
  "endDate": "2026-03-30"
}
```

Response:

- room metadata
- `retentionDays`
- `organizerLink`
- `participantLink`

### `POST /api/session/exchange`

Exchanges a bootstrap capability for a short-lived session.

Request body:

```json
{
  "roomId": "room_123",
  "capabilityType": "participant",
  "capability": "..."
}
```

Response:

```json
{
  "roomId": "room_123",
  "capabilityType": "participant",
  "sessionToken": "...",
  "expiresAt": "2026-03-24T23:00:00.000Z"
}
```

### `GET /api/rooms/:roomId`

Returns room metadata and encrypted submissions.

Headers:

```http
Authorization: Bearer <participant-session>
```

### `POST /api/rooms/:roomId/submissions`

Creates or updates a participant submission.

Headers:

```http
Authorization: Bearer <participant-session>
```

Request body:

```json
{
  "submissionId": "optional-existing-id",
  "editToken": "optional-existing-edit-token",
  "envelope": {
    "version": 2,
    "algorithm": "xchacha20poly1305-ietf",
    "nonce": "...",
    "ciphertext": "..."
  }
}
```

Response:

- stored submission metadata
- `submissionId`
- rotated `editToken`

### `DELETE /api/rooms/:roomId`

Deletes a room.

Headers:

```http
Authorization: Bearer <organizer-session>
```

## Security Controls

Server-side controls in [`server/index.ts`](/Users/konrad/Documents/privacy-meetings/server/index.ts):

- strict request validation with `zod`
- exact-origin CORS checks
- request body size limits
- request timeout handling
- per-route rate limiting
- `helmet` security headers
- no-referrer policy
- structured security logging without raw secret values

Frontend controls:

- CSP in [`index.html`](/Users/konrad/Documents/privacy-meetings/index.html)
- no third-party analytics or trackers
- capability URL scrubbing before normal page use
- participant decryption and overlap calculation happen in the browser
- Google OAuth access tokens are held in memory, used for direct browser-to-Google fetching, and revoked after import

Transport controls:

- production `APP_ORIGIN` must be HTTPS
- non-local PostgreSQL connections require certificate validation

## Environment

Frontend:

```bash
VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

Backend:

```bash
DATABASE_URL=postgres://...
PORT=8787
APP_ORIGIN=https://app.example.com
ALLOWED_ORIGINS=https://app.example.com
ROOM_TTL_DAYS=30
SESSION_TTL_HOURS=12
```

Google Cloud:

- add your app origins to Authorized JavaScript origins
- rotate any previously exposed client secret
- the app only uses the frontend client id

## Development

Install dependencies:

```bash
npm install
```

Run the client and server:

```bash
npm run dev
```

Build production assets:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Default local addresses:

- frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

## Files To Know

- [`src/App.tsx`](/Users/konrad/Documents/privacy-meetings/src/App.tsx): bootstrap flow, URL scrubbing, client storage, organizer/participant UI
- [`src/lib/crypto.ts`](/Users/konrad/Documents/privacy-meetings/src/lib/crypto.ts): encryption envelope logic
- [`src/lib/api.ts`](/Users/konrad/Documents/privacy-meetings/src/lib/api.ts): API client
- [`server/index.ts`](/Users/konrad/Documents/privacy-meetings/server/index.ts): API routes and security middleware
- [`server/security.ts`](/Users/konrad/Documents/privacy-meetings/server/security.ts): secret generation, hashing, bearer parsing, security logging
- [`server/db.ts`](/Users/konrad/Documents/privacy-meetings/server/db.ts): schema and persistence

## Operational Notes

- session expiry is intentional; users may need to re-open the original organizer or participant link
- the participant fragment key is still the highest-value secret on the client side
- if you later want persistence of the participant decryption key, treat that as a separate product and security decision
- the current build lazy-loads `libsodium-wrappers`; this keeps the main bundle smaller, but the crypto chunk is still large

The current database model is envelope-only. There is no legacy ciphertext migration path in the active code.
