const DATA_KEYS = {
  activities: "activities",
  photos: "photos",
  share: "share-state",
  driveConfig: "drive-config"
};

const ADMIN_COOKIE = "sff_admin";
const DRIVE_STATE_COOKIE = "sff_google_drive_state";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DEFAULT_ACTIVITY = {
  id: "general",
  name: "ทั่วไป",
  slug: "general",
  createdAt: 0
};

let driveTokenCache = {
  token: "",
  refreshToken: "",
  expiresAt: 0
};

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(error);
      return json({ error: "Internal server error" }, 500);
    }
  }
};

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    return serveAsset(request, env, "/index.html");
  }

  if (url.pathname === "/admin.html") {
    if (!(await isAuthenticated(request, env))) {
      return serveAsset(request, env, "/admin-login.html");
    }
    return serveAsset(request, env, "/admin.html");
  }

  if (url.pathname.startsWith("/s/")) {
    return serveSharedUserPage(request, env, url);
  }

  if (url.pathname.startsWith("/api/drive-image/")) {
    return serveDriveImage(request, env, url);
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, env, url);
  }

  return env.ASSETS.fetch(request);
}

async function handleApi(request, env, url) {
  if (url.pathname === "/api/photos" && request.method === "GET") {
    const photos = await readPhotos(env);
    return json({ stats: makeStats(photos) });
  }

  if (url.pathname === "/api/activities" && request.method === "GET") {
    const photos = await readPhotos(env);
    const activities = await readActivities(env);
    const shareState = await readShareState(env);
    return json({
      activities: addActivityCounts(activities, photos),
      galleryUrl: shareState.galleryUrl || "",
      stats: makeStats(photos)
    });
  }

  if (url.pathname === "/api/search" && request.method === "POST") {
    const body = await request.json();
    const descriptor = Array.isArray(body.descriptor)
      ? body.descriptor.map(Number).filter(Number.isFinite)
      : [];
    const threshold = Number(body.threshold || 0.52);
    const activityId = body.activityId && body.activityId !== "all"
      ? String(body.activityId)
      : "";

    if (!descriptor.length) {
      return json({ error: "Invalid descriptor" }, 400);
    }

    const photos = await readPhotos(env);
    const activities = await readActivities(env);
    const searchablePhotos = activityId
      ? photos.filter((photo) => photo.activityId === activityId)
      : photos;
    const matches = searchablePhotos
      .flatMap((photo) => findBestMatch(photo, descriptor, threshold))
      .sort((left, right) => left.distance - right.distance);
    const selectedActivity = activityId
      ? activities.find((activity) => activity.id === activityId)
      : null;
    const shareState = await readShareState(env);

    return json({
      matches,
      galleryUrl: selectedActivity?.googleDriveFolderUrl || shareState.galleryUrl || "",
      stats: makeStats(searchablePhotos)
    });
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const password = env.ADMIN_PASSWORD || "admin123";

    if (String(body.password || "") !== password) {
      return json({ error: "Admin password is incorrect" }, 401);
    }

    const token = randomToken();
    await env.DATA.put(`session:${token}`, "1", { expirationTtl: 60 * 60 * 24 });
    return json(
      { ok: true },
      200,
      {
        "Set-Cookie": cookie(ADMIN_COOKIE, token, {
          httpOnly: true,
          sameSite: "Lax",
          secure: url.protocol === "https:"
        })
      }
    );
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    const token = getCookie(request, ADMIN_COOKIE);
    if (token) {
      await env.DATA.delete(`session:${token}`);
    }
    return json(
      { ok: true },
      200,
      {
        "Set-Cookie": cookie(ADMIN_COOKIE, "", {
          httpOnly: true,
          sameSite: "Lax",
          maxAge: 0,
          secure: url.protocol === "https:"
        })
      }
    );
  }

  if (url.pathname === "/api/admin/share-link" && request.method === "GET") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    return json(await makeShareLinkPayload(request, env));
  }

  if (url.pathname === "/api/admin/share-link" && request.method === "PATCH") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const body = await request.json().catch(() => ({}));
    const rawGalleryUrl = body.galleryUrl || body.googlePhotosUrl || "";
    const galleryUrl = sanitizeOptionalUrl(rawGalleryUrl);

    if (String(rawGalleryUrl || "").trim() && !galleryUrl) {
      return json({ error: "Only http or https links are allowed" }, 400);
    }

    const shareState = await readShareState(env);
    shareState.galleryUrl = galleryUrl;
    shareState.updatedAt = Date.now();
    await writeJson(env, DATA_KEYS.share, shareState);
    return json(await makeShareLinkPayload(request, env, shareState));
  }

  if (url.pathname === "/api/admin/share-link/regenerate" && request.method === "POST") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const currentState = await readShareState(env);
    const shareState = makeShareState({
      galleryUrl: currentState.galleryUrl || "",
      updatedAt: currentState.updatedAt || 0
    });
    await writeJson(env, DATA_KEYS.share, shareState);
    return json(await makeShareLinkPayload(request, env, shareState));
  }

  if (url.pathname === "/api/admin/activities" && request.method === "POST") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const body = await request.json().catch(() => ({}));
    const name = sanitizeText(body.name, "");

    if (!name) {
      return json({ error: "Activity name is required" }, 400);
    }

    const activity = await createActivity(env, name);
    const photos = await readPhotos(env);
    const shareState = await readShareState(env);
    return json(
      {
        activity: addActivityCounts([activity], photos)[0],
        activities: addActivityCounts(await readActivities(env), photos),
        galleryUrl: activity.googleDriveFolderUrl || shareState.galleryUrl || "",
        stats: makeStats(photos)
      },
      201
    );
  }

  const adminActivityMatch = url.pathname.match(/^\/api\/admin\/activities\/([^/]+)$/);
  if (adminActivityMatch && request.method === "DELETE") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const result = await deleteActivity(env, decodeURIComponent(adminActivityMatch[1]));
    return json(result, result.ok ? 200 : 400);
  }

  if (url.pathname === "/api/admin/photos" && request.method === "POST") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const body = await request.json();
    const activities = await readActivities(env);
    const activity = activities.find((item) => item.id === body.activityId);

    if (!activity) {
      return json({ error: "Please select an activity before uploading." }, 400);
    }

    const record = await saveUploadedPhoto(env, body, activity);
    const photos = await readPhotos(env);
    return json(
      {
        photo: adminPhoto(record),
        activities: addActivityCounts(activities, photos),
        stats: makeStats(photos)
      },
      201
    );
  }

  if (url.pathname === "/api/admin/photos" && request.method === "GET") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const activityId = url.searchParams.get("activityId") || "";
    const photos = await readPhotos(env);
    const filteredPhotos = activityId
      ? photos.filter((photo) => photo.activityId === activityId)
      : photos;
    return json({
      photos: filteredPhotos
        .slice()
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
        .map(adminPhoto),
      stats: makeStats(filteredPhotos)
    });
  }

  const adminPhotoMatch = url.pathname.match(/^\/api\/admin\/photos\/([^/]+)$/);
  if (adminPhotoMatch && request.method === "PATCH") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const body = await request.json().catch(() => ({}));
    const result = await updateManualPhotoLink(env, adminPhotoMatch[1], body.googlePhotoUrl || body.productUrl || "");
    return json(result, result.ok ? 200 : 404);
  }

  if (adminPhotoMatch && request.method === "DELETE") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const result = await deletePhoto(env, adminPhotoMatch[1]);
    return json(result, result.ok ? 200 : 404);
  }

  if (url.pathname === "/api/admin/google-drive" && request.method === "GET") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    await ensureDefaultActivityDriveFolder(env);
    const photos = await readPhotos(env);
    const summary = await makeGoogleDriveSummary(env, photos);
    await updateShareGalleryFromDrive(env, summary.folderUrl);
    return json({ googleDrive: summary });
  }

  if (url.pathname === "/api/admin/google-drive/config" && request.method === "GET") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    return json({ config: await publicGoogleDriveConfig(request, env) });
  }

  if (url.pathname === "/api/admin/google-drive/config" && request.method === "PATCH") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const body = await request.json().catch(() => ({}));
    const result = await updateGoogleDriveRuntimeConfig(env, body);
    await ensureDefaultActivityDriveFolder(env);
    const photos = await readPhotos(env);
    const summary = await makeGoogleDriveSummary(env, photos);
    await updateShareGalleryFromDrive(env, summary.folderUrl);
    return json(
      {
        ...result,
        config: await publicGoogleDriveConfig(request, env),
        googleDrive: summary
      },
      result.ok ? 200 : 400
    );
  }

  if (url.pathname === "/api/admin/google-drive/connect" && request.method === "GET") {
    if (!(await isAuthenticated(request, env))) {
      return Response.redirect(`${url.origin}/admin.html`, 302);
    }
    return redirectToGoogleDriveOAuth(request, env, url);
  }

  if (url.pathname === "/api/google-drive/oauth/callback" && request.method === "GET") {
    return handleGoogleDriveOAuthCallback(request, env, url);
  }

  if (url.pathname === "/api/admin/google-drive/sync" && request.method === "POST") {
    if (!(await isAuthenticated(request, env))) return unauthorized();
    const result = await syncGoogleDriveBacklog(env);
    return json(result, result.ok ? 200 : 400);
  }

  return json({ error: "Not found" }, 404);
}

