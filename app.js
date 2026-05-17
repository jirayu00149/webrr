const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";
const DEFAULT_THRESHOLD = 0.52;

const page = document.body.dataset.page || "user";
const $ = (selector) => document.querySelector(selector);

const els = {
  modelState: $("#modelState"),
  modelStateText: $("#modelStateText"),
  statusText: $("#statusText"),
  consentCheck: $("#consentCheck"),
  galleryInput: $("#galleryInput"),
  galleryDropzone: $("#galleryDropzone"),
  savePhotosBtn: $("#savePhotosBtn"),
  queueList: $("#queueList"),
  referenceInput: $("#referenceInput"),
  referencePreview: $("#referencePreview"),
  referencePlaceholder: $("#referencePlaceholder"),
  thresholdInput: $("#thresholdInput"),
  thresholdValue: $("#thresholdValue"),
  searchBtn: $("#searchBtn"),
  exportBtn: $("#exportBtn"),
  photoCount: $("#photoCount"),
  matchCount: $("#matchCount"),
  emptyState: $("#emptyState"),
  resultsGrid: $("#resultsGrid"),
  resultCardTemplate: $("#resultCardTemplate"),
  loginForm: $("#loginForm"),
  loginError: $("#loginError"),
  adminPassword: $("#adminPassword"),
  logoutBtn: $("#logoutBtn"),
  activityForm: $("#activityForm"),
  activityName: $("#activityName"),
  activitySelect: $("#activitySelect"),
  deleteActivityBtn: $("#deleteActivityBtn"),
  selectedActivityDrive: $("#selectedActivityDrive"),
  selectedActivityDriveName: $("#selectedActivityDriveName"),
  selectedActivityDriveState: $("#selectedActivityDriveState"),
  selectedActivityDriveLink: $("#selectedActivityDriveLink"),
  activityFilter: $("#activityFilter"),
  activityList: $("#activityList"),
  adminPhotoGrid: $("#adminPhotoGrid"),
  adminPhotoEmpty: $("#adminPhotoEmpty"),
  galleryLinkInput: $("#galleryLinkInput"),
  saveGalleryLinkBtn: $("#saveGalleryLinkBtn"),
  galleryLinkState: $("#galleryLinkState"),
  openGalleryLink: $("#openGalleryLink"),
  shareLink: $("#shareLink"),
  regenerateShareLinkBtn: $("#regenerateShareLinkBtn"),
  copyShareLinkBtn: $("#copyShareLinkBtn"),
  userSaveLink: $("#userSaveLink"),
  googleDriveState: $("#googleDriveState"),
  googleDriveSyncBtn: $("#googleDriveSyncBtn"),
  googleDriveServiceAccountInput: $("#googleDriveServiceAccountInput"),
  googleDriveClientIdInput: $("#googleDriveClientIdInput"),
  googleDriveClientSecretInput: $("#googleDriveClientSecretInput"),
  googleDriveFolderIdInput: $("#googleDriveFolderIdInput"),
  googleDriveRedirectUriInput: $("#googleDriveRedirectUriInput"),
  googleDriveFolderLink: $("#googleDriveFolderLink"),
  connectGoogleDriveBtn: $("#connectGoogleDriveBtn"),
  googleDriveSetupHint: $("#googleDriveSetupHint"),
  saveGoogleDriveConfigBtn: $("#saveGoogleDriveConfigBtn")
};

let modelsReady = false;
let referenceDescriptor = null;
let lastResults = [];
let activities = [];
let overallStats = { photos: 0, faces: 0 };
let currentStats = { photos: 0, faces: 0 };
let googleDriveStatus = null;
let adminPhotos = [];
let galleryLink = "";
let currentShareLinkText = "";
let currentShareLinkUrl = "";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  if (page === "login") {
    els.adminPassword?.focus();
    return;
  }

  try {
    await loadActivityIndex();
    if (page === "admin") {
      await loadShareLink();
      await loadGoogleDriveConfig();
      await loadGoogleDriveStatus();
      await loadAdminPhotos();
    }

    if (page === "admin" || page === "user") {
      setStatus("กำลังโหลดโมเดลตรวจจับใบหน้า กรุณารอสักครู่");
      await waitForFaceApi();
      await loadModels();
      modelsReady = true;
      setModelStatus("ready", "โมเดลพร้อมใช้งาน");
      setStatus(getReadyMessage());
      updateSearchButton();
    }
  } catch (error) {
    console.error(error);
    setModelStatus("error", "โหลดระบบไม่สำเร็จ");
    setStatus("โหลดระบบไม่สำเร็จ ตรวจสอบ server แล้วรีเฟรชหน้าอีกครั้ง");
  }
}

