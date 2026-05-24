const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";
const DEFAULT_THRESHOLD = 0.52;
const BOOTH_REQUIRED_SHOTS = 3;
const BOOTH_GIF_WIDTH = 640;
const BOOTH_GIF_HEIGHT = 360;

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
  adminViews: document.querySelectorAll(".admin-view"),
  adminViewLinks: document.querySelectorAll("[data-admin-view-link]"),
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
  loginSubmitBtn: $("#loginForm button[type='submit']"),
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
  saveGoogleDriveConfigBtn: $("#saveGoogleDriveConfigBtn"),
  boothVideo: $("#boothVideo"),
  boothVideoEmpty: $("#boothVideoEmpty"),
  boothCameraSelect: $("#boothCameraSelect"),
  boothStartCameraBtn: $("#boothStartCameraBtn"),
  boothCaptureBtn: $("#boothCaptureBtn"),
  boothImportBtn: $("#boothImportBtn"),
  boothImportInput: $("#boothImportInput"),
  boothWatchFolderBtn: $("#boothWatchFolderBtn"),
  boothStopWatchBtn: $("#boothStopWatchBtn"),
  boothAutoUploadCheck: $("#boothAutoUploadCheck"),
  boothWatchState: $("#boothWatchState"),
  boothShotList: $("#boothShotList"),
  boothStripCanvas: $("#boothStripCanvas"),
  boothNavLink: $("#boothNavLink"),
  boothPanel: $("#photoBoothPanel"),
  boothClearBtn: $("#boothClearBtn"),
  boothDownloadBtn: $("#boothDownloadBtn"),
  boothPrintBtn: $("#boothPrintBtn"),
  boothGifBtn: $("#boothGifBtn"),
  boothUploadBtn: $("#boothUploadBtn"),
  boothStatus: $("#boothStatus"),
  boothLayoutSelect: $("#boothLayoutSelect"),
  boothFitSelect: $("#boothFitSelect"),
  boothPhotoScaleInput: $("#boothPhotoScaleInput"),
  boothTitleInput: $("#boothTitleInput"),
  boothBgColorInput: $("#boothBgColorInput"),
  boothBgColor2Input: $("#boothBgColor2Input"),
  boothBgColor3Input: $("#boothBgColor3Input"),
  boothFrameColorInput: $("#boothFrameColorInput"),
  boothTextColorInput: $("#boothTextColorInput"),
  boothAccentColorInput: $("#boothAccentColorInput"),
  boothInfoInput: $("#boothInfoInput"),
  boothLogoInput: $("#boothLogoInput"),
  boothLogoSizeInput: $("#boothLogoSizeInput"),
  boothOverlayInput: $("#boothOverlayInput")
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
let boothShots = [];
let boothStream = null;
let boothLogoImage = null;
let boothOverlayImage = null;
let boothInfoImage = null;
let boothLastGifBlob = null;
let boothSetId = Date.now().toString(36);
let boothWatchHandle = null;
let boothWatchTimer = null;
let boothSeenImportFiles = new Set();
let boothPendingAutoFiles = [];
let boothAutoImportBusy = false;
let boothGifWorkerUrl = "";
let boothDragState = null;
let boothDragBoxes = [];
let boothTextPositions = {
  title: null,
  date: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  if (page === "login") {
    if (new URLSearchParams(window.location.search).get("login") === "failed") {
      setLoginError("รหัสแอดมินไม่ถูกต้อง");
    }
    els.adminPassword?.focus();
    return;
  }

  try {
    if (page === "admin") {
      updateAdminView();
    }
    await loadActivityIndex();
    if (page === "admin") {
      await loadShareLink();
      await loadGoogleDriveConfig();
      await loadGoogleDriveStatus();
      await loadAdminPhotos();
      await initPhotoBooth();
    }

    if (page === "admin" || page === "user") {
      setStatus("กำลังโหลดโมเดลตรวจจับใบหน้า กรุณารอสักครู่");
      await waitForFaceApi();
      await loadModels();
      modelsReady = true;
      setModelStatus("ready", "โมเดลพร้อมใช้งาน");
      setStatus(getReadyMessage());
      updateSearchButton();
      if (page === "admin") {
        await processBoothAutoImportQueue();
      }
    }
  } catch (error) {
    console.error(error);
    setModelStatus("error", "โหลดระบบไม่สำเร็จ");
    setStatus("โหลดระบบไม่สำเร็จ ตรวจสอบ server แล้วรีเฟรชหน้าอีกครั้ง");
  }
}

