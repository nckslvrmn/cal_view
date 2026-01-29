# Calendar View

A frontend-only Google Calendar viewer. No backend required.

## Features

- Auto-refresh every 60 seconds
- Dark theme
- Browser caching (15 minutes)
- Persistent Google login

## Setup

### 1. Google Cloud Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable **Google Calendar API**
3. Create OAuth 2.0 credentials:
   - Type: Web application
   - Add authorized JavaScript origins (e.g., `http://localhost:3000`)
   - No redirect URIs needed
   - Copy the Client ID

### 2. Configure Application

Edit `dist/config.js` and add your Client ID:

```javascript
CLIENT_ID: 'your-client-id-here.apps.googleusercontent.com'
```

### 3. Run

**Using darkhttpd** (recommended, included in Dockerfile):

```bash
darkhttpd dist --port 3000
```

**Using Docker**:

```bash
docker build -t cal-view .
docker run -p 3000:3000 cal-view
```

**Using Python**:

```bash
python3 -m http.server 3000 --directory dist
```

Open `http://localhost:3000`

## Troubleshooting

**"origin_mismatch" error**: Add your exact URL to authorized JavaScript origins in Google Cloud Console

**"Access blocked" error**: Configure OAuth consent screen and add your email as a test user

## Notes

- Client ID is public and safe to commit
- Access tokens stored in browser localStorage (1 hour expiry)
- Client Secret is NOT needed for frontend-only OAuth
