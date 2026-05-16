const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 8080);
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, "data");
const uploadDir = path.join(dataDir, "uploads");
const photosFile = path.join(dataDir, "photos.json");
const activitiesFile = path.join(dataDir, "activities.json");
const shareFile = path.join(dataDir, "share.json");
const googlePhotosConfigFile = path.join(root, "googlePhotosConfig.json");
const googlePhotosRuntimeConfigFile = path.join(dataDir, "google-photos-config.json");
const googlePhotosTokenFile = path.join(dataDir, "google-photos-token.json");
const googleDriveRuntimeConfigFile = path.join(dataDir, "google-drive-config.json");
const googlePhotosOAuthStateCookie = "sff_google_photos_state";
const googlePhotosScope = "https://www.googleapis.com/auth/photoslibrary.appendonly";
const googleDriveScope = "https://www.googleapis.com/auth/drive.file";
const defaultActivity = {
  id: "general",
  name: "ทั่วไป",
  slug: "general",
  createdAt: 0
};
defaultActivity.name = "ทั่วไป";
const sessions = new Set();
let googlePhotosAccessTokenCache = { token: "", expiresAt: 0 };
let googleDriveAccessTokenCache = { token: "", key: "", expiresAt: 0 };

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

ensureDataFiles();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/") {
      await serveStatic(response, "index.html");
      return;
    }

    if (url.pathname.startsWith("/s/")) {
      await serveSharedUserPage(response, url.pathname);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    if (url.pathname.startsWith("/uploads/")) {
      await serveUpload(response, url.pathname);
      return;
    }

    if (url.pathname === "/admin.html" && !isAuthenticated(request)) {
      await serveStatic(response, "admin-login.html");
      return;
    }

    await serveStatic(response, url.pathname.replace(/^\/+/, "") || "user.html");
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`School Face Finder is running at http://localhost:${port}`);
  console.log(`Public URL: http://localhost:${port}/user.html`);
  console.log(`Admin URL: http://localhost:${port}/admin.html`);
  console.log("Default admin password is admin123. Set ADMIN_PASSWORD before production use.");
});