function bindEvents() {
  els.loginForm?.addEventListener("submit", () => setLoginLoading(true));
  window.addEventListener("hashchange", updateAdminView);
  els.logoutBtn?.addEventListener("click", handleLogout);
  els.activityForm?.addEventListener("submit", handleCreateActivity);
  els.deleteActivityBtn?.addEventListener("click", deleteSelectedActivity);
  els.saveGalleryLinkBtn?.addEventListener("click", saveGalleryLink);
  els.regenerateShareLinkBtn?.addEventListener("click", regenerateShareLink);
  els.copyShareLinkBtn?.addEventListener("click", copyShareLink);
  els.boothStartCameraBtn?.addEventListener("click", startBoothCamera);
  els.boothCaptureBtn?.addEventListener("click", captureBoothShot);
  els.boothImportBtn?.addEventListener("click", () => els.boothImportInput?.click());
  els.boothImportInput?.addEventListener("change", (event) => {
    importBoothShots(event.target.files);
    event.target.value = "";
  });
  els.boothWatchFolderBtn?.addEventListener("click", connectBoothLrFolder);
  els.boothStopWatchBtn?.addEventListener("click", stopBoothLrWatch);
  els.boothAutoUploadCheck?.addEventListener("change", processBoothAutoImportQueue);
  els.boothClearBtn?.addEventListener("click", clearBoothShots);
  els.boothDownloadBtn?.addEventListener("click", downloadBoothStrip);
  els.boothPrintBtn?.addEventListener("click", printBoothStrip);
  els.boothGifBtn?.addEventListener("click", () => generateBoothGif({ download: true }));
  els.boothUploadBtn?.addEventListener("click", uploadBoothStrip);
  els.boothCameraSelect?.addEventListener("change", startBoothCamera);
  els.boothPanel?.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.boothPanel?.classList.add("dragging");
  });
  els.boothPanel?.addEventListener("dragleave", () => {
    els.boothPanel?.classList.remove("dragging");
  });
  els.boothPanel?.addEventListener("drop", (event) => {
    event.preventDefault();
    els.boothPanel?.classList.remove("dragging");
    importBoothShots(event.dataTransfer?.files);
  });
  els.boothLogoInput?.addEventListener("change", (event) => loadBoothAsset(event.target.files?.[0], "logo"));
  els.boothInfoInput?.addEventListener("change", (event) => loadBoothAsset(event.target.files?.[0], "info"));
  els.boothOverlayInput?.addEventListener("change", (event) => loadBoothAsset(event.target.files?.[0], "overlay"));
  [
    els.boothLayoutSelect,
    els.boothFitSelect,
    els.boothPhotoScaleInput,
    els.boothTitleInput,
    els.boothBgColorInput,
    els.boothBgColor2Input,
    els.boothBgColor3Input,
    els.boothFrameColorInput,
    els.boothTextColorInput,
    els.boothAccentColorInput,
    els.boothLogoSizeInput
  ].forEach((input) => input?.addEventListener("input", renderBoothStrip));

  els.boothStripCanvas?.addEventListener("pointerdown", startBoothCanvasDrag);
  window.addEventListener("pointermove", moveBoothCanvasDrag);
  window.addEventListener("pointerup", stopBoothCanvasDrag);
  window.addEventListener("pointercancel", stopBoothCanvasDrag);

  els.activitySelect?.addEventListener("change", () => {
    updateDeleteActivityButton();
    renderSelectedActivityDriveLink();
    loadAdminPhotos();
    processBoothAutoImportQueue();
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

function updateAdminView() {
  if (page !== "admin" || !els.adminViews?.length) {
    return;
  }

  const view = window.location.hash === "#photoBoothPanel" ? "booth" : "upload";
  els.adminViews.forEach((element) => {
    const shouldShow = element.classList.contains(
      view === "booth" ? "admin-booth-view" : "admin-upload-view"
    );
    element.classList.toggle("hidden", !shouldShow);
  });
  els.adminViewLinks?.forEach((link) => {
    link.classList.toggle("active", link.dataset.adminViewLink === view);
  });

  const target = view === "booth" ? els.boothPanel : $("#uploadPanel");
  window.setTimeout(() => target?.scrollIntoView({ block: "start" }), 0);
}

async function handleLogin(event) {
  event.preventDefault();
  setLoginError("");
  setLoginLoading(true);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify({ password: els.adminPassword?.value || "" })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setLoginError(body.error || "เข้าสู่ระบบไม่สำเร็จ");
      return;
    }

    window.location.replace("/admin.html#uploadPanel");
  } catch (error) {
    setLoginError(
      error?.name === "AbortError"
        ? "เข้าสู่ระบบนานผิดปกติ ลองรีเฟรชหน้าแล้วกดใหม่อีกครั้ง"
        : "เชื่อมต่อ server ไม่สำเร็จ"
    );
  } finally {
    window.clearTimeout(timer);
    setLoginLoading(false);
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
  const defaultActivity = activities.find((activity) => activity.id === "general");
  const defaultLink = defaultActivity?.googleDriveFolderUrl || "";
  const link = selectedLink || defaultLink || galleryLink || "";

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
  if (!els.googleDriveClientIdInput && !els.googleDriveServiceAccountInput && !els.connectGoogleDriveBtn) {
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
    els.connectGoogleDriveBtn.href = "/api/admin/google-drive/connect";
    els.connectGoogleDriveBtn.classList.toggle(
      "hidden",
      !config.clientId || !config.hasClientSecret || !config.folderId || config.connected
    );
  }

  renderGoogleDriveSetupHint(config);
  maybeAutoConnectGoogleDrive(config);
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

function maybeAutoConnectGoogleDrive(config = {}) {
  if (page !== "admin" || !els.connectGoogleDriveBtn) {
    return;
  }

  const canConnect =
    config.clientId &&
    config.hasClientSecret &&
    config.folderId &&
    !config.connected;

  if (!canConnect || sessionStorage.getItem("photobss-drive-auto-connect-tried") === "1") {
    return;
  }

  sessionStorage.setItem("photobss-drive-auto-connect-tried", "1");
  window.setTimeout(() => {
    window.location.href = "/api/admin/google-drive/connect";
  }, 300);
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
    await loadActivityIndex();
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
    not_connected: "Google Drive needs one connection. Opening Google sign-in if settings are ready.",
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
    not_connected: "Drive settings are saved. Opening Google sign-in if a reconnect is needed.",
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

async function initPhotoBooth() {
  if (!els.boothStripCanvas) {
    return;
  }

  renderBoothStrip();
  renderBoothShotList();
  await refreshBoothCameras();
}

async function refreshBoothCameras() {
  if (!els.boothCameraSelect || !navigator.mediaDevices?.enumerateDevices) {
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    els.boothCameraSelect.innerHTML = cameras.length
      ? cameras
          .map((camera, index) => {
            const label = camera.label || `Camera ${index + 1}`;
            return `<option value="${escapeHtml(camera.deviceId)}">${escapeHtml(label)}</option>`;
          })
          .join("")
      : `<option value="">Default camera</option>`;
  } catch {
    els.boothCameraSelect.innerHTML = `<option value="">Default camera</option>`;
  }
}

async function startBoothCamera() {
  if (!els.boothVideo || !navigator.mediaDevices?.getUserMedia) {
    setBoothStatus("เบราว์เซอร์นี้ไม่รองรับการใช้กล้อง");
    return;
  }

  stopBoothCamera();
  const deviceId = els.boothCameraSelect?.value || "";

  try {
    boothStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    els.boothVideo.srcObject = boothStream;
    els.boothVideoEmpty?.classList.add("hidden");
    if (els.boothCaptureBtn) {
      els.boothCaptureBtn.disabled = false;
    }
    await refreshBoothCameras();
    setBoothStatus("กล้องพร้อม ถ้าใช้ Canon ให้เลือก Canon EOS Webcam Utility ในรายการกล้อง");
  } catch (error) {
    console.error(error);
    setBoothStatus("เปิดกล้องไม่สำเร็จ ตรวจ permission กล้อง หรือเลือกกล้องใหม่");
  }
}

function stopBoothCamera() {
  if (boothStream) {
    boothStream.getTracks().forEach((track) => track.stop());
    boothStream = null;
  }
}

async function captureBoothShot() {
  if (!els.boothVideo || !els.boothVideo.videoWidth) {
    setBoothStatus("ยังไม่พบภาพจากกล้อง");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  drawImageCover(canvas.getContext("2d"), els.boothVideo, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const image = await loadImageFromDataUrl(dataUrl);
  if (boothShots.length >= BOOTH_REQUIRED_SHOTS) {
    startNewBoothSet();
  }
  addBoothShot({
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    name: `booth-shot-${boothShots.length + 1}.jpg`,
    dataUrl,
    image
  });
}

async function importBoothShots(fileList) {
  const files = Array.from(fileList || []).filter(
    (file) => file.type.startsWith("image/") || isBoothImportFile(file.name)
  );
  if (!files.length) {
    setBoothStatus("ไม่พบไฟล์รูปจาก Lr/export");
    return false;
  }

  startNewBoothSet();
  for (const file of files.slice(0, BOOTH_REQUIRED_SHOTS)) {
    const dataUrl = await readAsDataUrl(file);
    const image = await loadImageFromDataUrl(dataUrl);
    addBoothShot({
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      name: file.name,
      dataUrl,
      image
    });
  }

  if (files.length > BOOTH_REQUIRED_SHOTS) {
    setBoothStatus(`ใช้ 3 รูปแรกเป็น 1 เซ็ตแล้ว เหลือ ${files.length - BOOTH_REQUIRED_SHOTS} รูปให้ทำเซ็ตถัดไป`);
  }

  return true;
}

async function connectBoothLrFolder() {
  if (!window.showDirectoryPicker) {
    setBoothWatchState("ใช้ Chrome หรือ Edge บน HTTPS/localhost เพื่อเชื่อมโฟลเดอร์ Lr อัตโนมัติ");
    setBoothStatus("เบราว์เซอร์นี้ยังไม่รองรับการเฝ้าดูโฟลเดอร์ Lr ให้ใช้ปุ่มนำเข้าจาก Lr แทน");
    return;
  }

  try {
    boothWatchHandle = await window.showDirectoryPicker({ mode: "read" });
    boothSeenImportFiles = new Set();
    boothPendingAutoFiles = [];
    if (boothWatchTimer) {
      window.clearInterval(boothWatchTimer);
    }
    updateBoothWatchButtons(true);
    setBoothWatchState(`เชื่อมโฟลเดอร์ "${boothWatchHandle.name}" แล้ว กำลังรอรูปจาก Lr`);
    await scanBoothLrFolder();
    boothWatchTimer = window.setInterval(scanBoothLrFolder, 2500);
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
      setBoothWatchState("เชื่อมโฟลเดอร์ Lr ไม่สำเร็จ");
    }
  }
}

function stopBoothLrWatch() {
  if (boothWatchTimer) {
    window.clearInterval(boothWatchTimer);
    boothWatchTimer = null;
  }
  boothWatchHandle = null;
  boothPendingAutoFiles = [];
  updateBoothWatchButtons(false);
  setBoothWatchState("หยุด Auto Import จาก Lr แล้ว");
}

async function scanBoothLrFolder() {
  if (!boothWatchHandle) {
    return;
  }

  try {
    const newFiles = [];
    for await (const [, handle] of boothWatchHandle.entries()) {
      if (handle.kind !== "file" || !isBoothImportFile(handle.name)) {
        continue;
      }
      const file = await handle.getFile();
      const fileKey = `${file.name}:${file.lastModified}:${file.size}`;
      if (boothSeenImportFiles.has(fileKey)) {
        continue;
      }
      boothSeenImportFiles.add(fileKey);
      newFiles.push(file);
    }

    if (!newFiles.length) {
      return;
    }

    newFiles.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
    boothPendingAutoFiles.push(...newFiles);
    setBoothWatchState(
      `เจอรูปใหม่ ${newFiles.length} รูป รอเข้าชุด ${boothPendingAutoFiles.length}/${BOOTH_REQUIRED_SHOTS}`
    );
    await processBoothAutoImportQueue();
  } catch (error) {
    console.error(error);
    setBoothWatchState("อ่านโฟลเดอร์ Lr ไม่สำเร็จ ลองเชื่อมโฟลเดอร์ใหม่");
  }
}

async function processBoothAutoImportQueue() {
  if (boothAutoImportBusy) {
    return;
  }

  boothAutoImportBusy = true;
  try {
    while (boothPendingAutoFiles.length >= BOOTH_REQUIRED_SHOTS) {
      const autoUpload = Boolean(els.boothAutoUploadCheck?.checked);
      if (!autoUpload && boothShots.length) {
        setBoothWatchState(
          `มีรูปค้าง ${boothPendingAutoFiles.length} รูป ล้างหรืออัปโหลดเซ็ตปัจจุบันก่อนเพื่อดึงชุดถัดไป`
        );
        break;
      }

      const files = boothPendingAutoFiles.splice(0, BOOTH_REQUIRED_SHOTS);
      await importBoothShots(files);
      if (!autoUpload) {
        setBoothWatchState(
          boothPendingAutoFiles.length
            ? `นำเข้า 1 เซ็ตแล้ว เหลือรูปค้าง ${boothPendingAutoFiles.length} รูป`
            : "นำเข้า 1 เซ็ตจาก Lr แล้ว"
        );
        break;
      }

      const uploaded = await uploadBoothStrip();
      if (!uploaded) {
        boothPendingAutoFiles.unshift(...files);
        setBoothWatchState("ยังอัปโหลดอัตโนมัติไม่ได้ เลือกโฟลเดอร์กิจกรรมและรอโมเดลพร้อมก่อน");
        break;
      }
      startNewBoothSet();
      setBoothWatchState(
        boothPendingAutoFiles.length
          ? `อัปโหลด 1 เซ็ตแล้ว เหลือรูปค้าง ${boothPendingAutoFiles.length} รูป`
          : "อัปโหลดเซ็ตล่าสุดจาก Lr แล้ว พร้อมรอเซ็ตถัดไป"
      );
    }
  } finally {
    boothAutoImportBusy = false;
  }
}

function isBoothImportFile(fileName) {
  return /\.(jpe?g|png|webp)$/i.test(fileName || "");
}

function updateBoothWatchButtons(isWatching) {
  if (els.boothWatchFolderBtn) {
    els.boothWatchFolderBtn.disabled = isWatching;
  }
  if (els.boothStopWatchBtn) {
    els.boothStopWatchBtn.disabled = !isWatching;
  }
}

function setBoothWatchState(message) {
  if (els.boothWatchState) {
    els.boothWatchState.textContent = message;
  }
}

function addBoothShot(shot) {
  boothShots.push(shot);
  boothLastGifBlob = null;
  renderBoothShotList();
  renderBoothStrip();
  setBoothStatus(
    boothShots.length === BOOTH_REQUIRED_SHOTS
      ? "ครบ 3 รูปแล้ว ดาวน์โหลด พิมพ์ สร้าง GIF หรืออัปโหลดเข้า Drive ได้เลย"
      : `ใส่รูปแล้ว ${boothShots.length}/${BOOTH_REQUIRED_SHOTS}`
  );
}

function startNewBoothSet() {
  boothShots = [];
  boothLastGifBlob = null;
  boothSetId = Date.now().toString(36);
  renderBoothShotList();
  renderBoothStrip();
}

function clearBoothShots() {
  startNewBoothSet();
  renderBoothShotList();
  renderBoothStrip();
  setBoothStatus("ล้างรูปแล้ว พร้อมถ่ายชุดใหม่");
  processBoothAutoImportQueue();
}

function renderBoothShotList() {
  if (!els.boothShotList) {
    return;
  }

  els.boothShotList.innerHTML = Array.from({ length: BOOTH_REQUIRED_SHOTS }, (_, index) => {
    const shot = boothShots[index];
    return shot
      ? `<figure><img src="${shot.dataUrl}" alt="" /><figcaption>${index + 1}</figcaption></figure>`
      : `<figure class="empty"><span>${index + 1}</span><figcaption>รอรูป</figcaption></figure>`;
  }).join("");
}

function renderBoothStrip() {
  const canvas = els.boothStripCanvas;
  if (!canvas) {
    return;
  }

  const layout = getBoothLayoutSpec();
  if (canvas.width !== layout.width || canvas.height !== layout.height) {
    canvas.width = layout.width;
    canvas.height = layout.height;
  }

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const frameColor = els.boothFrameColorInput?.value || "#ffffff";
  const textColor = els.boothTextColorInput?.value || "#ffffff";
  const accentColor = els.boothAccentColorInput?.value || "#ec4899";
  const title = els.boothTitleInput?.value.trim() || "BSS PHOTO BOOTH";
  const photoFit = els.boothFitSelect?.value || "contain";
  const photoScale = Number(els.boothPhotoScaleInput?.value || 100) / 100;

  boothDragBoxes = [];
  ctx.clearRect(0, 0, width, height);
  fillBoothBackground(ctx, width, height);

  if (boothOverlayImage) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    drawImageCover(ctx, boothOverlayImage, 0, 0, width, height);
    ctx.restore();
  }

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, width, layout.edge);
  ctx.fillRect(0, height - layout.edge, width, layout.edge);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = Math.max(3, Math.round(width * 0.004));
  for (let index = 0; index < 5; index += 1) {
    ctx.beginPath();
    ctx.arc(width - layout.margin - index * 46, layout.titleY + index * 14, 110 + index * 18, 0.1, 1.5);
    ctx.stroke();
  }

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.font = `700 ${layout.titleSize}px Georgia, serif`;
  const titlePoint = getBoothTextPoint("title", width / 2, layout.titleY, width, height);
  wrapCanvasText(ctx, title.toUpperCase(), titlePoint.x, titlePoint.y, width - layout.margin * 2, layout.titleSize + 10);
  registerBoothTextBox(ctx, "title", title.toUpperCase(), titlePoint.x, titlePoint.y, layout.titleSize * 1.8, width);
  ctx.font = `800 ${layout.dateSize}px Segoe UI, sans-serif`;
  const dateText = new Date().toLocaleDateString("th-TH");
  const datePoint = getBoothTextPoint("date", width / 2, layout.dateY, width, height);
  ctx.fillText(dateText, datePoint.x, datePoint.y);
  registerBoothTextBox(ctx, "date", dateText, datePoint.x, datePoint.y, layout.dateSize * 1.9, width);

  for (let index = 0; index < BOOTH_REQUIRED_SHOTS; index += 1) {
    const slot = layout.slots[index];
    ctx.fillStyle = frameColor;
    roundRect(ctx, slot.x - layout.frame, slot.y - layout.frame, slot.w + layout.frame * 2, slot.h + layout.frame * 2, layout.radius);
    ctx.fill();
    ctx.fillStyle = "#050816";
    ctx.fillRect(slot.x, slot.y, slot.w, slot.h);

    const shot = boothShots[index];
    if (shot) {
      drawPhotoInSlot(ctx, shot.image, slot, photoFit, photoScale);
      drawBoothImageWatermark(ctx, slot);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = `800 ${layout.placeholderSize}px Segoe UI, sans-serif`;
      ctx.fillText(`PHOTO ${index + 1}`, slot.x + slot.w / 2, slot.y + slot.h / 2);
    }
  }

  drawBoothInfoImage(ctx, layout, width, height);
  updateBoothButtons();
}

function getBoothTextPoint(id, defaultX, defaultY, width, height) {
  const position = boothTextPositions[id];
  if (!position) {
    return { x: defaultX, y: defaultY };
  }

  return {
    x: clamp(position.x * width, width * 0.04, width * 0.96),
    y: clamp(position.y * height, height * 0.03, height * 0.97)
  };
}

function setBoothTextPoint(id, x, y, width, height) {
  boothTextPositions[id] = {
    x: clamp(x / width, 0.04, 0.96),
    y: clamp(y / height, 0.03, 0.97)
  };
}

function registerBoothTextBox(ctx, id, text, x, y, height, canvasWidth) {
  const measuredWidth = Math.max(ctx.measureText(text || id).width + 80, canvasWidth * 0.26);
  boothDragBoxes.push({
    id,
    x: x - measuredWidth / 2,
    y: y - height * 0.82,
    w: measuredWidth,
    h: height
  });
}

function startBoothCanvasDrag(event) {
  if (page !== "admin" || !els.boothStripCanvas) {
    return;
  }

  const point = getBoothCanvasPoint(event);
  const hit = [...boothDragBoxes]
    .reverse()
    .find(
      (box) =>
        point.x >= box.x &&
        point.x <= box.x + box.w &&
        point.y >= box.y &&
        point.y <= box.y + box.h
    );

  if (!hit) {
    return;
  }

  event.preventDefault();
  boothDragState = { id: hit.id, pointerId: event.pointerId };
  els.boothStripCanvas.setPointerCapture?.(event.pointerId);
  els.boothStripCanvas.classList.add("is-dragging");
}

function moveBoothCanvasDrag(event) {
  if (!boothDragState || !els.boothStripCanvas) {
    return;
  }

  event.preventDefault();
  const point = getBoothCanvasPoint(event);
  setBoothTextPoint(
    boothDragState.id,
    point.x,
    point.y,
    els.boothStripCanvas.width,
    els.boothStripCanvas.height
  );
  renderBoothStrip();
}

function stopBoothCanvasDrag(event) {
  if (!boothDragState || !els.boothStripCanvas) {
    return;
  }

  els.boothStripCanvas.releasePointerCapture?.(boothDragState.pointerId || event.pointerId);
  els.boothStripCanvas.classList.remove("is-dragging");
  boothDragState = null;
}

function getBoothCanvasPoint(event) {
  const canvas = els.boothStripCanvas;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(rect.width, 1);
  const scaleY = canvas.height / Math.max(rect.height, 1);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getBoothLayoutSpec() {
  const layoutName = els.boothLayoutSelect?.value || "strip";
  const specs = {
    strip: {
      width: 900,
      height: 2700,
      margin: 68,
      edge: 22,
      frame: 10,
      radius: 7,
      titleY: 118,
      dateY: 232,
      titleSize: 58,
      dateSize: 26,
      placeholderSize: 30,
      infoBottom: 88,
      infoMaxHeight: 360,
      slots: [
        { x: 70, y: 330, w: 760, h: 510 },
        { x: 70, y: 930, w: 760, h: 510 },
        { x: 70, y: 1530, w: 760, h: 510 }
      ]
    },
    poster: {
      width: 1200,
      height: 1800,
      margin: 76,
      edge: 20,
      frame: 10,
      radius: 8,
      titleY: 105,
      dateY: 198,
      titleSize: 58,
      dateSize: 25,
      placeholderSize: 26,
      infoBottom: 56,
      infoMaxHeight: 170,
      slots: [
        { x: 95, y: 270, w: 1010, h: 620 },
        { x: 95, y: 980, w: 485, h: 500 },
        { x: 620, y: 980, w: 485, h: 500 }
      ]
    },
    wide: {
      width: 1600,
      height: 1100,
      margin: 70,
      edge: 18,
      frame: 9,
      radius: 8,
      titleY: 100,
      dateY: 180,
      titleSize: 56,
      dateSize: 24,
      placeholderSize: 25,
      infoBottom: 38,
      infoMaxHeight: 110,
      slots: [
        { x: 80, y: 280, w: 450, h: 585 },
        { x: 575, y: 280, w: 450, h: 585 },
        { x: 1070, y: 280, w: 450, h: 585 }
      ]
    }
  };
  return specs[layoutName] || specs.strip;
}

function updateBoothButtons() {
  const ready = boothShots.length === BOOTH_REQUIRED_SHOTS;
  [els.boothDownloadBtn, els.boothPrintBtn, els.boothGifBtn, els.boothUploadBtn].forEach((button) => {
    if (button) button.disabled = !ready;
  });
}

function fillBoothBackground(ctx, width, height) {
  const colors = [
    els.boothBgColorInput?.value || "#111827",
    els.boothBgColor2Input?.value || "",
    els.boothBgColor3Input?.value || ""
  ].filter(Boolean);

  if (colors.length === 1) {
    ctx.fillStyle = colors[0];
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    colors.forEach((color, index) => {
      gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), color);
    });
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);
}

function drawBoothInfoImage(ctx, layout, width, height) {
  if (!boothInfoImage) {
    return;
  }

  const margin = Math.max(layout.margin || 40, Math.round(width * 0.06));
  const maxWidth = width - margin * 2;
  const maxHeight = Math.min(layout.infoMaxHeight || height * 0.16, height * 0.22);
  const ratio = boothInfoImage.naturalWidth / boothInfoImage.naturalHeight || 1;
  let targetWidth = maxWidth;
  let targetHeight = targetWidth / ratio;

  if (targetHeight > maxHeight) {
    targetHeight = maxHeight;
    targetWidth = targetHeight * ratio;
  }

  const x = (width - targetWidth) / 2;
  const y = height - (layout.infoBottom || 60) - targetHeight;
  ctx.save();
  ctx.globalAlpha = 0.98;
  drawImageContain(ctx, boothInfoImage, x, y, targetWidth, targetHeight);
  ctx.restore();
}

function drawBoothImageWatermark(ctx, slot) {
  if (!boothLogoImage) {
    return;
  }

  const baseSize = Number(els.boothLogoSizeInput?.value || 128);
  const maxWidth = Math.min(slot.w * 0.32, baseSize * 1.9);
  const maxHeight = Math.min(slot.h * 0.2, baseSize);
  const padding = Math.max(14, Math.round(slot.w * 0.03));
  const targetRatio = boothLogoImage.naturalWidth / boothLogoImage.naturalHeight || 1;
  let logoWidth = maxWidth;
  let logoHeight = logoWidth / targetRatio;
  if (logoHeight > maxHeight) {
    logoHeight = maxHeight;
    logoWidth = logoHeight * targetRatio;
  }

  ctx.save();
  ctx.globalAlpha = 0.96;
  drawImageContain(
    ctx,
    boothLogoImage,
    slot.x + slot.w - logoWidth - padding,
    slot.y + padding,
    logoWidth,
    logoHeight
  );
  ctx.restore();
}

async function loadBoothAsset(file, type) {
  if (!file || !file.type.startsWith("image/")) {
    return;
  }

  const dataUrl = await readAsDataUrl(file);
  const image = await loadImageFromDataUrl(dataUrl);
  if (type === "logo") {
    boothLogoImage = image;
  } else if (type === "info") {
    boothInfoImage = image;
  } else {
    boothOverlayImage = image;
  }
  renderBoothStrip();
}

async function downloadBoothStrip() {
  const blob = await canvasToBlob(els.boothStripCanvas, "image/jpeg", 0.94);
  downloadBlob(blob, makeBoothFileName("jpg"));
}

function printBoothStrip() {
  const printCanvas = makeBoothPrintCanvas();
  const dataUrl = printCanvas?.toDataURL("image/jpeg", 0.94);
  if (!dataUrl) return;
  setBoothStatus("กำลังเปิดหน้าพิมพ์...");

  const printWindow = window.open("", "photobss-print", "width=520,height=900");
  if (printWindow) {
    writeBoothPrintDocument(printWindow.document);
    const image = printWindow.document.getElementById("boothPrintImage");
    image.onload = () => {
      window.setTimeout(() => {
        printWindow.focus();
        printWindow.print();
        setBoothStatus("เปิดหน้าพิมพ์แล้ว");
      }, 250);
    };
    image.onerror = () => setBoothStatus("โหลดภาพสำหรับพิมพ์ไม่สำเร็จ");
    printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
    image.src = dataUrl;
    return;
  }

  printBoothStripInFrame(dataUrl);
}

function makeBoothPrintCanvas() {
  const source = els.boothStripCanvas;
  if (!source) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function writeBoothPrintDocument(documentRef) {
  documentRef.open();
  documentRef.write(`
    <!doctype html>
    <html>
      <head>
        <title>Photo Booth Print</title>
        <style>
          @page { margin: 0; size: 80mm 240mm; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            min-height: 100%;
            background: #fff;
          }
          body {
            display: grid;
            min-height: 100vh;
            place-items: center;
            padding: 0;
          }
          img {
            display: block;
            width: auto;
            max-width: 80mm;
            max-height: 100vh;
            object-fit: contain;
          }
          @media print {
            body {
              min-height: 100vh;
              padding: 0;
            }
            img {
              max-height: 100vh;
            }
          }
        </style>
      </head>
      <body>
        <img id="boothPrintImage" alt="Photo Booth Print" />
      </body>
    </html>
  `);
  documentRef.close();
}

function printBoothStripInFrame(dataUrl) {
  const frame = document.createElement("iframe");
  frame.title = "Photo Booth Print";
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.appendChild(frame);

  const printFrameWindow = frame.contentWindow;
  const printFrameDocument = frame.contentDocument || printFrameWindow?.document;
  if (!printFrameWindow || !printFrameDocument) {
    frame.remove();
    setBoothStatus("เปิดหน้าพิมพ์ไม่สำเร็จ");
    return;
  }

  writeBoothPrintDocument(printFrameDocument);
  const image = printFrameDocument.getElementById("boothPrintImage");
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000);
  printFrameWindow.addEventListener("afterprint", cleanup, { once: true });
  image.onload = () => {
    window.setTimeout(() => {
      printFrameWindow.focus();
      printFrameWindow.print();
      setBoothStatus("เปิดหน้าพิมพ์แล้ว");
      window.setTimeout(cleanup, 60000);
    }, 250);
  };
  image.onerror = () => {
    cleanup();
    setBoothStatus("โหลดภาพสำหรับพิมพ์ไม่สำเร็จ");
  };
  image.src = dataUrl;
}

async function generateBoothGif(options = {}) {
  if (boothShots.length < BOOTH_REQUIRED_SHOTS) {
    setBoothStatus("ต้องมีรูปครบ 3 รูปก่อนสร้าง GIF");
    return null;
  }

  if (!window.GIF) {
    setBoothStatus("โหลดตัวสร้าง GIF ไม่สำเร็จ ลองเช็กอินเทอร์เน็ตแล้วรีเฟรชหน้า");
    return null;
  }

  setBoothStatus("กำลังสร้าง GIF แบบเร็ว...");
  let gif;
  try {
    gif = new window.GIF({
      workers: 1,
      quality: 20,
      width: BOOTH_GIF_WIDTH,
      height: BOOTH_GIF_HEIGHT,
      workerScript: getBoothGifWorkerScript()
    });
  } catch (error) {
    console.error(error);
    setBoothStatus("สร้าง GIF ไม่สำเร็จ เพราะ browser บล็อก worker ลองรีเฟรชหน้าแล้วกดสร้างใหม่");
    return null;
  }

  boothShots.forEach((shot) => {
    const frame = makeBoothSinglePhotoGifFrame(shot);
    gif.addFrame(frame, { delay: 720, copy: true });
  });

  let blob;
  try {
    blob = await new Promise((resolve, reject) => {
      gif.on("finished", resolve);
      try {
        gif.render();
      } catch (error) {
        reject(error);
      }
    });
  } catch (error) {
    console.error(error);
    setBoothStatus("สร้าง GIF ไม่สำเร็จ ลองรีเฟรชหน้าแล้วกดสร้างใหม่");
    return null;
  }
  boothLastGifBlob = blob;

  if (options.download) {
    downloadBlob(blob, makeBoothFileName("gif"));
  }
  setBoothStatus("สร้าง GIF สำเร็จ");
  return blob;
}

function getBoothGifWorkerScript() {
  if (!boothGifWorkerUrl) {
    const source =
      'importScripts("https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js");';
    boothGifWorkerUrl = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" })
    );
  }
  return boothGifWorkerUrl;
}