async function serveAsset(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  return env.ASSETS.fetch(new Request(url, { method: "GET", headers: request.headers }));
}

async function serveSharedUserPage(request, env, url) {
  const token = url.pathname.replace(/^\/s\/+/, "").split("/")[0];
  const shareState = await readShareState(env);

  if (!token || token !== shareState.token) {
    return new Response("Not found", { status: 404 });
  }

  return serveAsset(request, env, "/user.html");
}

async function serveDriveImage(request, env, url) {
  const fileId = url.pathname.replace(/^\/api\/drive-image\//, "").split("/")[0];
  if (!fileId) {
    return new Response("Not found", { status: 404 });
  }

  const config = await getGoogleDriveConfig(env);
  if (!config.configured) {
    return new Response("Google Drive is not configured", { status: 400 });
  }

  const accessToken = await getGoogleDriveAccessToken(config);
  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!driveResponse.ok) {
    return new Response("Image not found", { status: driveResponse.status });
  }

  const headers = new Headers(driveResponse.headers);
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(driveResponse.body, {
    status: 200,
    headers
  });
}

async function createActivity(env, name) {
  const activities = await readActivities(env);
  const activity = {
    id: crypto.randomUUID(),
    name,
    slug: makeActivitySlug(name),
    createdAt: Date.now()
  };

  activities.push(activity);
  await writeJson(env, DATA_KEYS.activities, activities);
  await createGoogleDriveFolderForActivity(env, activity, activities);
  return activity;
}