function ensureDataFiles() {
  fs.mkdirSync(path.join(uploadDir, defaultActivity.slug), { recursive: true });

  if (!fs.existsSync(activitiesFile)) {
    fs.writeFileSync(activitiesFile, `${JSON.stringify([defaultActivity], null, 2)}\n`, "utf8");
  }

  if (!fs.existsSync(shareFile)) {
    fs.writeFileSync(shareFile, `${JSON.stringify(makeShareState(), null, 2)}\n`, "utf8");
  }

  if (!fs.existsSync(photosFile)) {
    fs.writeFileSync(photosFile, "[]\n", "utf8");
    return;
  }

  const photos = JSON.parse(fs.readFileSync(photosFile, "utf8") || "[]");
  const migrated = photos.map((photo) => ({
    ...photo,
    activityId: photo.activityId || defaultActivity.id,
    activityName: photo.activityName || defaultActivity.name,
    activitySlug: photo.activitySlug || defaultActivity.slug
  }));

  if (JSON.stringify(photos) !== JSON.stringify(migrated)) {
    fs.writeFileSync(photosFile, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  }
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/photos" && request.method === "GET") {
    const photos = await readPhotos();
    sendJson(response, 200, { stats: makeStats(photos) });
    return;
  }

  if (url.pathname === "/api/activities" && request.method === "GET") {
    const photos = await readPhotos();
    const activities = await readActivities();
    const shareState = await readShareState();
    sendJson(response, 200, {
      activities: addActivityCounts(activities, photos),
      galleryUrl: shareState.galleryUrl || "",
      stats: makeStats(photos)
    });
    return;
  }

  if (url.pathname === "/api/search" && request.method === "POST") {
    const body = await readJsonBody(request, 512 * 1024);
    const descriptor = Array.isArray(body.descriptor)
      ? body.descriptor.map(Number).filter(Number.isFinite)
      : [];
    const threshold = Number(body.threshold || 0.52);
    const activityId = body.activityId && body.activityId !== "all"
      ? String(body.activityId)
      : "";

    if (!descriptor.length) {
      sendJson(response, 400, { error: "Invalid descriptor" });
      return;
    }

    const photos = await readPhotos();
    const searchablePhotos = activityId
      ? photos.filter((photo) => photo.activityId === activityId)
      : photos;
    const matches = searchablePhotos
      .flatMap((photo) => findBestMatch(photo, descriptor, threshold))
      .sort((a, b) => a.distance - b.distance);
    const shareState = await readShareState();

    sendJson(response, 200, {
      matches,
      galleryUrl: shareState.galleryUrl || "",
      stats: makeStats(searchablePhotos)
    });
    return;
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    const body = await readJsonBody(request, 32 * 1024);
    if (!body || !safeEqual(String(body.password || ""), adminPassword)) {
      sendJson(response, 401, { error: "รหัสแอดมินไม่ถูกต้อง" });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    sessions.add(token);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie("sff_admin", token, { httpOnly: true, sameSite: "Lax" })
    });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    const token = getCookie(request, "sff_admin");
    if (token) {
      sessions.delete(token);
    }
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie("sff_admin", "", {
        httpOnly: true,
        sameSite: "Lax",
        maxAge: 0
      })
    });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/api/admin/activities" && request.method === "POST") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "ต้องเข้าสู่ระบบแอดมินก่อน" });
      return;
    }

    const body = await readJsonBody(request, 64 * 1024);
    const name = sanitizeText(body.name, "");
    if (!name) {
      sendJson(response, 400, { error: "กรุณาระบุชื่อกิจกรรม" });
      return;
    }

    const activity = await createActivity(name);
    const photos = await readPhotos();
    sendJson(response, 201, {
      activity: addActivityCounts([activity], photos)[0],
      activities: addActivityCounts(await readActivities(), photos),
      stats: makeStats(photos)
    });
    return;
  }

  if (url.pathname === "/api/admin/photos" && request.method === "POST") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "ต้องเข้าสู่ระบบแอดมินก่อน" });
      return;
    }

    const body = await readJsonBody(request, 60 * 1024 * 1024);
    const activities = await readActivities();
    const activity = activities.find((item) => item.id === body.activityId);

    if (!activity) {
      sendJson(response, 400, { error: "กรุณาเลือกกิจกรรมก่อนอัปโหลด" });
      return;
    }

    const record = await saveUploadedPhoto(body, activity);
    const photos = await readPhotos();
    sendJson(response, 201, {
      photo: adminPhoto(record),
      activities: addActivityCounts(activities, photos),
      stats: makeStats(photos)
    });
    return;
  }

  if (url.pathname === "/api/admin/photos" && request.method === "GET") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const activityId = url.searchParams.get("activityId") || "";
    const photos = await readPhotos();
    const filteredPhotos = activityId
      ? photos.filter((photo) => photo.activityId === activityId)
      : photos;
    sendJson(response, 200, {
      photos: filteredPhotos
        .slice()
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
        .map(adminPhoto),
      stats: makeStats(filteredPhotos)
    });
    return;
  }

  const adminPhotoMatch = url.pathname.match(/^\/api\/admin\/photos\/([^/]+)$/);
  if (adminPhotoMatch && request.method === "PATCH") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const body = await readJsonBody(request, 64 * 1024);
    const result = await updateManualPhotoLink(
      adminPhotoMatch[1],
      body.googlePhotoUrl || body.productUrl || ""
    );
    sendJson(response, result.ok ? 200 : 404, result);
    return;
  }

  if (adminPhotoMatch && request.method === "DELETE") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const result = await deletePhoto(adminPhotoMatch[1]);
    sendJson(response, result.ok ? 200 : 404, result);
    return;
  }

  const adminActivityMatch = url.pathname.match(/^\/api\/admin\/activities\/([^/]+)$/);
  if (adminActivityMatch && request.method === "DELETE") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const result = await deleteActivity(adminActivityMatch[1]);
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }

  if (url.pathname === "/api/admin/share-link" && request.method === "GET") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    sendJson(response, 200, await makeShareLinkPayload(request));
    return;
  }

  if (url.pathname === "/api/admin/share-link" && request.method === "PATCH") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const body = await readJsonBody(request, 64 * 1024);
    const rawGalleryUrl = body.galleryUrl || body.googlePhotosUrl || "";
    const galleryUrl = sanitizeOptionalUrl(rawGalleryUrl);

    if (String(rawGalleryUrl || "").trim() && !galleryUrl) {
      sendJson(response, 400, { error: "Only http or https links are allowed" });
      return;
    }

    const shareState = await readShareState();
    shareState.galleryUrl = galleryUrl;
    shareState.updatedAt = Date.now();
    await writeShareState(shareState);
    sendJson(response, 200, await makeShareLinkPayload(request, shareState));
    return;
  }

  if (url.pathname === "/api/admin/share-link/regenerate" && request.method === "POST") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const currentState = await readShareState();
    const shareState = makeShareState({
      galleryUrl: currentState.galleryUrl || "",
      updatedAt: currentState.updatedAt || 0
    });
    await writeShareState(shareState);
    sendJson(response, 200, await makeShareLinkPayload(request, shareState));
    return;
  }

  if (url.pathname === "/api/admin/google-photos" && request.method === "GET") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const photos = await readPhotos();
    sendJson(response, 200, { googlePhotos: makeGooglePhotosSummary(photos) });
    return;
  }

  if (url.pathname === "/api/admin/google-drive" && request.method === "GET") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const photos = await readPhotos();
    const summary = makeGoogleDriveSummary(photos);
    await updateShareGalleryFromDrive(summary.folderUrl);
    sendJson(response, 200, { googleDrive: summary });
    return;
  }

  if (url.pathname === "/api/admin/google-drive/config" && request.method === "GET") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    sendJson(response, 200, { config: publicGoogleDriveConfig() });
    return;
  }

  if (url.pathname === "/api/admin/google-drive/config" && request.method === "PATCH") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const body = await readJsonBody(request, 256 * 1024);
    const result = await updateGoogleDriveRuntimeConfig(body);
    const photos = await readPhotos();
    const summary = makeGoogleDriveSummary(photos);
    await updateShareGalleryFromDrive(summary.folderUrl);
    sendJson(response, result.ok ? 200 : 400, {
      ...result,
      config: publicGoogleDriveConfig(),
      googleDrive: makeGoogleDriveSummary(photos)
    });
    return;
  }

  if (url.pathname === "/api/admin/google-photos/config" && request.method === "GET") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    sendJson(response, 200, { config: publicGooglePhotosConfig() });
    return;
  }

  if (url.pathname === "/api/admin/google-photos/config" && request.method === "PATCH") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const body = await readJsonBody(request, 64 * 1024);
    const result = await updateGooglePhotosRuntimeConfig(body);
    const photos = await readPhotos();
    sendJson(response, result.ok ? 200 : 400, {
      ...result,
      config: publicGooglePhotosConfig(),
      googlePhotos: makeGooglePhotosSummary(photos)
    });
    return;
  }

  if (url.pathname === "/api/admin/google-photos/connect" && request.method === "GET") {
    if (!isAuthenticated(request)) {
      redirect(response, "/admin.html");
      return;
    }

    await redirectToGooglePhotosOAuth(request, response);
    return;
  }

  if (url.pathname === "/api/google-photos/oauth/callback" && request.method === "GET") {
    await handleGooglePhotosOAuthCallback(request, response, url);
    return;
  }

  if (url.pathname === "/api/admin/google-photos/sync" && request.method === "POST") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const result = await syncGooglePhotosBacklog();
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }

  if (url.pathname === "/api/admin/google-drive/sync" && request.method === "POST") {
    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "Admin login required" });
      return;
    }

    const result = await syncGoogleDriveBacklog();
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function createActivity(name) {
  const activities = await readActivities();
  const slug = makeActivitySlug(name);
  const activity = {
    id: crypto.randomUUID(),
    name,
    slug,
    createdAt: Date.now()
  };

  await fsp.mkdir(path.join(uploadDir, slug), { recursive: true });
  activities.push(activity);
  await writeActivities(activities);
  return activity;
}