function makeBoothSinglePhotoGifFrame(shot) {
  const canvas = document.createElement("canvas");
  canvas.width = BOOTH_GIF_WIDTH;
  canvas.height = BOOTH_GIF_HEIGHT;
  const ctx = canvas.getContext("2d");
  const frameColor = els.boothFrameColorInput?.value || "#ffffff";
  const accentColor = els.boothAccentColorInput?.value || "#ec4899";
  const photoFit = "contain";
  const photoScale = 1;
  const slot = {
    x: Math.round(canvas.width * 0.079),
    y: Math.round(canvas.height * 0.119),
    w: Math.round(canvas.width * 0.842),
    h: Math.round(canvas.height * 0.737)
  };
  const framePad = Math.max(6, Math.round(canvas.width * 0.01));
  const edge = Math.max(6, Math.round(canvas.height * 0.018));

  fillBoothBackground(ctx, canvas.width, canvas.height);
  if (boothOverlayImage) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    drawImageCover(ctx, boothOverlayImage, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, canvas.width, edge);
  ctx.fillRect(0, canvas.height - edge, canvas.width, edge);
  ctx.fillStyle = frameColor;
  roundRect(
    ctx,
    slot.x - framePad,
    slot.y - framePad,
    slot.w + framePad * 2,
    slot.h + framePad * 2,
    Math.max(8, framePad)
  );
  ctx.fill();
  ctx.fillStyle = "#050816";
  ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
  drawPhotoInSlot(ctx, shot.image, slot, photoFit, photoScale);
  drawBoothImageWatermark(ctx, slot);
  drawBoothInfoImage(
    ctx,
    {
      margin: Math.round(canvas.width * 0.08),
      infoBottom: Math.round(canvas.height * 0.04),
      infoMaxHeight: Math.round(canvas.height * 0.08)
    },
    canvas.width,
    canvas.height
  );
  return canvas;
}