function bindEvents() {
  els.loginForm?.addEventListener("submit", handleLogin);
  els.logoutBtn?.addEventListener("click", handleLogout);
  els.activityForm?.addEventListener("submit", handleCreateActivity);
  els.deleteActivityBtn?.addEventListener("click", deleteSelectedActivity);
  els.saveGalleryLinkBtn?.addEventListener("click", saveGalleryLink);
  els.regenerateShareLinkBtn?.addEventListener("click", regenerateShareLink);
  els.copyShareLinkBtn?.addEventListener("click", copyShareLink);

  els.activitySelect?.addEventListener("change", () => {
    updateDeleteActivityButton();
    renderSelectedActivityDriveLink();
    loadAdminPhotos();
  });

  els.activityFilter?.addEventListener("change", () => {
    updateSelectedStats();
    renderUserSaveLink();
    updateSearchButton();
  });

  if (els.galleryInput) {
    els.galleryInput.addEventListener("change", (event) => {
      handleGalleryFiles(event.target.files);
      event.target.value = "";
    });
  }

  els.savePhotosBtn?.addEventListener("click", () => {
    els.galleryInput?.click();
  });

  if (els.galleryDropzone) {
    ["dragenter", "dragover"].forEach((name) => {
      els.galleryDropzone.addEventListener(name, (event) => {
        event.preventDefault();
        els.galleryDropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((name) => {
      els.galleryDropzone.addEventListener(name, (event) => {
        event.preventDefault();
        els.galleryDropzone.classList.remove("dragover");
      });
    });

    els.galleryDropzone.addEventListener("drop", (event) => {
      handleGalleryFiles(event.dataTransfer.files);
    });
  }

  if (els.referenceInput) {
    els.referenceInput.addEventListener("change", (event) => {
      handleReferenceFile(event.target.files[0]);
      event.target.value = "";
    });
  }

  if (els.thresholdInput && els.thresholdValue) {
    els.thresholdInput.addEventListener("input", () => {
      els.thresholdValue.textContent = Number(els.thresholdInput.value).toFixed(2);
    });
  }

  els.searchBtn?.addEventListener("click", searchMatches);
  els.consentCheck?.addEventListener("change", updateSearchButton);
  els.exportBtn?.addEventListener("click", exportResults);
  els.googleDriveSyncBtn?.addEventListener("click", syncGoogleDriveBacklog);
  els.saveGoogleDriveConfigBtn?.addEventListener("click", saveGoogleDriveConfig);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeImageViewer();
    }
  });
}

async function handleLogin(event) {
  event.preventDefault();
  setLoginError("");

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: els.adminPassword?.value || "" })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setLoginError(body.error || "เข้าสู่ระบบไม่สำเร็จ");
      return;
    }

    window.location.href = "/admin.html";
  } catch {
    setLoginError("เชื่อมต่อ server ไม่สำเร็จ");
  }
}

async function handleLogout() {
  await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/admin.html";
}

async function handleCreateActivity(event) {
  event.preventDefault();
  const name = els.activityName?.value.trim();

  if (!name) {
    setStatus("กรุณากรอกชื่อกิจกรรมก่อนสร้างโฟลเดอร์");
    els.activityName?.focus();
    return;
  }

  try {
    const body = await apiPost("/api/admin/activities", { name });
    els.activityName.value = "";
    await loadActivityIndex();
    if (body.activity?.id && els.activitySelect) {
      els.activitySelect.value = body.activity.id;
      renderSelectedActivityDriveLink();
    }
    if (body.galleryUrl || body.activity?.googleDriveFolderUrl) {
      renderGalleryLink({
        galleryUrl: body.activity?.googleDriveFolderUrl || body.galleryUrl
      });
    }
    await loadAdminPhotos();
    if (body.activity?.googleDriveFolderUrl) {
      setStatus(`Created "${name}" and its Google Drive folder.`);
    } else if (body.activity?.googleDriveFolderError) {
      setStatus(`Created "${name}", but Drive folder failed: ${body.activity.googleDriveFolderError}`);
    } else {
      setStatus(`Created "${name}". Connect Google Drive to create Drive folders automatically.`);
    }
    return;
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    setStatus("สร้างโฟลเดอร์กิจกรรมไม่สำเร็จ");
  }
}

function waitForFaceApi() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (window.faceapi) {
        window.clearInterval(timer);
        resolve();
      }

      if (attempts > 80) {
        window.clearInterval(timer);
        reject(new Error("face-api.js did not load"));
      }
    }, 100);
  });
}

async function loadModels() {
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
}

async function loadActivityIndex() {
  const body = await apiGet("/api/activities");
  activities = Array.isArray(body.activities) ? body.activities : [];
  galleryLink = body.galleryUrl || galleryLink || "";
  overallStats = body.stats || { photos: 0, faces: 0 };
  renderActivityControls();
  updateSelectedStats();
  renderUserSaveLink();
}

async function loadShareLink() {
  if (!els.shareLink) {
    return;
  }

  try {
    const body = await apiGet("/api/admin/share-link");
    renderShareLink(body);
    renderGalleryLink(body);
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    els.shareLink.textContent = "สร้างลิงก์แจกไม่สำเร็จ";
    els.shareLink.removeAttribute("href");
  }
}

async function regenerateShareLink() {
  if (!els.regenerateShareLinkBtn) {
    return;
  }

  els.regenerateShareLinkBtn.disabled = true;
  try {
    const body = await apiPost("/api/admin/share-link/regenerate", {});
    renderShareLink(body);
    renderGalleryLink(body);
    setStatus("สร้างลิงก์แจกแบบสุ่มใหม่แล้ว");
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    setStatus(error.message || "สร้างลิงก์แจกใหม่ไม่สำเร็จ");
  } finally {
    els.regenerateShareLinkBtn.disabled = false;
  }
}