async function saveUploadedPhoto(body, activity) {
  if (!body || typeof body.imageData !== "string" || !Array.isArray(body.faces)) {
    throw new Error("Invalid upload payload");
  }

  const match = body.imageData.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Unsupported image data");
  }

  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const extension = mimeType.split("/")[1].replace("jpeg", "jpg");
  const id = crypto.randomUUID();
  const fileName = `${id}.${extension}`;
  const activityDir = path.join(uploadDir, activity.slug);
  const filePath = path.join(activityDir, fileName);
  const imageBuffer = Buffer.from(match[2], "base64");

  await fsp.mkdir(activityDir, { recursive: true });
  await fsp.writeFile(filePath, imageBuffer);

  const photos = await readPhotos();
  const record = {
    id,
    name: sanitizeText(body.name, "activity-photo"),
    type: mimeType,
    size: Number(body.size || imageBuffer.length),
    lastModified: Number(body.lastModified || Date.now()),
    createdAt: Date.now(),
    width: Number(body.width || 0),
    height: Number(body.height || 0),
    fileName,
    activityId: activity.id,
    activityName: activity.name,
    activitySlug: activity.slug,
    imageUrl: `/uploads/${activity.slug}/${fileName}`,
    faces: body.faces.map(normalizeFace).filter(Boolean)
  };

  record.googleDrive = await mirrorPhotoToGoogleDrive(record, imageBuffer, {
    fileName,
    mimeType
  });

  photos.push(record);
  await writePhotos(photos);
  return record;
}

async function updateManualPhotoLink(photoId, urlValue) {
  const photos = await readPhotos();
  const photo = photos.find((item) => item.id === photoId);

  if (!photo) {
    return { ok: false, error: "Photo not found" };
  }

  const productUrl = sanitizeOptionalUrl(urlValue);
  if (String(urlValue || "").trim() && !productUrl) {
    return { ok: false, error: "Only http or https links are allowed" };
  }

  photo.googlePhotos = productUrl
    ? makeManualGooglePhoto(productUrl)
    : {
        status: "unsynced",
        productUrl: "",
        updatedAt: Date.now()
      };

  await writePhotos(photos);
  return { ok: true, photo: adminPhoto(photo) };
}

async function deletePhoto(photoId) {
  const photos = await readPhotos();
  const index = photos.findIndex((photo) => photo.id === photoId);

  if (index === -1) {
    return { ok: false, error: "Photo not found" };
  }

  const [photo] = photos.splice(index, 1);
  await removePhotoFile(photo);
  await writePhotos(photos);
  return {
    ok: true,
    id: photoId,
    stats: makeStats(photos)
  };
}

async function deleteActivity(activityId) {
  const activities = await readActivities();
  const activity = activities.find((item) => item.id === activityId);

  if (!activity) {
    return { ok: false, error: "Activity not found" };
  }

  if (activity.id === defaultActivity.id) {
    return { ok: false, error: "Default activity cannot be deleted" };
  }

  const photos = await readPhotos();
  const keptPhotos = [];
  const removedPhotos = [];

  for (const photo of photos) {
    if (photo.activityId === activity.id) {
      removedPhotos.push(photo);
    } else {
      keptPhotos.push(photo);
    }
  }

  for (const photo of removedPhotos) {
    await removePhotoFile(photo);
  }

  const activityDir = path.resolve(uploadDir, activity.slug);
  if (isPathInside(uploadDir, activityDir)) {
    await fsp.rm(activityDir, { recursive: true, force: true });
  }

  await writePhotos(keptPhotos);
  await writeActivities(activities.filter((item) => item.id !== activity.id));

  return {
    ok: true,
    id: activity.id,
    deletedPhotos: removedPhotos.length,
    activities: addActivityCounts(await readActivities(), keptPhotos),
    stats: makeStats(keptPhotos)
  };
}

async function removePhotoFile(photo) {
  const filePath = getLocalPhotoPath(photo);
  if (filePath) {
    await fsp.unlink(filePath).catch(() => {});
  }
}

function makeManualGooglePhoto(productUrl) {
  return {
    status: "manual",
    mediaItemId: "",
    productUrl,
    syncedAt: 0,
    updatedAt: Date.now()
  };
}

function sanitizeOptionalUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeFace(face) {
  if (!face || !Array.isArray(face.descriptor) || !face.box) {
    return null;
  }

  return {
    descriptor: face.descriptor.map(Number).filter(Number.isFinite),
    box: {
      x: Number(face.box.x || 0),
      y: Number(face.box.y || 0),
      width: Number(face.box.width || 0),
      height: Number(face.box.height || 0)
    }
  };
}

function getGooglePhotosConfig() {
  const fileConfig = readJsonFileSync(googlePhotosConfigFile);
  const runtimeConfig = readJsonFileSync(googlePhotosRuntimeConfigFile);
  const tokenConfig = readJsonFileSync(googlePhotosTokenFile);
  const clientId =
    process.env.GOOGLE_PHOTOS_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    runtimeConfig.clientId ||
    fileConfig.clientId ||
    "";
  const clientSecret =
    process.env.GOOGLE_PHOTOS_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    runtimeConfig.clientSecret ||
    fileConfig.clientSecret ||
    "";
  const refreshToken =
    process.env.GOOGLE_PHOTOS_REFRESH_TOKEN ||
    process.env.GOOGLE_REFRESH_TOKEN ||
    runtimeConfig.refreshToken ||
    fileConfig.refreshToken ||
    tokenConfig.refreshToken ||
    tokenConfig.refresh_token ||
    "";
  const albumId =
    process.env.GOOGLE_PHOTOS_ALBUM_ID ||
    runtimeConfig.albumId ||
    fileConfig.albumId ||
    "";
  const enabled = boolFrom(
    process.env.GOOGLE_PHOTOS_ENABLED ?? runtimeConfig.enabled ?? fileConfig.enabled,
    Boolean(clientId && clientSecret)
  );

  return {
    enabled,
    clientId,
    clientSecret,
    refreshToken,
    albumId,
    oauthConfigured: Boolean(clientId && clientSecret),
    connected: Boolean(refreshToken)
  };
}