async function uploadBoothStrip() {
  if (!modelsReady) {
    setBoothStatus("รอโมเดลตรวจจับใบหน้าพร้อมก่อน");
    return false;
  }

  const activityId = els.activitySelect?.value;
  const activity = activities.find((item) => item.id === activityId);
  if (!activity) {
    setBoothStatus("เลือกโฟลเดอร์กิจกรรมก่อนอัปโหลด");
    els.activitySelect?.focus();
    return false;
  }

  try {
    els.boothUploadBtn.disabled = true;
    setBoothStatus("กำลังอัปโหลดโพลารอยเข้า Drive...");
    const stripBlob = await canvasToBlob(els.boothStripCanvas, "image/jpeg", 0.94);
    const stripFile = new File([stripBlob], makeBoothFileName("jpg"), { type: "image/jpeg" });
    await uploadBoothFile(stripFile, activity, "photobooth-strip");

    let gifUploaded = false;
    const gifBlob = await generateBoothGif({ download: false });
    if (gifBlob) {
      const gifFile = new File([gifBlob], makeBoothFileName("gif"), { type: "image/gif" });
      const firstFrameBlob = await canvasToBlob(makeBoothSinglePhotoGifFrame(boothShots[0]), "image/jpeg", 0.9);
      await uploadBoothFile(gifFile, activity, "photobooth-gif", firstFrameBlob);
      gifUploaded = true;
    }

    await loadActivityIndex();
    await loadAdminPhotos();
    setBoothStatus(
      gifUploaded
        ? "อัปโหลดโฟโต้บูธและ GIF เข้า Drive แล้ว"
        : "อัปโหลดโฟโต้บูธเข้า Drive แล้ว แต่ GIF ยังสร้างไม่สำเร็จ"
    );
    return true;
  } catch (error) {
    console.error(error);
    if (error.message === "UNAUTHORIZED") {
      window.location.href = "/admin.html";
      return false;
    }
    setBoothStatus(error.message || "อัปโหลดโฟโต้บูธไม่สำเร็จ");
    return false;
  } finally {
    updateBoothButtons();
  }
}