async function saveGalleryLink() {
  if (!els.saveGalleryLinkBtn) {
    return;
  }

  const value = els.galleryLinkInput?.value.trim() || "";
  els.saveGalleryLinkBtn.disabled = true;

  try {
    const body = await apiPatch("/api/admin/share-link", { galleryUrl: value });
    renderShareLink(body);
    renderGalleryLink(body);
    setStatus(
      body.galleryUrl
        ? "ตั้งค่าลิงก์รวมแล้ว"
        : "ล้างลิงก์รวมแล้ว"
    );
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    setStatus(error.message || "ตั้งค่าลิงก์รวมไม่สำเร็จ");
  } finally {
    els.saveGalleryLinkBtn.disabled = false;
  }
}

function renderShareLink(body) {
  if (!els.shareLink) {
    return;
  }

  currentShareLinkText = body.displayUrl || body.url || body.path || "user.html";
  currentShareLinkUrl = body.url || body.localUrl || body.path || "user.html";
  els.shareLink.href = currentShareLinkUrl;
  els.shareLink.textContent = currentShareLinkText;
}

function renderGalleryLink(body = {}) {
  galleryLink = body.galleryUrl || "";

  if (els.galleryLinkInput) {
    els.galleryLinkInput.value = galleryLink;
  }

  if (els.galleryLinkState) {
    els.galleryLinkState.textContent = galleryLink
      ? "ผู้ใช้จะเห็นปุ่มบันทึก/เปิดลิงก์รวมนี้ในหน้า user"
      : "ยังไม่ได้ใส่ลิงก์รวม";
  }

  if (els.openGalleryLink) {
    els.openGalleryLink.href = galleryLink || "#";
    els.openGalleryLink.classList.toggle("hidden", !galleryLink);
  }

  renderUserSaveLink();
}

async function copyShareLink() {
  const url = currentShareLinkUrl || els.shareLink?.href || "";
  if (!url) {
    return;
  }

  try {
    await writeClipboardText(url);
    setStatus("คัดลอกลิงก์แจกแล้ว");
  } catch {
    setStatus("คัดลอกลิงก์ไม่สำเร็จ");
  }
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();

  if (!copied) {
    throw new Error("Copy failed");
  }
}

function renderUserSaveLink() {
  if (!els.userSaveLink) {
    return;
  }

  const selectedActivity = getSelectedFilterActivity();
  const selectedLink = selectedActivity?.googleDriveFolderUrl || "";
  const link = selectedLink || galleryLink || "";

  els.userSaveLink.href = link || "#";
  els.userSaveLink.textContent = selectedLink
    ? `Open ${selectedActivity.name} in Google Drive`
    : "Open Google Drive folder";
  els.userSaveLink.classList.toggle("hidden", !link);
}

function getSelectedFilterActivity() {
  const activityId = els.activityFilter?.value || "all";
  if (activityId === "all") {
    return null;
  }
  return activities.find((activity) => activity.id === activityId) || null;
}

async function loadGoogleDriveConfig() {
  if (!els.googleDriveClientIdInput && !els.googleDriveServiceAccountInput) {
    return;
  }

  try {
    const body = await apiGet("/api/admin/google-drive/config");
    renderGoogleDriveConfig(body.config || {});
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
    }
  }
}

function renderGoogleDriveConfig(config) {
  if (els.googleDriveClientIdInput) {
    els.googleDriveClientIdInput.value = config.clientId || "";
  }

  if (els.googleDriveClientSecretInput) {
    els.googleDriveClientSecretInput.value = "";
    els.googleDriveClientSecretInput.placeholder = config.hasClientSecret
      ? "Client secret saved. Leave blank to keep it."
      : "Paste Google Drive client secret";
  }

  if (els.googleDriveServiceAccountInput) {
    els.googleDriveServiceAccountInput.value = "";
    els.googleDriveServiceAccountInput.placeholder = config.hasServiceAccount
      ? "ตั้ง Service Account แล้ว เว้นว่างไว้ถ้าไม่เปลี่ยน"
      : "วาง JSON key ของ Service Account ที่นี่";
  }

  if (els.googleDriveFolderIdInput) {
    els.googleDriveFolderIdInput.value = config.folderId || "";
  }

  if (els.googleDriveRedirectUriInput) {
    els.googleDriveRedirectUriInput.value = config.redirectUri || "";
  }

  if (els.googleDriveFolderLink) {
    els.googleDriveFolderLink.href = config.folderUrl || "#";
    els.googleDriveFolderLink.classList.toggle("hidden", !config.folderUrl);
  }

  if (els.connectGoogleDriveBtn) {
    els.connectGoogleDriveBtn.classList.toggle(
      "hidden",
      !config.clientId || !config.hasClientSecret || !config.folderId || config.connected
    );
  }

  renderGoogleDriveSetupHint(config);
}

function renderGoogleDriveSetupHint(config = {}) {
  if (!els.googleDriveSetupHint) {
    return;
  }

  const missing = [];
  if (!config.clientId) missing.push("Client ID");
  if (!config.hasClientSecret) missing.push("Client Secret");
  if (!config.folderId) missing.push("Drive folder");

  if (missing.length) {
    els.googleDriveSetupHint.textContent =
      `Missing on this Render server: ${missing.join(", ")}. Paste the real values here and click Save Drive.`;
    return;
  }

  if (!config.connected) {
    els.googleDriveSetupHint.textContent =
      "Settings saved. Add the Authorized redirect URI above in Google Cloud, then click Connect Google Drive.";
    return;
  }

  els.googleDriveSetupHint.textContent = "Google Drive is connected.";
}