function publicGooglePhotosConfig() {
  const config = getGooglePhotosConfig();
  return {
    enabled: config.enabled,
    clientId: config.clientId || "",
    hasClientSecret: Boolean(config.clientSecret),
    albumId: config.albumId || "",
    connected: config.connected,
    usingEnv:
      Boolean(process.env.GOOGLE_PHOTOS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) ||
      Boolean(process.env.GOOGLE_PHOTOS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)
  };
}

async function updateGooglePhotosRuntimeConfig(body) {
  const next = readJsonFileSync(googlePhotosRuntimeConfigFile);

  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    next.enabled = Boolean(body.enabled);
  } else {
    next.enabled = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "clientId")) {
    next.clientId = sanitizeConfigValue(body.clientId);
  }

  if (Object.prototype.hasOwnProperty.call(body, "clientSecret")) {
    const clientSecret = sanitizeConfigValue(body.clientSecret);
    if (clientSecret) {
      next.clientSecret = clientSecret;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "albumId")) {
    next.albumId = sanitizeConfigValue(body.albumId);
  }

  if (!next.clientId || !next.clientSecret) {
    return { ok: false, error: "กรุณาใส่ Google Photos Client ID และ Client Secret" };
  }

  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(
    googlePhotosRuntimeConfigFile,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8"
  );
  return { ok: true };
}

function sanitizeConfigValue(value) {
  return String(value || "").trim().slice(0, 500);
}

function readJsonFileSync(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8") || "{}");
  } catch (error) {
    console.warn(`Could not read ${path.basename(filePath)}: ${error.message}`);
    return {};
  }
}

function boolFrom(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
    if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  }

  return fallback;
}

function getGoogleDriveConfig() {
  const runtimeConfig = readJsonFileSync(googleDriveRuntimeConfigFile);
  const serviceAccount = parseServiceAccount(
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      runtimeConfig.serviceAccountJson ||
      runtimeConfig.serviceAccount ||
      null
  );
  const folderId = extractGoogleDriveFolderId(
    process.env.GOOGLE_DRIVE_FOLDER_ID ||
      runtimeConfig.folderId ||
      runtimeConfig.folderUrl ||
      ""
  );
  const enabled = boolFrom(
    process.env.GOOGLE_DRIVE_ENABLED ?? runtimeConfig.enabled,
    Boolean(serviceAccount && folderId)
  );

  return {
    enabled,
    serviceAccount,
    folderId,
    folderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : "",
    configured: Boolean(serviceAccount && folderId)
  };
}

function parseServiceAccount(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value.client_email && value.private_key ? value : null;
  }

  try {
    const parsed = JSON.parse(String(value));
    return parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    return null;
  }
}

function publicGoogleDriveConfig() {
  const config = getGoogleDriveConfig();
  return {
    enabled: config.enabled,
    folderId: config.folderId,
    folderUrl: config.folderUrl,
    hasServiceAccount: Boolean(config.serviceAccount),
    serviceAccountEmail: config.serviceAccount?.client_email || "",
    usingEnv:
      Boolean(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) ||
      Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID)
  };
}

async function updateGoogleDriveRuntimeConfig(body) {
  const next = readJsonFileSync(googleDriveRuntimeConfigFile);
  next.enabled = Object.prototype.hasOwnProperty.call(body, "enabled")
    ? Boolean(body.enabled)
    : true;

  if (Object.prototype.hasOwnProperty.call(body, "folderId")) {
    next.folderId = extractGoogleDriveFolderId(body.folderId);
  }

  if (Object.prototype.hasOwnProperty.call(body, "serviceAccountJson")) {
    const serviceAccountJson = String(body.serviceAccountJson || "").trim();
    if (serviceAccountJson) {
      const serviceAccount = parseServiceAccount(serviceAccountJson);
      if (!serviceAccount) {
        return { ok: false, error: "Service Account JSON ไม่ถูกต้อง" };
      }
      next.serviceAccount = serviceAccount;
      delete next.serviceAccountJson;
    }
  }

  if (!next.serviceAccount?.client_email || !next.serviceAccount?.private_key) {
    return { ok: false, error: "กรุณาใส่ Service Account JSON" };
  }

  if (!next.folderId) {
    return { ok: false, error: "กรุณาใส่ Google Drive Folder ID หรือ URL" };
  }

  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(
    googleDriveRuntimeConfigFile,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8"
  );
  return { ok: true };
}

function extractGoogleDriveFolderId(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const folderMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return folderMatch[1];
  }

  try {
    const url = new URL(text);
    const id = url.searchParams.get("id");
    if (id) {
      return id;
    }
  } catch {}

  return text.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 180);
}

function makeGoogleDriveSummary(photos) {
  const config = getGoogleDriveConfig();
  let state = "ready";

  if (!config.configured) {
    state = "not_configured";
  } else if (!config.enabled) {
    state = "disabled";
  }

  const saved = photos.filter((photo) => photo.googleDrive?.status === "saved").length;
  const failed = photos.filter((photo) => photo.googleDrive?.status === "failed").length;
  const unsynced = photos.filter((photo) => photo.googleDrive?.status !== "saved").length;

  return {
    state,
    enabled: config.enabled,
    configured: config.configured,
    folderId: config.folderId,
    folderUrl: config.folderUrl,
    serviceAccountEmail: config.serviceAccount?.client_email || "",
    total: photos.length,
    saved,
    failed,
    unsynced,
    syncUrl: "/api/admin/google-drive/sync"
  };
}