async function uploadBoothFile(file, activity, label, detectBlob = null) {
  const detectionFile = detectBlob
    ? new File([detectBlob], `${label}-face.jpg`, { type: "image/jpeg" })
    : file;
  const image = await loadImage(detectionFile);
  const detections = await detectFaces(image);
  const imageData = await readAsDataUrl(file);
  const payload = {
    activityId: activity.id,
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: Date.now(),
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
  await apiPost("/api/admin/photos", payload);
}

function setBoothStatus(message) {
  if (els.boothStatus) {
    els.boothStatus.textContent = message;
  }
  setStatus(message);
}

function makeBoothFileName(extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `photo-booth-${boothSetId}-${stamp}.${extension}`;
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    if (!canvas) {
      reject(new Error("Canvas is missing"));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Cannot export canvas"));
    }, type, quality);
  });
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Cannot load image"));
    image.src = dataUrl;
  });
}

function drawPhotoInSlot(ctx, image, slot, fit, scale = 1) {
  const sourceWidth = image.videoWidth || image.naturalWidth || image.width;
  const sourceHeight = image.videoHeight || image.naturalHeight || image.height;
  const baseScale =
    fit === "contain"
      ? Math.min(slot.w / sourceWidth, slot.h / sourceHeight)
      : Math.max(slot.w / sourceWidth, slot.h / sourceHeight);
  const drawScale = baseScale * scale;
  const drawWidth = sourceWidth * drawScale;
  const drawHeight = sourceHeight * drawScale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(slot.x, slot.y, slot.w, slot.h);
  ctx.clip();
  ctx.fillStyle = "#050816";
  ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
  ctx.drawImage(
    image,
    slot.x + (slot.w - drawWidth) / 2,
    slot.y + (slot.h - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
  ctx.restore();
}

function drawImageCover(ctx, image, x, y, width, height) {
  const sourceWidth = image.videoWidth || image.naturalWidth || image.width;
  const sourceHeight = image.videoHeight || image.naturalHeight || image.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawImageContain(ctx, image, x, y, width, height) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  let line = "";
  let currentY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, currentY);
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

function setLoginLoading(isLoading) {
  if (els.loginSubmitBtn) {
    els.loginSubmitBtn.disabled = isLoading;
    els.loginSubmitBtn.textContent = isLoading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ";
  }
  if (els.adminPassword) {
    els.adminPassword.disabled = isLoading;
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
