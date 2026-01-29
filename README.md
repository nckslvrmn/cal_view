# Calendar View

A Google Calendar viewer for a wall or fridge display. A small Go server serves the frontend and holds a Google refresh token, so the display stays signed in without anyone touching it.

## Features

- Auto-refresh every 60 seconds
- Dark theme
- Browser caching (15 minutes)
- Sign in once, the server refreshes access tokens from then on

## Setup

### 1. Google Cloud configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable **Google Calendar API**
3. Create OAuth 2.0 credentials:
   - Type: Web application
   - Add `https://cal.example.com/auth/callback` as an authorized redirect URI, using your own hostname
   - Copy the client ID and client secret
4. On Branding, set the homepage to `https://cal.example.com`, the privacy policy to `https://cal.example.com/privacy.html`, and add your domain as an authorized domain.
5. On Audience, publish the app to **In production**. In "Testing", Google expires refresh tokens after 7 days. Unverified is fine for personal use, you click through a warning once.

Google only allows `localhost` or a public HTTPS domain as a redirect URI. Private IPs are rejected, but the domain only has to resolve for the browser doing the sign-in, so a LAN-only hostname works.

### 2. Run

The server reads these environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | yes | | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | | OAuth client secret |
| `REDIRECT_URL` | yes | | Must exactly match the redirect URI in Google Cloud, like `https://cal.example.com/auth/callback` |
| `PORT` | no | `3000` | Listen port |
| `DATA_DIR` | no | `data` | Where `token.json` is stored. `/data` in the image |
| `STATIC_DIR` | no | `dist` | Frontend files. `/app/dist` in the image |

Mount a volume at `/data` so the token survives container restarts:

```bash
docker run -d -p 3000:3000 -v cal_view:/data \
  -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
  -e REDIRECT_URL=https://cal.example.com/auth/callback \
  ghcr.io/nckslvrmn/cal_view:latest
```

Or locally with `go run .` and the same variables.

Publishing a GitHub release builds and pushes the image to GHCR. The deploy jobs in [`.github/workflows`](.github/workflows) target a self-hosted runner with [`compose.yml`](compose.yml), so adjust or drop them in a fork.

### 3. Sign in once

Open `https://cal.example.com/auth/login` and approve access. The refresh token lands in `token.json` in the data directory, and every display pointed at the server is signed in from then on.

## Troubleshooting

**"redirect_uri_mismatch" error**: `REDIRECT_URL` doesn't exactly match a redirect URI in Google Cloud Console.

**"Access blocked" error**: Configure the OAuth consent screen and add your email as a test user, or publish the app.

**Sign-in page shows up again**: Google revoked the refresh token. This happens after a password change, revoking the app in your Google account, 6 months without use, or 7 days if the consent screen is still in "Testing". Sign in again.

## Notes

- `/api/token` hands out a read-only calendar access token, and `/auth/login` replaces the stored account, for anyone who can reach the server. Keep it on a private network.
- Sign out on the display revokes the refresh token on the server, so every display gets signed out.