function publicGoogleDriveState(googleDrive) {
  if (!googleDrive || typeof googleDrive !== "object") {
    return { status: "unsynced" };
  }

  return {
    status: googleDrive.status || "unsynced",
    fileId: googleDrive.fileId || "",
    webViewLink: googleDrive.webViewLink || "",
    folderId: googleDrive.folderId || "",
    folderUrl: googleDrive.folderUrl || "",
    syncedAt: googleDrive.syncedAt || 0,
    updatedAt: googleDrive.updatedAt || 0,
    error: googleDrive.error || ""
  };
}

async function mirrorPhotoToGoogleDrive(photo, imageBuffer, options = {}) {
  const config = getGoogleDriveConfig();

  if (!config.configured) {
    return {
      status: "not_configured",
      updatedAt: Date.now()
    };
  }

  if (!config.enabled) {
    return {
      status: "disabled",
      updatedAt: Date.now()
    };
  }

  try {
    const mimeType = options.mimeType || getPhotoMimeType(photo);
    const fileName = sanitizeGooglePhotosFileName(options.fileName || photo.fileName || photo.name);
    const accessToken = await getGoogleDriveAccessToken(config);
    const folder = await getGoogleDrivePhotoFolder(photo, config, accessToken);
    const file = await uploadGoogleDriveFile(accessToken, {
      imageBuffer,
      mimeType,
      fileName,
      folderId: folder.id
    });

    return {
      status: "saved",
      fileId: file.id || "",
      webViewLink: file.webViewLink || "",
      folderId: folder.id,
      folderUrl: folder.url,
      syncedAt: Date.now()
    };
  } catch (error) {
    console.error("Google Drive upload failed:", error);
    return {
      status: "failed",
      error: sanitizeGoogleError(error),
      updatedAt: Date.now()
    };
  }
}

async function syncGoogleDriveBacklog() {
  const photos = await readPhotos();
  const summary = makeGoogleDriveSummary(photos);

  if (summary.state !== "ready") {
    return {
      ok: false,
      error: "Google Drive is not configured",
      googleDrive: summary
    };
  }

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const photo of photos) {
    if (photo.googleDrive?.status === "saved") {
      skipped += 1;
      continue;
    }

    const filePath = getLocalPhotoPath(photo);
    if (!filePath) {
      photo.googleDrive = {
        status: "failed",
        error: "Local file path is invalid",
        updatedAt: Date.now()
      };
      failed += 1;
      continue;
    }

    try {
      const imageBuffer = await fsp.readFile(filePath);
      photo.googleDrive = await mirrorPhotoToGoogleDrive(photo, imageBuffer, {
        fileName: photo.fileName,
        mimeType: getPhotoMimeType(photo)
      });

      if (photo.googleDrive.status === "saved") {
        synced += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      photo.googleDrive = {
        status: "failed",
        error: sanitizeGoogleError(error),
        updatedAt: Date.now()
      };
      failed += 1;
    }

    await writePhotos(photos);
  }

  await writePhotos(photos);
  return {
    ok: true,
    synced,
    failed,
    skipped,
    googleDrive: makeGoogleDriveSummary(photos)
  };
}

async function getGoogleDriveAccessToken(config) {
  const cacheKey = `${config.serviceAccount.client_email}:${config.folderId}`;
  if (
    googleDriveAccessTokenCache.token &&
    googleDriveAccessTokenCache.key === cacheKey &&
    googleDriveAccessTokenCache.expiresAt > Date.now() + 60 * 1000
  ) {
    return googleDriveAccessTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = makeServiceAccountJwt(config.serviceAccount, {
    scope: googleDriveScope,
    iat: now,
    exp: now + 3600
  });
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  }).toString();
  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body)
    }
  }, body);

  if (!token.access_token) {
    throw new Error("Google did not return a Drive access token.");
  }

  googleDriveAccessTokenCache = {
    token: token.access_token,
    key: cacheKey,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
  };
  return token.access_token;
}

async function getGoogleDrivePhotoFolder(photo, config, accessToken) {
  const activities = await readActivities();
  const activity = activities.find((item) => item.id === photo.activityId);

  if (!activity) {
    return {
      id: config.folderId,
      url: config.folderUrl
    };
  }

  if (activity.googleDriveFolderId) {
    return {
      id: activity.googleDriveFolderId,
      url:
        activity.googleDriveFolderUrl ||
        `https://drive.google.com/drive/folders/${activity.googleDriveFolderId}`
    };
  }

  const folderName = sanitizeGoogleDriveFolderName(activity.name || photo.activityName || "activity");
  const folder = await createGoogleDriveFolder(accessToken, {
    name: folderName,
    parentId: config.folderId
  });
  const folderId = folder.id || "";
  const folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;

  if (!folderId) {
    throw new Error("Google Drive did not create an activity folder.");
  }

  activity.googleDriveFolderId = folderId;
  activity.googleDriveFolderUrl = folderUrl;
  await writeActivities(activities);

  return {
    id: folderId,
    url: folderUrl
  };
}

function sanitizeGoogleDriveFolderName(name) {
  const safeName = String(name || "activity")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()
    .slice(0, 180);
  return safeName || "activity";
}

async function createGoogleDriveFolder(accessToken, options) {
  const body = JSON.stringify({
    name: options.name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [options.parentId]
  });

  return requestJson(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": Buffer.byteLength(body)
      }
    },
    body
  );
}

function makeServiceAccountJwt(serviceAccount, options) {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claim = base64UrlJson({
    iss: serviceAccount.client_email,
    scope: options.scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: options.iat,
    exp: options.exp
  });
  const input = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  return `${input}.${base64Url(signature)}`;
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

async function uploadGoogleDriveFile(accessToken, options) {
  const boundary = `sff_drive_${crypto.randomBytes(12).toString("hex")}`;
  const metadata = {
    name: options.fileName,
    mimeType: options.mimeType,
    parents: [options.folderId]
  };
  const start = Buffer.from(
    `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${options.mimeType}\r\n\r\n`,
    "utf8"
  );
  const end = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([start, options.imageBuffer, end]);

  return requestJson(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": body.length
      }
    },
    body
  );
}