async function saveUploadedPhoto(env, body, activity) {
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
  const imageBytes = base64ToBytes(match[2]);

  const record = {
    id,
    name: sanitizeText(body.name, "activity-photo"),
    type: mimeType,
    size: Number(body.size || imageBytes.byteLength),
    lastModified: Number(body.lastModified || Date.now()),
    createdAt: Date.now(),
    width: Number(body.width || 0),
    height: Number(body.height || 0),
    fileName,
    activityId: activity.id,
    activityName: activity.name,
    activitySlug: activity.slug,
    imageUrl: "",
    faces: body.faces.map(normalizeFace).filter(Boolean)
  };

  record.googleDrive = await mirrorPhotoToGoogleDrive(env, record, imageBytes, {
    fileName,
    mimeType
  });

  if (record.googleDrive?.fileId) {
    record.imageUrl = `/api/drive-image/${record.googleDrive.fileId}`;
  } else {
    record.imageUrl = "";
  }

  const photos = await readPhotos(env);
  photos.push(record);
  await writeJson(env, DATA_KEYS.photos, photos);
  return record;
}

async function updateManualPhotoLink(env, photoId, urlValue) {
  const photos = await readPhotos(env);
  const photo = photos.find((item) => item.id === photoId);

  if (!photo) {
    return { ok: false, error: "Photo not found" };
  }

  const productUrl = sanitizeOptionalUrl(urlValue);
  if (String(urlValue || "").trim() && !productUrl) {
    return { ok: false, error: "Only http or https links are allowed" };
  }

  photo.googlePhotos = productUrl
    ? {
        status: "manual",
        mediaItemId: "",
        productUrl,
        syncedAt: 0,
        updatedAt: Date.now()
      }
    : {
        status: "unsynced",
        productUrl: "",
        updatedAt: Date.now()
      };

  await writeJson(env, DATA_KEYS.photos, photos);
  return { ok: true, photo: adminPhoto(photo) };
}