async function saveGoogleDriveConfig() {
  if (!els.saveGoogleDriveConfigBtn) {
    return;
  }

  const payload = {
    folderId: els.googleDriveFolderIdInput?.value.trim() || "",
    enabled: true
  };
  const clientId = els.googleDriveClientIdInput?.value.trim() || "";
  const clientSecret = els.googleDriveClientSecretInput?.value.trim() || "";
  const serviceAccountJson = els.googleDriveServiceAccountInput?.value.trim() || "";

  if (clientId) payload.clientId = clientId;
  if (clientSecret) payload.clientSecret = clientSecret;
  if (serviceAccountJson) payload.serviceAccountJson = serviceAccountJson;

  els.saveGoogleDriveConfigBtn.disabled = true;
  els.saveGoogleDriveConfigBtn.textContent = "กำลังตั้งค่า...";

  try {
    const body = await apiPatch("/api/admin/google-drive/config", payload);
    renderGoogleDriveConfig(body.config || {});
    googleDriveStatus = body.googleDrive || googleDriveStatus;
    galleryLink = body.googleDrive?.folderUrl || galleryLink;
    renderGalleryLink({ galleryUrl: galleryLink });
    renderGoogleDriveStatus();
    setStatus("ตั้งค่า Google Drive แล้ว");
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    setStatus(error.message || "ตั้งค่า Google Drive ไม่สำเร็จ");
  } finally {
    els.saveGoogleDriveConfigBtn.disabled = false;
    els.saveGoogleDriveConfigBtn.textContent = "บันทึก Drive";
  }
}

async function loadGoogleDriveStatus() {
  if (!els.googleDriveState) {
    return;
  }

  try {
    const body = await apiGet("/api/admin/google-drive");
    googleDriveStatus = body.googleDrive || null;
    renderGoogleDriveStatus();
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    googleDriveStatus = { state: "error" };
    renderGoogleDriveStatus();
  }
}

function renderGoogleDriveStatus() {
  if (!els.googleDriveState) {
    return;
  }

  const status = googleDriveStatus || { state: "loading" };
  const counts = Number.isFinite(status.total)
    ? ` เก็บใน Drive แล้ว ${status.saved}/${status.total} รูป`
    : "";
  const failed = status.failed ? `, ไม่สำเร็จ ${status.failed} รูป` : "";
  const messages = {
    ready: `พร้อมซิงก์ Google Drive.${counts}${failed}`,
    not_configured: "ยังไม่ได้ตั้งค่า Google Drive: วาง Service Account JSON และโฟลเดอร์หลักก่อน",
    disabled: "ปิดการซิงก์ Google Drive อยู่",
    error: "อ่านสถานะ Google Drive ไม่สำเร็จ",
    loading: "กำลังตรวจสถานะ Google Drive"
  };

  els.googleDriveState.textContent = messages[status.state] || messages.loading;

  if (els.googleDriveSyncBtn) {
    els.googleDriveSyncBtn.disabled =
      status.state !== "ready" || !status.unsynced || status.unsynced < 1;
    els.googleDriveSyncBtn.textContent =
      status.state === "not_configured"
        ? "ต้องตั้งค่า Google Drive ก่อน"
        : status.unsynced
          ? `ซิงก์รูปที่ค้าง (${status.unsynced})`
          : "ซิงก์รูปที่ค้าง";
  }
}

async function syncGoogleDriveBacklog() {
  if (!els.googleDriveSyncBtn) {
    return;
  }

  els.googleDriveSyncBtn.disabled = true;
  els.googleDriveSyncBtn.textContent = "กำลังซิงก์...";
  setStatus("กำลังซิงก์รูปที่ค้างไป Google Drive");

  try {
    const body = await apiPost("/api/admin/google-drive/sync", {});
    googleDriveStatus = body.googleDrive || googleDriveStatus;
    renderGoogleDriveStatus();
    setStatus(`ซิงก์ Google Drive แล้ว ${body.synced || 0} รูป, ไม่สำเร็จ ${body.failed || 0} รูป`);
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    await loadGoogleDriveStatus();
    setStatus(error.message || "ซิงก์ Google Drive ไม่สำเร็จ");
  }
}

function renderGoogleDriveStatus() {
  if (!els.googleDriveState) {
    return;
  }

  const status = googleDriveStatus || { state: "loading" };
  const counts = Number.isFinite(status.total)
    ? ` Saved ${status.saved}/${status.total} photos`
    : "";
  const failed = status.failed ? `, failed ${status.failed}` : "";
  const messages = {
    ready: `Google Drive is ready.${counts}${failed}`,
    not_configured: "Google Drive is not configured: add Client ID, Client Secret, and one Drive folder.",
    not_connected: "Drive settings are saved. Click Connect Google Drive once.",
    disabled: "Google Drive sync is disabled.",
    error: "Could not read Google Drive status.",
    loading: "Checking Google Drive status."
  };

  els.googleDriveState.textContent = messages[status.state] || messages.loading;

  if (els.googleDriveSyncBtn) {
    els.googleDriveSyncBtn.disabled =
      status.state !== "ready" || !status.unsynced || status.unsynced < 1;
    els.googleDriveSyncBtn.textContent =
      status.state === "not_configured" || status.state === "not_connected"
        ? "Set up Google Drive first"
        : status.unsynced
          ? `Sync Pending Photos (${status.unsynced})`
          : "Sync Pending Photos";
  }
}

