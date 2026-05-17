# Deploy to Cloudflare Workers Free

This keeps the website online on Cloudflare Workers, stores app data in Workers KV, and stores uploaded photos in Google Drive.

## 1. Install and login

```powershell
npm install
npm install -g wrangler
wrangler login
```

## 2. Create KV storage

```powershell
wrangler kv namespace create DATA
```

Copy the returned `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "DATA"
id = "PASTE_THE_ID_HERE"
```

## 3. Add secrets

Do not put secrets in GitHub. Put them into Cloudflare:

```powershell
wrangler secret put ADMIN_PASSWORD
wrangler secret put GOOGLE_DRIVE_CLIENT_ID
wrangler secret put GOOGLE_DRIVE_CLIENT_SECRET
wrangler secret put GOOGLE_DRIVE_FOLDER_ID
```

Then deploy once and connect Google Drive from `/admin.html`. After Google returns to the site, the refresh token is saved in KV.

If you already have a refresh token, you can set it directly:

```powershell
wrangler secret put GOOGLE_DRIVE_REFRESH_TOKEN
```

## 4. Google OAuth redirect URI

In Google Cloud Console, add this Authorized redirect URI to the OAuth client:

```text
https://photobss.<your-cloudflare-subdomain>.workers.dev/api/google-drive/oauth/callback
```

If you connect a custom domain later, add that domain too:

```text
https://www.photobss.com/api/google-drive/oauth/callback
```

## 5. Deploy

```powershell
wrangler deploy
```

Cloudflare Workers Free is enough for this app at small school-event scale. Workers has a daily free request limit, KV has free included usage, and static assets can be served together with the Worker. Large photo files still live in Google Drive, not inside KV.

## Notes

- `googleDriveConfig.json`, `.env.*`, and `data/*.json` should stay local and ignored by Git.
- The admin only changes the main Drive folder link when starting a new event.
- New activity folders are created automatically inside the configured main Drive folder.
