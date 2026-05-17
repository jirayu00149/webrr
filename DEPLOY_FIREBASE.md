# Deploy on Firebase

This project can run on Firebase Hosting + Cloud Functions. Hosting rewrites every request to the `app` function, which reuses `server.js`.

## One-time setup

1. Install the Firebase CLI and log in:

```powershell
npm install -g firebase-tools
firebase login
```

2. Make sure this project is selected:

```powershell
firebase use photobss
```

3. Create a local Firebase env file named `.env.photobss`. Do not commit this file to GitHub.

```text
ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD
GOOGLE_DRIVE_CLIENT_ID=YOUR_GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET=YOUR_GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN=YOUR_GOOGLE_DRIVE_REFRESH_TOKEN
GOOGLE_DRIVE_FOLDER_ID=YOUR_MAIN_DRIVE_FOLDER_URL_OR_ID
```

These same environment variables are supported when running locally or on other hosts:

```text
ADMIN_PASSWORD
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
GOOGLE_DRIVE_FOLDER_ID
```

## Deploy

```powershell
npm install
firebase deploy
```

## Notes

- `minInstances: 0` is used in `firebase-functions.js` to reduce fixed cost. The first request after inactivity can still have a cold start.
- The current app still stores metadata in local JSON files under `data/`. Cloud Functions storage is not a real database, so for production the next step should be moving `activities`, `photos`, and `share` data to Firestore.
- Google Drive Client Secrets must stay in Firebase/Google settings, not in public HTML or JavaScript files.