async function deletePhoto(env, photoId) {
  const photos = await readPhotos(env);
  const index = photos.findIndex((photo) => photo.id === photoId);

  if (index === -1) {
    return { ok: false, error: "Photo not found" };
  }

  const [photo] = photos.splice(index, 1);
  await deleteGoogleDriveFile(env, photo.googleDrive?.fileId);
  await writeJson(env, DATA_KEYS.photos, photos);

  return {
    ok: true,
    id: photoId,
    stats: makeStats(photos)
  };
}

async function deleteActivity(env, activityId) {
  const activities = await readActivities(env);
  const activity = activities.find((item) => item.id === activityId);

  if (!activity) {
    return { ok: false, error: "Activity not found" };
  }

  if (activity.id === DEFAULT_ACTIVITY.id) {
    return { ok: false, error: "Default activity cannot be deleted" };
  }

  const photos = await readPhotos(env);
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
    await deleteGoogleDriveFile(env, photo.googleDrive?.fileId);
  }
  await deleteGoogleDriveFile(env, activity.googleDriveFolderId);

  const nextActivities = activities.filter((item) => item.id !== activity.id);
  await writeJson(env, DATA_KEYS.photos, keptPhotos);
  await writeJson(env, DATA_KEYS.activities, nextActivities);

  return {
    ok: true,
    id: activity.id,
    deletedPhotos: removedPhotos.length,
    activities: addActivityCounts(nextActivities, keptPhotos),
    stats: makeStats(keptPhotos)
  };
}

async function syncGoogleDriveBacklog(env) {
  const photos = await readPhotos(env);
  const summary = await makeGoogleDriveSummary(env, photos);

  if (summary.state !== "ready") {
    return {
      ok: false,
      error: "Google Drive is not configured",
      googleDrive: summary
    };
  }

  return {
    ok: true,
    synced: 0,
    failed: 0,
    skipped: photos.length,
    googleDrive: summary
  };
}