async function loadAdminPhotos() {
  if (!els.adminPhotoGrid) {
    return;
  }

  const activityId = els.activitySelect?.value || "";
  const query = activityId ? `?activityId=${encodeURIComponent(activityId)}` : "";

  try {
    const body = await apiGet(`/api/admin/photos${query}`);
    adminPhotos = Array.isArray(body.photos) ? body.photos : [];
    renderAdminPhotos();
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    adminPhotos = [];
    renderAdminPhotos();
    setStatus(error.message || "โหลดรายการรูปไม่สำเร็จ");
  }
}

function renderAdminPhotos() {
  if (!els.adminPhotoGrid) {
    return;
  }

  els.adminPhotoGrid.innerHTML = "";
  els.adminPhotoEmpty?.classList.toggle("hidden", adminPhotos.length > 0);

  for (const photo of adminPhotos) {
    els.adminPhotoGrid.append(createAdminPhotoCard(photo));
  }
}

function createAdminPhotoCard(photo) {
  const card = document.createElement("article");
  const media = document.createElement("div");
  const image = document.createElement("img");
  const body = document.createElement("div");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  const actions = document.createElement("div");
  const deleteButton = document.createElement("button");

  card.className = "admin-photo-card";
  media.className = "admin-photo-media";
  body.className = "admin-photo-body";
  actions.className = "admin-photo-actions";
  deleteButton.className = "ghost-button";

  image.src = photo.imageUrl;
  image.alt = photo.name;
  addImageControls(media, image, photo);
  title.textContent = photo.name;
  meta.textContent = `${photo.activityName || "กิจกรรม"} · ${photo.facesCount || 0} ใบหน้า`;
  deleteButton.type = "button";
  deleteButton.textContent = "ลบรูป";

  deleteButton.addEventListener("click", () => deleteAdminPhoto(photo));

  media.append(image);
  actions.append(deleteButton);
  body.append(title, meta, actions);
  card.append(media, body);
  return card;
}

async function deleteAdminPhoto(photo) {
  if (!window.confirm(`ลบรูป "${photo.name}" ออกจากเว็บ?`)) {
    return;
  }

  try {
    await apiDelete(`/api/admin/photos/${encodeURIComponent(photo.id)}`);
    await loadActivityIndex();
    if (els.activitySelect) {
      els.activitySelect.value = photo.activityId;
    }
    await loadAdminPhotos();
    await loadGoogleDriveStatus();
    setStatus("ลบรูปแล้ว");
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    setStatus(error.message || "ลบรูปไม่สำเร็จ");
  }
}

async function deleteSelectedActivity() {
  const activityId = els.activitySelect?.value || "";
  const activity = activities.find((item) => item.id === activityId);

  if (!activity) {
    setStatus("กรุณาเลือกโฟลเดอร์กิจกรรมก่อนลบ");
    return;
  }

  if (activity.id === "general") {
    setStatus("ลบโฟลเดอร์เริ่มต้นไม่ได้");
    return;
  }

  if (!window.confirm(`ลบโฟลเดอร์ "${activity.name}" พร้อมรูปทั้งหมด?`)) {
    return;
  }

  try {
    await apiDelete(`/api/admin/activities/${encodeURIComponent(activity.id)}`);
    await loadActivityIndex();
    await loadAdminPhotos();
    await loadGoogleDriveStatus();
    setStatus(`ลบโฟลเดอร์ "${activity.name}" แล้ว`);
  } catch (error) {
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return;
    }
    setStatus(error.message || "ลบโฟลเดอร์ไม่สำเร็จ");
  }
}

function renderActivityControls() {
  const currentUploadActivity = els.activitySelect?.value || "";
  const currentFilter = els.activityFilter?.value || "all";

  if (els.activitySelect) {
    els.activitySelect.innerHTML = activities
      .map((activity) => {
        const driveLabel = activity.googleDriveFolderUrl ? " · มีลิงก์ Drive" : "";
        return `<option value="${escapeHtml(activity.id)}">${escapeHtml(activity.name)}${driveLabel}</option>`;
      })
      .join("");
    if (activities.some((activity) => activity.id === currentUploadActivity)) {
      els.activitySelect.value = currentUploadActivity;
    }
  }

  if (els.activityFilter) {
    els.activityFilter.innerHTML = [
      `<option value="all">ทุกกิจกรรม (${overallStats.photos} รูป)</option>`,
      ...activities.map(
        (activity) =>
          `<option value="${escapeHtml(activity.id)}">${escapeHtml(activity.name)} (${activity.photosCount} รูป)</option>`
      )
    ].join("");
    els.activityFilter.value = activities.some((activity) => activity.id === currentFilter)
      ? currentFilter
      : "all";
  }

  if (els.activityList) {
    els.activityList.innerHTML = activities
      .map(
        (activity) =>
          `<span>${escapeHtml(activity.name)} · ${activity.photosCount} รูป · ${activity.facesCount} ใบหน้า</span>`
      )
      .join("");
  }
  renderActivityListLinks();
  updateDeleteActivityButton();
  renderSelectedActivityDriveLink();
}

function updateDeleteActivityButton() {
  if (!els.deleteActivityBtn) {
    return;
  }

  const selected = activities.find((activity) => activity.id === (els.activitySelect?.value || ""));
  els.deleteActivityBtn.disabled = !selected || selected.id === "general";
}