async function updateShareGalleryFromDrive(folderUrl) {
  if (!folderUrl) {
    return;
  }

  const shareState = await readShareState();
  shareState.galleryUrl = folderUrl;
  shareState.updatedAt = Date.now();
  await writeShareState(shareState);
}

function makeGooglePhotosSummary(photos) {
  const config = getGooglePhotosConfig();
  let state = "ready";

  if (!config.oauthConfigured) {
    state = "not_configured";
  } else if (!config.enabled) {
    state = "disabled";
  } else if (!config.connected) {
    state = "not_connected";
  }

  const saved = photos.filter((photo) =>
    ["saved", "manual"].includes(photo.googlePhotos?.status)
  ).length;
  const failed = photos.filter((photo) => photo.googlePhotos?.status === "failed").length;
  const unsynced = photos.filter(
    (photo) => !["saved", "manual"].includes(photo.googlePhotos?.status)
  ).length;

  return {
    state,
    enabled: config.enabled,
    oauthConfigured: config.oauthConfigured,
    connected: config.connected,
    albumId: config.albumId,
    scope: googlePhotosScope,
    total: photos.length,
    saved,
    failed,
    unsynced,
    connectUrl: "/api/admin/google-photos/connect",
    syncUrl: "/api/admin/google-photos/sync"
  };
}

function publicGooglePhotoState(googlePhotos) {
  if (!googlePhotos || typeof googlePhotos !== "object") {
    return { status: "unsynced" };
  }

  return {
    status: googlePhotos.status || "unsynced",
    mediaItemId: googlePhotos.mediaItemId || "",
    productUrl: googlePhotos.productUrl || "",
    syncedAt: googlePhotos.syncedAt || 0,
    updatedAt: googlePhotos.updatedAt || 0,
    error: googlePhotos.error || ""
  };
}

async function mirrorPhotoToGooglePhotos(photo, imageBuffer, options = {}) {
  const config = getGooglePhotosConfig();

  if (!config.oauthConfigured) {
    return {
      status: "not_configured",
      updatedAt: Date.now()
    };
  }

  if (!config.enabled) {
    return {
      status: "disabled",
      updatedAt: Date.now()
    };
  }

  if (!config.connected) {
    return {
      status: "not_connected",
      updatedAt: Date.now()
    };
  }

  try {
    const mimeType = options.mimeType || getPhotoMimeType(photo);
    const fileName = sanitizeGooglePhotosFileName(options.fileName || photo.fileName || photo.name);
    const accessToken = await getGooglePhotosAccessToken(config);
    const uploadToken = await uploadGooglePhotosBytes(accessToken, imageBuffer, mimeType);
    const mediaItem = await createGooglePhotosMediaItem(accessToken, {
      uploadToken,
      fileName,
      albumId: config.albumId
    });

    return {
      status: "saved",
      mediaItemId: mediaItem.id || "",
      productUrl: mediaItem.productUrl || "",
      syncedAt: Date.now()
    };
  } catch (error) {
    console.error("Google Photos upload failed:", error);
    return {
      status: "failed",
      error: sanitizeGoogleError(error),
      updatedAt: Date.now()
    };
  }
}

async function syncGooglePhotosBacklog() {
  const photos = await readPhotos();
  const summary = makeGooglePhotosSummary(photos);

  if (summary.state !== "ready") {
    return {
      ok: false,
      error: "Google Photos is not connected",
      googlePhotos: summary
    };
  }

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const photo of photos) {
    if (["saved", "manual"].includes(photo.googlePhotos?.status)) {
      skipped += 1;
      continue;
    }

    const filePath = getLocalPhotoPath(photo);
    if (!filePath) {
      photo.googlePhotos = {
        status: "failed",
        error: "Local file path is invalid",
        updatedAt: Date.now()
      };
      failed += 1;
      continue;
    }

    try {
      const imageBuffer = await fsp.readFile(filePath);
      photo.googlePhotos = await mirrorPhotoToGooglePhotos(photo, imageBuffer, {
        fileName: photo.fileName,
        mimeType: getPhotoMimeType(photo)
      });

      if (photo.googlePhotos.status === "saved") {
        synced += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      photo.googlePhotos = {
        status: "failed",
        error: sanitizeGoogleError(error),
        updatedAt: Date.now()
      };
      failed += 1;
    }

    await writePhotos(photos);
  }

  await writePhotos(photos);
  return {
    ok: true,
    synced,
    failed,
    skipped,
    googlePhotos: makeGooglePhotosSummary(photos)
  };
}

function getLocalPhotoPath(photo) {
  if (!photo || !photo.fileName) {
    return "";
  }

  const filePath = path.resolve(
    uploadDir,
    photo.activitySlug || defaultActivity.slug,
    photo.fileName
  );

  return isPathInside(uploadDir, filePath) ? filePath : "";
}

function getPhotoMimeType(photo) {
  if (photo?.type) {
    return photo.type;
  }

  const fileName = photo?.fileName || "";
  const contentType = contentTypes[path.extname(fileName).toLowerCase()];
  return contentType ? contentType.split(";")[0] : "image/jpeg";
}

function sanitizeGooglePhotosFileName(fileName) {
  const safeName = String(fileName || "photo.jpg")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()
    .slice(0, 255);
  return safeName || "photo.jpg";
}

async function redirectToGooglePhotosOAuth(request, response) {
  const config = getGooglePhotosConfig();

  if (!config.oauthConfigured) {
    sendHtml(
      response,
      400,
      makeGooglePhotosMessagePage(
        "Google Photos setup",
        "Missing GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET."
      )
    );
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = `${getOrigin(request)}/api/google-photos/oauth/callback`;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: googlePhotosScope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  });

  response.writeHead(302, {
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    "Set-Cookie": cookie(googlePhotosOAuthStateCookie, state, {
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 600
    })
  });
  response.end();
}