async function mirrorPhotoToGoogleDrive(env, photo, imageBytes, options = {}) {
  const config = await getGoogleDriveConfig(env);

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
    const accessToken = await getGoogleDriveAccessToken(config);
    const folder = await getGoogleDrivePhotoFolder(env, photo, config, accessToken);
    const file = await uploadGoogleDriveFile(accessToken, {
      imageBytes,
      mimeType: options.mimeType || photo.type || "image/jpeg",
      fileName: sanitizeGoogleDriveFileName(options.fileName || photo.fileName || photo.name),
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

async function getGoogleDrivePhotoFolder(env, photo, config, accessToken) {
  const activities = await readActivities(env);
  const activity = activities.find((item) => item.id === photo.activityId);

  if (!activity) {
    return {
      id: config.folderId,
      url: config.folderUrl
    };
  }

  if (activity.googleDriveFolderId) {
    const folderExists = await googleDriveFolderExists(accessToken, activity.googleDriveFolderId);
    if (folderExists) {
      return {
        id: activity.googleDriveFolderId,
        url: activity.googleDriveFolderUrl || `https://drive.google.com/drive/folders/${activity.googleDriveFolderId}`
      };
    }

    delete activity.googleDriveFolderId;
    delete activity.googleDriveFolderUrl;
    delete activity.googleDriveFolderError;
  }

  const folder = await createGoogleDriveFolder(accessToken, {
    name: sanitizeGoogleDriveFolderName(activity.name || photo.activityName || "activity"),
    parentId: config.folderId
  });
  const folderId = folder.id || "";
  const folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;

  if (!folderId) {
    throw new Error("Google Drive did not create an activity folder.");
  }

  activity.googleDriveFolderId = folderId;
  activity.googleDriveFolderUrl = folderUrl;
  await writeJson(env, DATA_KEYS.activities, activities);
  await updateShareGalleryFromDrive(env, folderUrl);

  return {
    id: folderId,
    url: folderUrl
  };
}

async function createGoogleDriveFolderForActivity(env, activity, activities) {
  const config = await getGoogleDriveConfig(env);

  if (!activity || !config.enabled || !config.configured) {
    return { status: "skipped" };
  }

  try {
    const accessToken = await getGoogleDriveAccessToken(config);
    if (activity.googleDriveFolderId) {
      const folderExists = await googleDriveFolderExists(accessToken, activity.googleDriveFolderId);
      if (folderExists) {
        return {
          status: "saved",
          folderId: activity.googleDriveFolderId,
          folderUrl:
            activity.googleDriveFolderUrl ||
            `https://drive.google.com/drive/folders/${activity.googleDriveFolderId}`
        };
      }

      delete activity.googleDriveFolderId;
      delete activity.googleDriveFolderUrl;
      delete activity.googleDriveFolderError;
    }

    const folder = await createGoogleDriveFolder(accessToken, {
      name: sanitizeGoogleDriveFolderName(activity.name || "activity"),
      parentId: config.folderId
    });
    const folderId = folder.id || "";
    const folderUrl = folder.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;

    if (!folderId) {
      throw new Error("Google Drive did not create an activity folder.");
    }

    activity.googleDriveFolderId = folderId;
    activity.googleDriveFolderUrl = folderUrl;
    delete activity.googleDriveFolderError;
    await writeJson(env, DATA_KEYS.activities, activities);
    await updateShareGalleryFromDrive(env, folderUrl);

    return {
      status: "saved",
      folderId,
      folderUrl
    };
  } catch (error) {
    console.error("Google Drive activity folder creation failed:", error);
    activity.googleDriveFolderError = sanitizeGoogleError(error);
    await writeJson(env, DATA_KEYS.activities, activities);
    return {
      status: "failed",
      error: activity.googleDriveFolderError
    };
  }
}

async function getGoogleDriveConfig(env) {
  const runtimeConfig = await readJson(env, DATA_KEYS.driveConfig, {});
  const clientId =
    env.GOOGLE_DRIVE_CLIENT_ID ||
    env.GOOGLE_CLIENT_ID ||
    runtimeConfig.clientId ||
    "";
  const clientSecret =
    env.GOOGLE_DRIVE_CLIENT_SECRET ||
    env.GOOGLE_CLIENT_SECRET ||
    runtimeConfig.clientSecret ||
    "";
  const refreshToken =
    env.GOOGLE_DRIVE_REFRESH_TOKEN ||
    env.GOOGLE_REFRESH_TOKEN ||
    runtimeConfig.refreshToken ||
    runtimeConfig.refresh_token ||
    "";
  const folderId = extractGoogleDriveFolderId(
    env.GOOGLE_DRIVE_FOLDER_ID ||
      runtimeConfig.folderId ||
      runtimeConfig.folderUrl ||
      ""
  );
  const enabled = boolFrom(
    env.GOOGLE_DRIVE_ENABLED ?? runtimeConfig.enabled,
    Boolean(folderId && clientId && clientSecret && refreshToken)
  );

  return {
    enabled,
    clientId,
    clientSecret,
    refreshToken,
    folderId,
    folderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : "",
    oauthConfigured: Boolean(clientId && clientSecret),
    connected: Boolean(refreshToken),
    authMode: refreshToken ? "oauth" : clientId && clientSecret ? "oauth_pending" : "none",
    configured: Boolean(folderId && clientId && clientSecret && refreshToken),
    usingEnv: Boolean(
      env.GOOGLE_DRIVE_CLIENT_ID ||
        env.GOOGLE_CLIENT_ID ||
        env.GOOGLE_DRIVE_CLIENT_SECRET ||
        env.GOOGLE_CLIENT_SECRET ||
        env.GOOGLE_DRIVE_REFRESH_TOKEN ||
        env.GOOGLE_REFRESH_TOKEN ||
        env.GOOGLE_DRIVE_FOLDER_ID
    )
  };
}

async function publicGoogleDriveConfig(request, env) {
  const config = await getGoogleDriveConfig(env);
  return {
    enabled: config.enabled,
    clientId: config.clientId || "",
    hasClientSecret: Boolean(config.clientSecret),
    connected: config.connected,
    authMode: config.authMode,
    redirectUri: `${new URL(request.url).origin}/api/google-drive/oauth/callback`,
    folderId: config.folderId,
    folderUrl: config.folderUrl,
    hasServiceAccount: false,
    serviceAccountEmail: "",
    usingEnv: config.usingEnv
  };
}

async function updateGoogleDriveRuntimeConfig(env, body) {
  const next = await readJson(env, DATA_KEYS.driveConfig, {});
  next.enabled = Object.prototype.hasOwnProperty.call(body, "enabled")
    ? Boolean(body.enabled)
    : true;

  if (Object.prototype.hasOwnProperty.call(body, "folderId")) {
    next.folderId = extractGoogleDriveFolderId(body.folderId);
  }

  if (Object.prototype.hasOwnProperty.call(body, "clientId")) {
    const clientId = sanitizeConfigValue(body.clientId);
    if (clientId) next.clientId = clientId;
  }

  if (Object.prototype.hasOwnProperty.call(body, "clientSecret")) {
    const clientSecret = sanitizeConfigValue(body.clientSecret);
    if (clientSecret) next.clientSecret = clientSecret;
  }

  await writeJson(env, DATA_KEYS.driveConfig, next);

  const config = await getGoogleDriveConfig(env);
  if (!config.folderId) {
    return { ok: false, error: "Please enter a Google Drive Folder ID or URL." };
  }

  if (!config.clientId || !config.clientSecret) {
    return { ok: false, error: "Google Drive Client ID and Client Secret are missing." };
  }

  return { ok: true };
}

async function makeGoogleDriveSummary(env, photos) {
  const config = await getGoogleDriveConfig(env);
  let state = "ready";

  if (!config.folderId || !config.oauthConfigured) {
    state = "not_configured";
  } else if (!config.connected) {
    state = "not_connected";
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
    connected: config.connected,
    oauthConfigured: config.oauthConfigured,
    authMode: config.authMode,
    serviceAccountEmail: "",
    total: photos.length,
    saved,
    failed,
    unsynced,
    syncUrl: "/api/admin/google-drive/sync"
  };
}

async function getGoogleDriveAccessToken(config) {
  if (!config.refreshToken) {
    throw new Error("Google Drive is not connected.");
  }

  if (
    driveTokenCache.token &&
    driveTokenCache.refreshToken === config.refreshToken &&
    driveTokenCache.expiresAt > Date.now() + 60 * 1000
  ) {
    return driveTokenCache.token;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token"
  }).toString();

  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!token.access_token) {
    throw new Error("Google did not return a Drive access token.");
  }

  driveTokenCache = {
    token: token.access_token,
    refreshToken: config.refreshToken,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
  };
  return token.access_token;
}

async function redirectToGoogleDriveOAuth(request, env, url) {
  const config = await getGoogleDriveConfig(env);

  if (!config.clientId || !config.clientSecret || !config.folderId) {
    return Response.redirect(`${url.origin}/admin.html?drive=missing_config`, 302);
  }

  const state = randomToken();
  const redirectUri = `${url.origin}/api/google-drive/oauth/callback`;
  const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  oauthUrl.searchParams.set("client_id", config.clientId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("scope", DRIVE_SCOPE);
  oauthUrl.searchParams.set("access_type", "offline");
  oauthUrl.searchParams.set("prompt", "consent");
  oauthUrl.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: oauthUrl.href,
      "Set-Cookie": cookie(DRIVE_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "Lax",
        maxAge: 600,
        secure: url.protocol === "https:"
      })
    }
  });
}