function renderActivityListLinks() {
  if (!els.activityList) {
    return;
  }

  els.activityList.innerHTML = "";

  for (const activity of activities) {
    const row = document.createElement("div");
    row.className = "activity-chip";

    const meta = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    title.textContent = activity.name;
    detail.textContent = `${activity.photosCount} รูป · ${activity.facesCount} ใบหน้า`;
    meta.append(title, detail);

    if (activity.googleDriveFolderUrl) {
      const link = document.createElement("a");
      link.className = "activity-drive-pill";
      link.href = activity.googleDriveFolderUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "เปิด Drive";
      row.append(meta, link);
    } else {
      const pending = document.createElement("span");
      pending.className = "activity-drive-pill pending";
      pending.textContent = "ยังไม่มีลิงก์ Drive";
      row.append(meta, pending);
    }

    els.activityList.append(row);
  }
}

function renderSelectedActivityDriveLink() {
  if (!els.selectedActivityDrive) {
    return;
  }

  const selected = activities.find((activity) => activity.id === (els.activitySelect?.value || ""));
  els.selectedActivityDrive.classList.toggle("hidden", !selected);

  if (!selected) {
    return;
  }

  const folderUrl = selected.googleDriveFolderUrl || "";
  if (els.selectedActivityDriveName) {
    els.selectedActivityDriveName.textContent = selected.name;
  }

  if (els.selectedActivityDriveState) {
    els.selectedActivityDriveState.textContent = folderUrl
      ? "โฟลเดอร์นี้เชื่อมกับ Google Drive แล้ว"
      : selected.googleDriveFolderError
        ? `สร้างลิงก์ Drive ไม่สำเร็จ: ${selected.googleDriveFolderError}`
        : "ยังไม่มีลิงก์ Drive สำหรับโฟลเดอร์นี้";
  }

  if (els.selectedActivityDriveLink) {
    els.selectedActivityDriveLink.href = folderUrl || "#";
    els.selectedActivityDriveLink.classList.toggle("hidden", !folderUrl);
  }
}

function updateSelectedStats() {
  const activityId = els.activityFilter?.value || "all";
  const selectedActivity = activities.find((activity) => activity.id === activityId);
  currentStats =
    activityId === "all" || !selectedActivity
      ? overallStats
      : {
          photos: selectedActivity.photosCount,
          faces: selectedActivity.facesCount
        };

  if (els.photoCount) {
    els.photoCount.textContent = currentStats.photos;
  }
}

async function handleGalleryFiles(fileList) {
  if (!modelsReady) {
    setStatus("กรุณารอให้โมเดลพร้อมก่อนอัปโหลดรูป");
    return;
  }

  if (page !== "admin" && !els.consentCheck?.checked) {
    setStatus("กรุณายืนยันสิทธิ์การใช้รูปก่อนอัปโหลด");
    els.consentCheck?.focus();
    return;
  }

  const activityId = els.activitySelect?.value;
  const activity = activities.find((item) => item.id === activityId);
  if (!activity) {
    setStatus("กรุณาเลือกหรือสร้างโฟลเดอร์กิจกรรมก่อนอัปโหลด");
    els.activitySelect?.focus();
    return;
  }

  const files = Array.from(fileList || []).filter((file) =>
    file.type.startsWith("image/")
  );

  if (!files.length) {
    setStatus("ไม่พบไฟล์รูปภาพที่รองรับ");
    return;
  }

  if (els.queueList) {
    els.queueList.innerHTML = "";
  }

  for (const [index, file] of files.entries()) {
    const queueItem = createQueueItem(file.name, `กำลังประมวลผล ${index + 1}/${files.length}`);
    els.queueList?.prepend(queueItem);

    try {
      const image = await loadImage(file);
      const detections = await detectFaces(image);
      const imageData = await readAsDataUrl(file);
      const payload = {
        activityId: activity.id,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        width: image.naturalWidth,
        height: image.naturalHeight,
        imageData,
        faces: detections.map((detection) => ({
          descriptor: Array.from(detection.descriptor),
          box: {
            x: detection.detection.box.x,
            y: detection.detection.box.y,
            width: detection.detection.box.width,
            height: detection.detection.box.height
          }
        }))
      };

      const uploadBody = await apiPost("/api/admin/photos", payload);
      const googleDriveNote = formatGoogleDriveQueueNote(
        uploadBody.photo?.googleDrive?.status
      );
      queueItem.querySelector("span").textContent =
        `อัปโหลดเข้า “${activity.name}” แล้ว · พบ ${payload.faces.length} ใบหน้า${googleDriveNote}`;
    } catch (error) {
      console.error(error);
      queueItem.querySelector("span").textContent =
        error.message === "UNAUTHORIZED"
          ? "กรุณาเข้าสู่ระบบแอดมินใหม่"
          : "อัปโหลดไม่สำเร็จ";
      queueItem.classList.add("failed");
      if (error.message === "UNAUTHORIZED") {
        window.location.href = "/admin.html";
        return;
      }
    }
  }

  await loadActivityIndex();
  if (page === "admin") {
    await loadGoogleDriveStatus();
  }
  if (els.activitySelect) {
    els.activitySelect.value = activity.id;
  }
  await loadAdminPhotos();
  setStatus(`อัปโหลดเรียบร้อย รูปถูกเก็บในเว็บและโฟลเดอร์ “${activity.name}”`);
}