async function handleGooglePhotosOAuthCallback(request, response, url) {
  const expectedState = getCookie(request, googlePhotosOAuthStateCookie);
  const actualState = url.searchParams.get("state");
  const clearStateCookie = cookie(googlePhotosOAuthStateCookie, "", {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 0
  });

  try {
    if (!expectedState || expectedState !== actualState) {
      throw new Error("OAuth state did not match. Please start the connection again.");
    }

    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      throw new Error(`Google rejected the connection: ${oauthError}`);
    }

    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("Google did not return an authorization code.");
    }

    const config = getGooglePhotosConfig();
    if (!config.oauthConfigured) {
      throw new Error("Missing Google Photos OAuth client settings.");
    }

    const redirectUri = `${getOrigin(request)}/api/google-photos/oauth/callback`;
    const token = await exchangeGooglePhotosCode(config, code, redirectUri);
    const refreshToken = token.refresh_token || config.refreshToken;

    if (!refreshToken) {
      throw new Error("Google did not return a refresh token. Try connecting again.");
    }

    await saveGooglePhotosToken({
      refreshToken,
      scope: token.scope || googlePhotosScope,
      tokenType: token.token_type || "Bearer",
      savedAt: Date.now()
    });

    if (token.access_token) {
      googlePhotosAccessTokenCache = {
        token: token.access_token,
        refreshToken,
        expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
      };
    }

    sendHtml(
      response,
      200,
      makeGooglePhotosMessagePage(
        "Google Photos connected",
        "You can close this page and return to the admin upload screen."
      ),
      { "Set-Cookie": clearStateCookie }
    );
  } catch (error) {
    sendHtml(
      response,
      400,
      makeGooglePhotosMessagePage("Google Photos connection failed", error.message),
      { "Set-Cookie": clearStateCookie }
    );
  }
}

async function exchangeGooglePhotosCode(config, code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  }).toString();

  return requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body)
    }
  }, body);
}

async function saveGooglePhotosToken(token) {
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(googlePhotosTokenFile, `${JSON.stringify(token, null, 2)}\n`, "utf8");
}

async function getGooglePhotosAccessToken(config) {
  if (
    googlePhotosAccessTokenCache.token &&
    googlePhotosAccessTokenCache.refreshToken === config.refreshToken &&
    googlePhotosAccessTokenCache.expiresAt > Date.now() + 60 * 1000
  ) {
    return googlePhotosAccessTokenCache.token;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token"
  }).toString();

  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body)
    }
  }, body);

  if (!token.access_token) {
    throw new Error("Google did not return an access token.");
  }

  googlePhotosAccessTokenCache = {
    token: token.access_token,
    refreshToken: config.refreshToken,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
  };

  return token.access_token;
}

async function uploadGooglePhotosBytes(accessToken, imageBuffer, mimeType) {
  const uploadToken = await requestText("https://photoslibrary.googleapis.com/v1/uploads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": imageBuffer.length,
      "X-Goog-Upload-Content-Type": mimeType,
      "X-Goog-Upload-Protocol": "raw"
    }
  }, imageBuffer);

  if (!uploadToken) {
    throw new Error("Google Photos upload returned an empty upload token.");
  }

  return uploadToken;
}

async function createGooglePhotosMediaItem(accessToken, item) {
  const payload = {
    newMediaItems: [
      {
        simpleMediaItem: {
          fileName: item.fileName,
          uploadToken: item.uploadToken
        }
      }
    ]
  };

  if (item.albumId) {
    payload.albumId = item.albumId;
  }

  const body = JSON.stringify(payload);
  const result = await requestJson("https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body)
    }
  }, body);

  const createResult = result.newMediaItemResults?.[0];
  if (!createResult?.mediaItem) {
    const message = createResult?.status?.message || "Google Photos did not create a media item.";
    throw new Error(message);
  }

  return createResult.mediaItem;
}

function requestText(urlString, options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = https.request(
      {
        method: options.method || "GET",
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: options.headers || {}
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode || 0;
          if (status < 200 || status >= 300) {
            const error = new Error(`HTTP ${status} from ${url.hostname}`);
            error.status = status;
            error.body = text;
            reject(error);
            return;
          }
          resolve(text);
        });
      }
    );

    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function requestJson(urlString, options, body) {
  const text = await requestText(urlString, options, body);
  try {
    return JSON.parse(text || "{}");
  } catch (error) {
    error.body = text;
    throw error;
  }
}

function sanitizeGoogleError(error) {
  const status = error.status ? `HTTP ${error.status}: ` : "";
  const rawBody = String(error.body || "");
  let message = error.message || "Unknown Google Photos error";

  if (rawBody) {
    try {
      const body = JSON.parse(rawBody);
      message =
        body.error_description ||
        body.error?.message ||
        body.error ||
        message;
    } catch {
      message = rawBody;
    }
  }

  return `${status}${message}`.replace(/\s+/g, " ").trim().slice(0, 300);
}