async function handleGoogleDriveOAuthCallback(request, env, url) {
  const expectedState = getCookie(request, DRIVE_STATE_COOKIE);
  const actualState = url.searchParams.get("state");
  const clearState = cookie(DRIVE_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 0,
    secure: url.protocol === "https:"
  });

  if (!expectedState || !actualState || expectedState !== actualState) {
    return redirectWithCookie(`${url.origin}/admin.html?drive=state_error`, clearState);
  }

  if (url.searchParams.get("error")) {
    return redirectWithCookie(`${url.origin}/admin.html?drive=oauth_error`, clearState);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return redirectWithCookie(`${url.origin}/admin.html?drive=missing_code`, clearState);
  }

  const config = await getGoogleDriveConfig(env);
  const redirectUri = `${url.origin}/api/google-drive/oauth/callback`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  }).toString();
  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const refreshToken = token.refresh_token || config.refreshToken || "";

  if (!refreshToken) {
    return redirectWithCookie(`${url.origin}/admin.html?drive=no_refresh_token`, clearState);
  }

  const runtimeConfig = await readJson(env, DATA_KEYS.driveConfig, {});
  runtimeConfig.refreshToken = refreshToken;
  await writeJson(env, DATA_KEYS.driveConfig, runtimeConfig);

  return redirectWithCookie(`${url.origin}/admin.html?drive=connected`, clearState);
}

