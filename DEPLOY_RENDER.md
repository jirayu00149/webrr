# Deploy on Render

This project must run as a Render **Web Service**, not a Static Site. The browser calls API routes such as `/api/activities`, and those routes exist only when `server.js` is running.

## Render setup

1. Push this repository to GitHub.
2. In Render, create a new **Web Service** from the repository.
3. Use these settings:
   - Runtime: `Node`
   - Build command: `npm install --omit=dev`
   - Start command: `npm start`
4. Add an environment variable:
   - `ADMIN_PASSWORD`: your real admin password
   - Optional, for automatic Google Photos sync:
     - `GOOGLE_PHOTOS_CLIENT_ID`
     - `GOOGLE_PHOTOS_CLIENT_SECRET`
     - `GOOGLE_PHOTOS_REFRESH_TOKEN` (added after OAuth connect, or set manually)
     - `GOOGLE_PHOTOS_ALBUM_ID` (optional target album)
5. Deploy, then open:
   - Public page: `https://YOUR-SERVICE.onrender.com/user.html`
   - Admin page: `https://YOUR-SERVICE.onrender.com/admin.html`

The included `render.yaml` can also be used as a Render Blueprint.

## Why Static Site fails

If the service is created as a Static Site, Render serves only HTML/CSS/JS files. It does not run `server.js`, so `/api/activities`, `/api/search`, and upload routes return `404`.

## Uploaded photos

By default, uploaded photos are stored under `data/uploads`. Render's normal filesystem is ephemeral, so files can disappear after redeploys or restarts. For long-term storage on Render, use a paid Web Service with a persistent disk and set:

```text
DATA_DIR=/path/to/your/persistent/disk
```

Google Photos sync can still be used as a second copy when Google OAuth is configured.