async function handleReferenceFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("กรุณาเลือกรูปภาพสำหรับค้นหา");
    return;
  }

  if (!modelsReady) {
    setStatus("กรุณารอให้โมเดลพร้อมก่อนเลือกรูปตัวอย่าง");
    return;
  }

  try {
    setStatus("กำลังอ่านใบหน้าจากรูปตัวอย่าง");
    const image = await loadImage(file);
    const detections = await detectFaces(image);

    if (!detections.length) {
      referenceDescriptor = null;
      updateSearchButton();
      setStatus("ไม่พบใบหน้าในรูปตัวอย่าง กรุณาเลือกรูปหน้าชัดกว่าเดิม");
      return;
    }

    const largestFace = detections.sort(
      (a, b) =>
        b.detection.box.width * b.detection.box.height -
        a.detection.box.width * a.detection.box.height
    )[0];

    referenceDescriptor = largestFace.descriptor;
    showReferencePreview(file);
    setStatus("พร้อมค้นหา ระบบจะเทียบใบหน้าที่เด่นที่สุดในรูปตัวอย่าง");
    updateSearchButton();
  } catch (error) {
    console.error(error);
    setStatus("อ่านรูปตัวอย่างไม่สำเร็จ กรุณาลองรูปอื่น");
  }
}

async function searchMatches() {
  if (!referenceDescriptor) {
    setStatus("กรุณาเลือกรูปตัวอย่างก่อนค้นหา");
    return;
  }

  if (!els.consentCheck?.checked) {
    setStatus("กรุณายืนยันสิทธิ์ก่อนค้นหา");
    els.consentCheck?.focus();
    return;
  }

  await loadActivityIndex();
  setStatus("กำลังค้นหารูปที่คล้ายกับใบหน้าตัวอย่าง");
  const threshold = Number(els.thresholdInput?.value || DEFAULT_THRESHOLD);
  const activityId = els.activityFilter?.value || "all";
  const searchBody = await apiPost("/api/search", {
    descriptor: Array.from(referenceDescriptor),
    threshold,
    activityId
  });

  currentStats = searchBody.stats || currentStats;
  if (!getSelectedFilterActivity()?.googleDriveFolderUrl) {
    galleryLink = searchBody.galleryUrl || galleryLink || "";
  }
  renderUserSaveLink();
  if (els.photoCount) {
    els.photoCount.textContent = currentStats.photos;
  }

  lastResults = Array.isArray(searchBody.matches) ? searchBody.matches : [];
  renderResults(lastResults);
  setStatus(
    lastResults.length
      ? `พบรูปที่มีความคล้าย ${lastResults.length} รูป`
      : "ยังไม่พบรูปที่ตรงกับใบหน้าตัวอย่าง ลองปรับความเข้มงวดให้น้อยลง"
  );
}

function renderResults(results) {
  if (!els.resultsGrid || !els.resultCardTemplate) {
    return;
  }

  els.resultsGrid.innerHTML = "";
  if (els.matchCount) {
    els.matchCount.textContent = results.length;
  }
  els.emptyState?.classList.toggle("hidden", results.length > 0);
  if (els.exportBtn) {
    els.exportBtn.disabled = results.length === 0;
  }

  for (const result of results) {
    const card = els.resultCardTemplate.content.firstElementChild.cloneNode(true);
    const image = card.querySelector("img");
    const canvas = card.querySelector("canvas");
    const title = card.querySelector(".result-meta strong");
    const meta = card.querySelector(".result-meta span");

    image.src = result.photo.imageUrl;
    image.alt = result.photo.name;
    image.onload = () => drawFaceBox(canvas, image, result.face.box);
    addImageControls(card.querySelector(".image-wrap"), image, result.photo);

    title.textContent = result.photo.name;
    meta.textContent = `${result.photo.activityName || "กิจกรรม"} · ระยะ ${result.distance.toFixed(
      3
    )} · ความมั่นใจ ${Math.round(result.confidence * 100)}%`;

    els.resultsGrid.append(card);
  }
}

function addImageControls(container, image, photo) {
  if (!container || !image || !photo?.imageUrl) {
    return;
  }

  container.classList.add("interactive-image");
  image.tabIndex = 0;
  image.addEventListener("click", () => openImageViewer(photo.imageUrl, photo.name));
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openImageViewer(photo.imageUrl, photo.name);
    }
  });

  const downloadButton = document.createElement("button");
  downloadButton.className = "image-action-button image-download-button";
  downloadButton.type = "button";
  downloadButton.textContent = "โหลด";
  downloadButton.setAttribute("aria-label", `Download ${photo.name || "photo"}`);
  downloadButton.addEventListener("click", (event) => {
    event.stopPropagation();
    downloadImage(photo.imageUrl, photo.name);
  });
  container.append(downloadButton);
}

function openImageViewer(src, title = "") {
  const viewer = ensureImageViewer();
  const image = viewer.querySelector("img");
  const caption = viewer.querySelector(".image-viewer-caption");
  const downloadButton = viewer.querySelector(".image-viewer-download");

  image.src = src;
  image.alt = title;
  caption.textContent = title || "Photo";
  downloadButton.onclick = () => downloadImage(src, title);
  viewer.classList.remove("hidden");
  document.body.classList.add("viewer-open");
  viewer.querySelector(".image-viewer-close")?.focus();
}

function closeImageViewer() {
  const viewer = document.querySelector(".image-viewer");
  if (!viewer || viewer.classList.contains("hidden")) {
    return;
  }

  viewer.classList.add("hidden");
  document.body.classList.remove("viewer-open");
}