function redirectWithCookie(location, cookieHeader) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie": cookieHeader
    }
  });
}

async function createGoogleDriveFolder(accessToken, options) {
  return requestJson(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify({
        name: options.name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [options.parentId]
      })
    }
  );
}

async function googleDriveFolderExists(accessToken, folderId) {
  if (!folderId) {
    return false;
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,mimeType,trashed`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (response.status === 404) {
    return false;
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = body.error?.message || body.error || response.statusText;
    throw new Error(message);
  }

  return body.mimeType === "application/vnd.google-apps.folder" && body.trashed !== true;
}

async function uploadGoogleDriveFile(accessToken, options) {
  const boundary = `sff_drive_${randomToken().slice(0, 24)}`;
  const metadata = {
    name: options.fileName,
    mimeType: options.mimeType,
    parents: [options.folderId]
  };
  const encoder = new TextEncoder();
  const start = encoder.encode(
    `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${options.mimeType}\r\n\r\n`
  );
  const end = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Blob([start, options.imageBytes, end], {
    type: `multipart/related; boundary=${boundary}`
  });

  return requestJson(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
}

async function deleteGoogleDriveFile(env, fileId) {
  if (!fileId) {
    return;
  }

  const config = await getGoogleDriveConfig(env);
  if (!config.configured) {
    return;
  }

  try {
    const accessToken = await getGoogleDriveAccessToken(config);
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
  } catch (error) {
    console.warn(`Could not delete Google Drive file ${fileId}: ${sanitizeGoogleError(error)}`);
  }
}

async function updateShareGalleryFromDrive(env, folderUrl) {
  if (!folderUrl) {
    return;
  }

  const shareState = await readShareState(env);
  shareState.galleryUrl = folderUrl;
  shareState.updatedAt = Date.now();
  await writeJson(env, DATA_KEYS.share, shareState);
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = body.error?.message || body.error_description || body.error || response.statusText;
    throw new Error(message);
  }

  return body;
}

async function readActivities(env) {
  const storedActivities = await readJson(env, DATA_KEYS.activities, []);
  const result = ensureDefaultActivity(Array.isArray(storedActivities) ? storedActivities : []);
  if (result.changed) {
    await writeJson(env, DATA_KEYS.activities, result.activities);
  }
  return result.activities;
}

async function ensureDefaultActivityDriveFolder(env) {
  const activities = await readActivities(env);
  const defaultActivity = activities.find((activity) => activity.id === DEFAULT_ACTIVITY.id);
  if (!defaultActivity) {
    return;
  }

  await createGoogleDriveFolderForActivity(env, defaultActivity, activities);
}

function ensureDefaultActivity(activities) {
  const next = activities
    .filter((activity) => activity && typeof activity === "object")
    .map((activity) => ({ ...activity }));
  const defaultIndex = next.findIndex(
    (activity) => activity.id === DEFAULT_ACTIVITY.id || activity.slug === DEFAULT_ACTIVITY.slug
  );
  let changed = false;

  if (defaultIndex === -1) {
    next.unshift({ ...DEFAULT_ACTIVITY });
    changed = true;
  } else {
    const current = next[defaultIndex];
    const normalized = {
      ...current,
      id: DEFAULT_ACTIVITY.id,
      name: DEFAULT_ACTIVITY.name,
      slug: DEFAULT_ACTIVITY.slug,
      createdAt: Number(current.createdAt || 0)
    };
    changed = JSON.stringify(current) !== JSON.stringify(normalized) || defaultIndex !== 0;
    next.splice(defaultIndex, 1);
    next.unshift(normalized);
  }

  return {
    activities: next.length ? next : [{ ...DEFAULT_ACTIVITY }],
    changed
  };
}

async function readPhotos(env) {
  const photos = await readJson(env, DATA_KEYS.photos, []);
  return Array.isArray(photos) ? photos : [];
}

async function readShareState(env) {
  const state = await readJson(env, DATA_KEYS.share, null);
  if (state?.token) {
    return {
      ...state,
      galleryUrl: sanitizeOptionalUrl(state.galleryUrl || state.googlePhotosUrl || ""),
      createdAt: Number(state.createdAt || 0) || Date.now(),
      updatedAt: Number(state.updatedAt || 0)
    };
  }

  const next = makeShareState();
  await writeJson(env, DATA_KEYS.share, next);
  return next;
}

async function readJson(env, key, fallback) {
  try {
    const value = await env.DATA.get(key, "json");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(env, key, value) {
  await env.DATA.put(key, JSON.stringify(value));
}

async function isAuthenticated(request, env) {
  const token = getCookie(request, ADMIN_COOKIE);
  if (!token) {
    return false;
  }
  return Boolean(await env.DATA.get(`session:${token}`));
}

function unauthorized() {
  return json({ error: "Admin login required" }, 401);
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const cookies = Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim().split("="))
      .filter((parts) => parts.length === 2)
  );
  return cookies[name] || "";
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/"];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeShareState(options = {}) {
  return {
    token: options.token || `${Date.now().toString(36)}${randomToken().slice(0, 14)}`,
    galleryUrl: sanitizeOptionalUrl(options.galleryUrl || ""),
    createdAt: Date.now(),
    updatedAt: Number(options.updatedAt || 0)
  };
}

async function makeShareLinkPayload(request, env, state = null) {
  const shareState = state || await readShareState(env);
  const pathName = `/s/${shareState.token}`;
  const url = `${new URL(request.url).origin}${pathName}`;
  return {
    token: shareState.token,
    path: pathName,
    displayUrl: `www.photobss${pathName}`,
    url,
    localUrl: url,
    galleryUrl: shareState.galleryUrl || "",
    createdAt: shareState.createdAt || 0,
    updatedAt: shareState.updatedAt || 0
  };
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
    facesCount: Array.isArray(photo.faces) ? photo.faces.length : 0,
    googleDrive: publicGoogleDriveState(photo.googleDrive),
    googlePhotos: publicGooglePhotoState(photo.googlePhotos)
  };
}

function searchPhoto(photo) {
  return adminPhoto(photo);
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

function findBestMatch(photo, descriptor, threshold) {
  const bestFace = (photo.faces || [])
    .filter((face) => Array.isArray(face.descriptor) && face.descriptor.length)
    .map((face) => ({
      face,
      distance: euclideanDistance(descriptor, face.descriptor)
    }))
    .sort((left, right) => left.distance - right.distance)[0];

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
      facesCount: activityPhotos.reduce((total, photo) => total + (photo.faces || []).length, 0)
    };
  });
}

function makeStats(photos) {
  return {
    photos: photos.length,
    faces: photos.reduce((total, photo) => total + (photo.faces || []).length, 0)
  };
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

function sanitizeText(value, fallback) {
  const text = String(value || fallback).trim();
  return text.slice(0, 180) || fallback;
}

function sanitizeOptionalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function sanitizeConfigValue(value) {
  return String(value || "").trim().slice(0, 500);
}

function sanitizeGoogleDriveFolderName(name) {
  const safeName = String(name || "activity")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()
    .slice(0, 180);
  return safeName || "activity";
}

function sanitizeGoogleDriveFileName(name) {
  const safeName = String(name || "photo.jpg")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()
    .slice(0, 180);
  return safeName || "photo.jpg";
}

function sanitizeGoogleError(error) {
  return String(error?.message || error || "Google Drive error").slice(0, 220);
}

function makeActivitySlug(name) {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "activity";
  return `${base}-${Date.now().toString(36)}-${randomToken().slice(0, 6)}`;
}

function extractGoogleDriveFolderId(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const folderMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return folderMatch[1];
  }

  try {
    const url = new URL(text);
    const id = url.searchParams.get("id");
    if (id) return id;
  } catch {}

  return text.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 180);
}

function boolFrom(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
    if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  }
  return fallback;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