function getOrigin(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(request.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const proto = forwardedProto || "http";
  const host = forwardedHost || request.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
}

function makeGooglePhotosMessagePage(title, message) {
  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(title)}</title>
    <style>
      body { display: grid; min-height: 100vh; margin: 0; place-items: center; font-family: "Segoe UI", sans-serif; background: #f6f8fb; color: #182033; }
      main { width: min(520px, calc(100% - 32px)); border: 1px solid #d8e0ec; border-radius: 8px; background: #fff; padding: 28px; box-shadow: 0 20px 50px rgba(24, 32, 51, 0.12); }
      h1 { margin: 0 0 10px; font-size: 1.7rem; }
      p { margin: 0 0 18px; color: #667085; }
      a { display: inline-flex; min-height: 42px; align-items: center; border-radius: 8px; background: #155eef; color: #fff; padding: 0 16px; font-weight: 800; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>${htmlEscape(title)}</h1>
      <p>${htmlEscape(message)}</p>
      <a href="/admin.html">Back to admin</a>
    </main>
  </body>
</html>`;
}

function sendHtml(response, status, html, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    ...headers
  });
  response.end(html);
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeShareState(overrides = {}) {
  return {
    token: crypto.randomBytes(12).toString("hex"),
    createdAt: Date.now(),
    galleryUrl: sanitizeOptionalUrl(overrides.galleryUrl || ""),
    updatedAt: Number(overrides.updatedAt || 0)
  };
}

async function readShareState() {
  try {
    const state = JSON.parse(await fsp.readFile(shareFile, "utf8"));
    if (state?.token) {
      state.createdAt = Number(state.createdAt || 0) || Date.now();
      state.galleryUrl = sanitizeOptionalUrl(state.galleryUrl || state.googlePhotosUrl || "");
      state.updatedAt = Number(state.updatedAt || 0);
      return state;
    }
  } catch {}

  const state = makeShareState();
  await writeShareState(state);
  return state;
}

async function writeShareState(state) {
  await fsp.writeFile(shareFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function makeShareLinkPayload(request, state = null) {
  const shareState = state || await readShareState();
  const pathName = `/s/${shareState.token}`;
  const displayUrl = `www.photobss${pathName}`;
  const url = `${getOrigin(request)}${pathName}`;
  return {
    token: shareState.token,
    path: pathName,
    displayUrl,
    url,
    localUrl: url,
    galleryUrl: shareState.galleryUrl || "",
    createdAt: shareState.createdAt || 0,
    updatedAt: shareState.updatedAt || 0
  };
}

async function readActivities() {
  try {
    const activities = JSON.parse(await fsp.readFile(activitiesFile, "utf8"));
    return activities.length ? activities : [defaultActivity];
  } catch {
    return [defaultActivity];
  }
}

async function writeActivities(activities) {
  await fsp.writeFile(activitiesFile, `${JSON.stringify(activities, null, 2)}\n`, "utf8");
}

async function readPhotos() {
  try {
    return JSON.parse(await fsp.readFile(photosFile, "utf8"));
  } catch {
    return [];
  }
}

async function writePhotos(photos) {
  await fsp.writeFile(photosFile, `${JSON.stringify(photos, null, 2)}\n`, "utf8");
}

function adminPhoto(photo) {
  return {
    id: photo.id,
    name: photo.name,
    type: photo.type,
    size: photo.size,
    createdAt: photo.createdAt,
    width: photo.width,
    height: photo.height,
    imageUrl: photo.imageUrl,
    activityId: photo.activityId,
    activityName: photo.activityName,
    facesCount: photo.faces.length,
    googleDrive: publicGoogleDriveState(photo.googleDrive),
    googlePhotos: publicGooglePhotoState(photo.googlePhotos)
  };
}

function searchPhoto(photo) {
  return {
    id: photo.id,
    name: photo.name,
    type: photo.type,
    size: photo.size,
    width: photo.width,
    height: photo.height,
    imageUrl: photo.imageUrl,
    activityId: photo.activityId,
    activityName: photo.activityName,
    facesCount: photo.faces.length,
    googleDrive: publicGoogleDriveState(photo.googleDrive),
    googlePhotos: publicGooglePhotoState(photo.googlePhotos)
  };
}

function findBestMatch(photo, descriptor, threshold) {
  const bestFace = photo.faces
    .filter((face) => Array.isArray(face.descriptor) && face.descriptor.length)
    .map((face) => ({
      face,
      distance: euclideanDistance(descriptor, face.descriptor)
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (!bestFace || bestFace.distance > threshold) {
    return [];
  }

  return [
    {
      photo: searchPhoto(photo),
      face: { box: bestFace.face.box },
      distance: bestFace.distance,
      confidence: Math.max(0, 1 - bestFace.distance / threshold)
    }
  ];
}

function euclideanDistance(left, right) {
  const length = Math.min(left.length, right.length);
  let sum = 0;

  for (let index = 0; index < length; index += 1) {
    const diff = left[index] - right[index];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

function addActivityCounts(activities, photos) {
  return activities.map((activity) => {
    const activityPhotos = photos.filter((photo) => photo.activityId === activity.id);
    return {
      ...activity,
      photosCount: activityPhotos.length,
      facesCount: activityPhotos.reduce((total, photo) => total + photo.faces.length, 0)
    };
  });
}

function makeStats(photos) {
  return {
    photos: photos.length,
    faces: photos.reduce((total, photo) => total + photo.faces.length, 0)
  };
}

async function serveSharedUserPage(response, pathname) {
  const token = pathname.replace(/^\/s\/+/, "").split("/")[0];
  const shareState = await readShareState();

  if (!token || token !== shareState.token) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  await serveStatic(response, "user.html");
}

async function serveUpload(response, pathname) {
  const relativePath = decodeURIComponent(pathname.replace(/^\/uploads\/?/, ""));
  const filePath = path.resolve(uploadDir, relativePath);

  if (!isPathInside(uploadDir, filePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  await readFileToResponse(response, filePath);
}

async function serveStatic(response, requestedPath) {
  const cleanPath = decodeURIComponent(requestedPath).replace(/^[/\\]+/, "");
  const filePath = path.resolve(root, cleanPath);

  if (!isPathInside(root, filePath) || isPathInside(dataDir, filePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  await readFileToResponse(response, filePath);
}

async function readFileToResponse(response, filePath) {
  try {
    const data = await fsp.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

function readJsonBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function isAuthenticated(request) {
  const token = getCookie(request, "sff_admin");
  return Boolean(token && sessions.has(token));
}

function getCookie(request, name) {
  const header = request.headers.cookie || "";
  const cookies = Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim().split("="))
      .filter((parts) => parts.length === 2)
  );
  return cookies[name];
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${value}`, "Path=/"];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function safeEqual(input, expected) {
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sanitizeText(value, fallback) {
  const text = String(value || fallback).trim();
  return text.slice(0, 180) || fallback;
}

function makeActivitySlug(name) {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "activity";
  return `${base}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function isPathInside(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