function ensureImageViewer() {
  let viewer = document.querySelector(".image-viewer");
  if (viewer) {
    return viewer;
  }

  viewer = document.createElement("div");
  viewer.className = "image-viewer hidden";
  viewer.innerHTML = `
    <div class="image-viewer-backdrop" data-close-image-viewer></div>
    <figure class="image-viewer-panel">
      <div class="image-viewer-toolbar">
        <figcaption class="image-viewer-caption"></figcaption>
        <button class="secondary-button small-button image-viewer-download" type="button">โหลด</button>
        <button class="secondary-button small-button image-viewer-close" type="button" aria-label="Close">ปิด</button>
      </div>
      <img alt="" />
    </figure>
  `;
  viewer.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-image-viewer], .image-viewer-close")) {
      closeImageViewer();
    }
  });
  document.body.append(viewer);
  return viewer;
}

function downloadImage(src, name = "") {
  const link = document.createElement("a");
  link.href = src;
  link.download = makeDownloadFileName(name || src);
  document.body.append(link);
  link.click();
  link.remove();
}

function makeDownloadFileName(name) {
  const fileName = String(name || "photo.jpg")
    .split(/[\\/]/)
    .pop()
    .replace(/[<>:"|?*]+/g, "-")
    .trim();
  return fileName || "photo.jpg";
}

function drawFaceBox(canvas, image, box) {
  const rect = image.getBoundingClientRect();
  const scale = Math.min(
    rect.width / image.naturalWidth,
    rect.height / image.naturalHeight
  );
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;

  canvas.width = Math.round(rect.width * window.devicePixelRatio);
  canvas.height = Math.round(rect.height * window.devicePixelRatio);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "#2ce0a9";
  ctx.lineWidth = 3;
  ctx.fillStyle = "rgba(44, 224, 169, 0.16)";

  const x = offsetX + box.x * scale;
  const y = offsetY + box.y * scale;
  const width = box.width * scale;
  const height = box.height * scale;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
}

function updateSearchButton() {
  if (!els.searchBtn) {
    return;
  }

  els.searchBtn.disabled =
    !modelsReady ||
    !referenceDescriptor ||
    currentStats.photos === 0 ||
    !els.consentCheck?.checked;
}

function createQueueItem(name, state) {
  const row = document.createElement("div");
  const title = document.createElement("strong");
  const status = document.createElement("span");

  row.className = "queue-item";
  title.textContent = name;
  status.textContent = state;
  row.append(title, status);
  return row;
}

function formatGoogleDriveQueueNote(status) {
  const notes = {
    saved: " · Google Drive แล้ว",
    failed: " · Google Drive ไม่สำเร็จ",
    disabled: " · Google Drive ปิดอยู่",
    not_configured: " · รอตั้งค่า Google Drive",
    unsynced: " · รอซิงก์ Google Drive"
  };
  return notes[status] || "";
}

function showReferencePreview(file) {
  if (!els.referencePreview || !els.referencePlaceholder) {
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  els.referencePreview.src = objectUrl;
  els.referencePreview.hidden = false;
  els.referencePlaceholder.hidden = true;
  els.referencePreview.onload = () => URL.revokeObjectURL(objectUrl);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Cannot load ${file.name}`));
    };

    image.src = objectUrl;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function detectFaces(image) {
  return faceapi
    .detectAllFaces(image, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
}

function exportResults() {
  if (!lastResults.length) {
    return;
  }

  const rows = [
    [
      "activity",
      "file_name",
      "distance",
      "confidence_percent",
      "image_url",
      "google_photo_gallery_url",
      "faces_in_photo"
    ],
    ...lastResults.map((result) => [
      result.photo.activityName || "",
      result.photo.name,
      result.distance.toFixed(4),
      Math.round(result.confidence * 100),
      new URL(result.photo.imageUrl, window.location.origin).href,
      galleryLink || "",
      result.photo.facesCount || 0
    ])
  ];

  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `school-face-finder-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function apiGet(url) {
  const response = await fetch(url);
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `GET ${url} failed`);
  }
  return response.json();
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `POST ${url} failed`);
  }

  return response.json();
}

async function apiPatch(url, payload) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `PATCH ${url} failed`);
  }

  return response.json();
}

async function apiDelete(url) {
  const response = await fetch(url, { method: "DELETE" });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `DELETE ${url} failed`);
  }

  return response.json();
}

function getReadyMessage() {
  if (page === "admin") {
    return "พร้อมสร้างโฟลเดอร์กิจกรรมและอัปโหลดรูป";
  }

  return currentStats.photos
    ? "พร้อมค้นหา เลือกกิจกรรมและรูปใบหน้าตัวอย่างได้เลย"
    : "ยังไม่มีรูปในคลัง กรุณารอแอดมินอัปโหลดรูปกิจกรรมก่อน";
}

function setStatus(message) {
  if (els.statusText) {
    els.statusText.textContent = message;
  }
}

function setModelStatus(kind, text) {
  if (!els.modelState || !els.modelStateText) {
    return;
  }

  els.modelState.classList.remove("ready", "error");
  if (kind) {
    els.modelState.classList.add(kind);
  }
  els.modelStateText.textContent = text;
}

function setLoginError(message) {
  if (els.loginError) {
    els.loginError.textContent = message;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
