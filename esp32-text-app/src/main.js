import { createWorker } from 'tesseract.js';
import { Clipboard } from '@capacitor/clipboard';
import { CapacitorHttp, Capacitor, registerPlugin } from '@capacitor/core';

// Register Native Google ML Kit plugin
const NativeOcr = registerPlugin('NativeOcr');

// Configuration state
const config = {
  espIp: localStorage.getItem('esp32_ip') || '192.168.4.1',
  previewRes: localStorage.getItem('esp32_preview_res') || '/cam-mid.jpg',
  captureEndpoint: localStorage.getItem('esp32_capture_endpoint') || '/capture.jpg',
  streamIntervalMs: 1200
};

// Application state
let isStreaming = true;
let streamTimer = null;
let ocrWorker = null;
let isOcrBusy = false;
let currentCapturedBlob = null;
let currentCapturedUrl = null;
let scanHistory = JSON.parse(localStorage.getItem('esp32_scan_history') || '[]');
let currentOcrMode = localStorage.getItem('esp32_ocr_mode') || 'handwriting';
let isCropActive = false;
let cropBox = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 }; // Normalized 0..1
let lastUsedEngine = 'Google ML Kit (Offline)';

// DOM Elements
const el = {
  statusBadge: document.getElementById('btn-status'),
  statusLabel: document.getElementById('status-label'),
  btnSettings: document.getElementById('btn-settings'),
  settingsModal: document.getElementById('settings-modal'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  inputEspIp: document.getElementById('input-esp-ip'),
  inputPreviewRes: document.getElementById('input-preview-res'),
  inputCaptureEndpoint: document.getElementById('input-capture-endpoint'),

  btnToggleStream: document.getElementById('btn-toggle-stream'),
  streamBtnText: document.getElementById('stream-btn-text'),
  btnGrid: document.getElementById('btn-grid'),
  gridOverlay: document.getElementById('grid-overlay'),
  viewfinderImg: document.getElementById('viewfinder-img'),
  placeholder: document.getElementById('viewfinder-placeholder'),
  btnRetryConnect: document.getElementById('btn-retry-connect'),

  modeHandwriting: document.getElementById('mode-handwriting'),
  modePrinted: document.getElementById('mode-printed'),

  ocrOverlay: document.getElementById('ocr-overlay'),
  ocrStatusTitle: document.getElementById('ocr-status-title'),
  ocrProgressBar: document.getElementById('ocr-progress-bar'),
  ocrProgressPercent: document.getElementById('ocr-progress-percent'),

  btnCapture: document.getElementById('btn-capture'),
  fileInput: document.getElementById('file-input'),
  btnHistory: document.getElementById('btn-history'),
  historyDrawer: document.getElementById('history-drawer'),
  btnCloseHistory: document.getElementById('btn-close-history'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  historyList: document.getElementById('history-list'),

  tabs: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  btnCopy: document.getElementById('btn-copy'),
  copyTextLabel: document.getElementById('copy-text-label'),

  resultTextarea: document.getElementById('result-textarea'),
  metaEngine: document.getElementById('meta-engine'),
  metaConfidence: document.getElementById('meta-confidence'),
  metaWords: document.getElementById('meta-words'),
  metaChars: document.getElementById('meta-chars'),

  btnSpeak: document.getElementById('btn-speak'),
  speakBtnText: document.getElementById('speak-btn-text'),
  btnShare: document.getElementById('btn-share'),
  btnClear: document.getElementById('btn-clear'),

  capturedImg: document.getElementById('captured-img'),
  capturedPlaceholder: document.getElementById('captured-placeholder'),
  capturedContainer: document.getElementById('captured-container'),
  cropOverlay: document.getElementById('crop-overlay'),
  cropSelection: document.getElementById('crop-selection'),
  btnCropCard: document.getElementById('btn-crop-card'),
  btnCropAll: document.getElementById('btn-crop-all'),
  btnScanCrop: document.getElementById('btn-scan-crop'),
  btnToggleCrop: document.getElementById('btn-toggle-crop'),
  cropBtnLabel: document.getElementById('crop-btn-label'),
  btnSaveImage: document.getElementById('btn-save-image'),
  btnRotateImage: document.getElementById('btn-rotate-image'),
  btnFlipImage: document.getElementById('btn-flip-image'),
  btnRescanCurrent: document.getElementById('btn-rescan-current'),

  toastContainer: document.getElementById('toast-container')
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initSettingsUI();
  initModeUI();
  initTabs();
  initCropperUI();
  initEventListeners();
  renderHistory();
  startCameraStream();
  preloadOcrWorker();
});

// Mode Selector Handling
function initModeUI() {
  updateModeButtons();
  if (el.modeHandwriting) {
    el.modeHandwriting.addEventListener('click', () => {
      setOcrMode('handwriting');
    });
  }
  if (el.modePrinted) {
    el.modePrinted.addEventListener('click', () => {
      setOcrMode('printed');
    });
  }
}

function setOcrMode(mode) {
  currentOcrMode = mode;
  localStorage.setItem('esp32_ocr_mode', mode);
  updateModeButtons();
  const label = mode === 'handwriting' ? 'Handwritten & Scene Mode (AI Vision)' : 'Printed Document Mode (Tesseract)';
  showToast(`Switched to ${label}`, 'info');
}

function updateModeButtons() {
  if (!el.modeHandwriting || !el.modePrinted) return;
  if (currentOcrMode === 'handwriting') {
    el.modeHandwriting.classList.add('active');
    el.modePrinted.classList.remove('active');
  } else {
    el.modePrinted.classList.add('active');
    el.modeHandwriting.classList.remove('active');
  }
}

// Settings Handling
function initSettingsUI() {
  el.inputEspIp.value = config.espIp;
  el.inputPreviewRes.value = config.previewRes;
  el.inputCaptureEndpoint.value = config.captureEndpoint;
}

function saveSettings() {
  const newIp = el.inputEspIp.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!newIp) {
    showToast('Please provide a valid ESP32 IP address', 'danger');
    return;
  }
  config.espIp = newIp;
  config.previewRes = el.inputPreviewRes.value;
  config.captureEndpoint = el.inputCaptureEndpoint.value;

  localStorage.setItem('esp32_ip', config.espIp);
  localStorage.setItem('esp32_preview_res', config.previewRes);
  localStorage.setItem('esp32_capture_endpoint', config.captureEndpoint);

  el.settingsModal.classList.add('hidden');
  showToast('Settings saved. Reconnecting...', 'success');
  restartCameraStream();
}

// Connection & Live Camera Stream
function getBaseUrl() {
  return `http://${config.espIp}`;
}

function updateConnectionStatus(state, message) {
  el.statusBadge.className = `status-badge status-${state}`;
  el.statusLabel.textContent = message;
}

function restartCameraStream() {
  stopCameraStream();
  startCameraStream();
}

function startCameraStream() {
  isStreaming = true;
  el.btnToggleStream.classList.add('active');
  el.streamBtnText.textContent = 'Live';
  fetchNextFrame();
}

function stopCameraStream() {
  isStreaming = false;
  if (streamTimer) {
    clearTimeout(streamTimer);
    streamTimer = null;
  }
  el.btnToggleStream.classList.remove('active');
  el.streamBtnText.textContent = 'Paused';
}

// Utility: Base64 to Blob & Blob to Base64
function base64ToBlob(base64, mimeType = 'image/jpeg') {
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
  const byteChars = atob(cleanBase64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Robust image fetch using Native CapacitorHttp on Android to bypass CORS & Mixed Content
async function fetchEsp32Image(endpoint, timeoutMs = 8000) {
  const url = `${getBaseUrl()}${endpoint}?t=${Date.now()}`;

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      responseType: 'blob',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Camera returned HTTP status ${response.status}`);
    }

    if (!response.data) {
      throw new Error('No data received from camera');
    }

    const dataUrl = response.data.startsWith('data:')
      ? response.data
      : `data:image/jpeg;base64,${response.data}`;
    const blob = base64ToBlob(response.data, 'image/jpeg');

    return { blob, dataUrl };
  } else {
    // Browser fallback
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Camera returned HTTP status ${response.status}`);
    }
    const blob = await response.blob();
    return { blob, dataUrl: URL.createObjectURL(blob) };
  }
}

async function fetchNextFrame() {
  if (!isStreaming) return;

  try {
    const { dataUrl } = await fetchEsp32Image(config.previewRes, 3500);
    if (!isStreaming) return;

    el.viewfinderImg.src = dataUrl;
    el.placeholder.classList.add('hidden');
    updateConnectionStatus('connected', 'ESP32 Connected');

    streamTimer = setTimeout(fetchNextFrame, config.streamIntervalMs);
  } catch (err) {
    if (!isStreaming) return;
    el.placeholder.classList.remove('hidden');
    updateConnectionStatus('disconnected', 'Camera Offline');

    // Retry after 2.5s
    streamTimer = setTimeout(fetchNextFrame, 2500);
  }
}

function getFriendlyOcrStatus(status, progress) {
  if (!status) return 'Processing...';
  const s = status.toLowerCase();
  if (s.includes('loading') || s.includes('traineddata') || s.includes('initializing')) {
    return 'Initializing OCR AI Engine...';
  }
  if (s.includes('recognizing')) {
    return `Reading text from image... ${progress}%`;
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Pre-load offline Tesseract Worker in background
async function preloadOcrWorker() {
  if (ocrWorker) return ocrWorker;
  try {
    console.log('Initializing offline Tesseract.js worker...');

    ocrWorker = await createWorker('eng', 1, {
      workerPath: './tesseract/worker.min.js',
      corePath: './tesseract',
      langPath: './tesseract/lang-data',
      gzip: false,
      lstmOnly: true,
      logger: (m) => {
        if (isOcrBusy) {
          const progress = Math.round((m.progress || 0) * 100);
          const friendlyTitle = getFriendlyOcrStatus(m.status, progress);
          updateOcrProgress(friendlyTitle, progress);
        }
      }
    });
    console.log('Tesseract offline worker ready!');
    return ocrWorker;
  } catch (err) {
    console.warn('Initial offline worker preload notice:', err);
    return null;
  }
}

function updateOcrProgress(title, percent) {
  el.ocrStatusTitle.textContent = title;
  const pct = Math.min(100, Math.max(0, percent || 0));
  el.ocrProgressBar.style.width = `${pct}%`;
  el.ocrProgressPercent.textContent = `${pct}%`;
}

// Enhance image on canvas for Printed Documents
function preprocessImage(imageSource) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      const scale = img.width < 1000 ? 1.5 : 1;
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;

      let min = 255;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (gray < min) min = gray;
        if (gray > max) max = gray;
      }
      const range = Math.max(1, max - min);

      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const normalized = Math.min(255, Math.max(0, ((gray - min) / range) * 255));
        d[i] = normalized;
        d[i + 1] = normalized;
        d[i + 2] = normalized;
      }

      ctx.putImageData(imgData, 0, 0);
      canvas.toBlob((blob) => resolve(blob || imageSource), 'image/jpeg', 0.95);
    };

    img.onerror = () => resolve(imageSource);

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      img.src = URL.createObjectURL(imageSource);
    }
  });
}

// Specialized Preprocessing for Handwritten Text (Upscale + Pen Ink Contrast Boost)
function preprocessHandwriting(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      // Upscale 2.5x to smooth pen stroke curves
      const scale = 2.5;
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;

      // Autocontrast grayscale
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (g < min) min = g;
        if (g > max) max = g;
      }
      const range = Math.max(1, max - min);

      // Boost dark ink strokes on light paper
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const norm = ((g - min) / range) * 255;
        const enhanced = norm < 130 ? Math.max(0, norm * 0.6) : Math.min(255, norm * 1.25);
        d[i] = enhanced;
        d[i + 1] = enhanced;
        d[i + 2] = enhanced;
      }

      ctx.putImageData(imgData, 0, 0);
      canvas.toBlob((b) => resolve(b || blob), 'image/jpeg', 0.95);
    };
    img.onerror = () => resolve(blob);
    img.src = URL.createObjectURL(blob);
  });
}

// Noise filtering for OCR text
function filterOcrNoise(rawText, mode) {
  if (!rawText) return '';
  const lines = rawText.split('\n');
  const validLines = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (mode === 'handwriting') {
      const alphanum = trimmed.replace(/[^a-zA-Z0-9]/g, '');
      // Discard lines that are just 1-2 punctuation or symbol noise
      if (trimmed.length <= 2 && /[\\{}[\]|~^§_—=<>:;`'"]/.test(trimmed)) {
        continue;
      }
      if (alphanum.length === 0) {
        continue;
      }
    }
    validLines.push(trimmed);
  }

  return validLines.join('\n');
}

function rotateBlob(blob, degrees = 90, flipH = false) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (degrees === 90 || degrees === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      if (flipH) {
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      canvas.toBlob((b) => resolve(b || blob), 'image/jpeg', 0.95);
    };
    img.onerror = () => resolve(blob);
    img.src = URL.createObjectURL(blob);
  });
}

// Crop Blob based on normalized bounding box (x, y, width, height: 0..1)
function getCroppedBlob(imageElement, box) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const natW = imageElement.naturalWidth || imageElement.width;
    const natH = imageElement.naturalHeight || imageElement.height;

    const sx = Math.max(0, Math.round(box.x * natW));
    const sy = Math.max(0, Math.round(box.y * natH));
    const sWidth = Math.min(natW - sx, Math.round(box.width * natW));
    const sHeight = Math.min(natH - sy, Math.round(box.height * natH));

    canvas.width = Math.max(10, sWidth);
    canvas.height = Math.max(10, sHeight);

    ctx.drawImage(imageElement, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95);
  });
}

// Interactive Cropper Logic
function initCropperUI() {
  updateCropBoxUI();

  if (el.btnToggleCrop) {
    el.btnToggleCrop.addEventListener('click', () => {
      isCropActive = !isCropActive;
      el.cropOverlay.classList.toggle('hidden', !isCropActive);
      el.cropBtnLabel.textContent = isCropActive ? 'Crop: ON' : 'Crop Box';
      el.btnToggleCrop.classList.toggle('active', isCropActive);
      if (isCropActive) {
        updateCropBoxUI();
      }
    });
  }

  if (el.btnCropCard) {
    el.btnCropCard.addEventListener('click', () => {
      cropBox = { x: 0.22, y: 0.2, width: 0.56, height: 0.6 };
      isCropActive = true;
      el.cropOverlay.classList.remove('hidden');
      el.cropBtnLabel.textContent = 'Crop: ON';
      el.btnToggleCrop.classList.add('active');
      updateCropBoxUI();
      showToast('Centered Card Frame selected', 'info');
    });
  }

  if (el.btnCropAll) {
    el.btnCropAll.addEventListener('click', () => {
      cropBox = { x: 0, y: 0, width: 1, height: 1 };
      updateCropBoxUI();
      showToast('Full frame selected', 'info');
    });
  }

  if (el.btnScanCrop) {
    el.btnScanCrop.addEventListener('click', async () => {
      if (!currentCapturedBlob || isOcrBusy) return;
      showToast('Cropping region and running OCR...', 'info');
      const cropped = await getCroppedBlob(el.capturedImg, cropBox);
      if (cropped) {
        await processImageForOcr(cropped, 'Cropped Region');
      }
    });
  }

  setupCropBoxDrag();
}

function updateCropBoxUI() {
  if (!el.cropSelection) return;
  el.cropSelection.style.left = `${cropBox.x * 100}%`;
  el.cropSelection.style.top = `${cropBox.y * 100}%`;
  el.cropSelection.style.width = `${cropBox.width * 100}%`;
  el.cropSelection.style.height = `${cropBox.height * 100}%`;
}

function setupCropBoxDrag() {
  if (!el.cropSelection || !el.capturedContainer) return;

  let isDragging = false;
  let dragMode = 'move'; // 'move' or corner name ('tl', 'tr', 'bl', 'br')
  let startX = 0, startY = 0;
  let startBox = { ...cropBox };

  const onPointerDown = (e) => {
    e.preventDefault();
    isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;
    startBox = { ...cropBox };

    const target = e.target;
    if (target.classList.contains('crop-corner')) {
      if (target.classList.contains('tl')) dragMode = 'tl';
      else if (target.classList.contains('tr')) dragMode = 'tr';
      else if (target.classList.contains('bl')) dragMode = 'bl';
      else if (target.classList.contains('br')) dragMode = 'br';
    } else {
      dragMode = 'move';
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const rect = el.capturedContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = (clientX - startX) / rect.width;
    const dy = (clientY - startY) / rect.height;

    if (dragMode === 'move') {
      let nx = Math.max(0, Math.min(1 - startBox.width, startBox.x + dx));
      let ny = Math.max(0, Math.min(1 - startBox.height, startBox.y + dy));
      cropBox.x = nx;
      cropBox.y = ny;
    } else if (dragMode === 'br') {
      cropBox.width = Math.max(0.1, Math.min(1 - startBox.x, startBox.width + dx));
      cropBox.height = Math.max(0.1, Math.min(1 - startBox.y, startBox.height + dy));
    } else if (dragMode === 'tl') {
      const newX = Math.max(0, Math.min(startBox.x + startBox.width - 0.1, startBox.x + dx));
      const newY = Math.max(0, Math.min(startBox.y + startBox.height - 0.1, startBox.y + dy));
      cropBox.width = startBox.width - (newX - startBox.x);
      cropBox.height = startBox.height - (newY - startBox.y);
      cropBox.x = newX;
      cropBox.y = newY;
    }

    updateCropBoxUI();
  };

  const onPointerUp = () => {
    isDragging = false;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);
  };

  el.cropSelection.addEventListener('pointerdown', onPointerDown);
  el.cropSelection.addEventListener('touchstart', onPointerDown, { passive: false });
}

// Core OCR Execution
async function processImageForOcr(blob, sourceLabel = 'ESP32 Camera') {
  if (isOcrBusy) return;
  isOcrBusy = true;

  el.ocrOverlay.classList.remove('hidden');
  updateOcrProgress('Preparing photo for OCR...', 10);

  try {
    if (currentCapturedUrl) {
      URL.revokeObjectURL(currentCapturedUrl);
    }
    currentCapturedBlob = blob;
    currentCapturedUrl = URL.createObjectURL(blob);
    el.capturedImg.src = currentCapturedUrl;
    el.capturedImg.style.display = 'block';
    el.capturedPlaceholder.classList.add('hidden');
    el.btnSaveImage.disabled = false;
    el.btnRescanCurrent.disabled = false;
    if (el.btnRotateImage) el.btnRotateImage.disabled = false;
    if (el.btnFlipImage) el.btnFlipImage.disabled = false;
    if (el.btnToggleCrop) el.btnToggleCrop.disabled = false;
    if (el.btnCropCard) el.btnCropCard.disabled = false;
    if (el.btnCropAll) el.btnCropAll.disabled = false;
    if (el.btnScanCrop) el.btnScanCrop.disabled = false;

    let bestText = '';
    let bestConfidence = 0;
    let engineUsed = '';

    // Route 1: Google ML Kit Native On-Device Neural Vision (Latin Handwriting & Scene Text)
    const isNative = Capacitor.isNativePlatform();
    let nativeSuccess = false;

    if (isNative && (currentOcrMode === 'handwriting' || currentOcrMode === 'auto')) {
      try {
        updateOcrProgress('Running Google ML Kit Neural Vision...', 40);
        const base64Data = await blobToBase64(blob);
        const res = await NativeOcr.recognizeText({ base64: base64Data });

        if (res && res.text && res.text.trim().length > 0) {
          bestText = res.text.trim();
          bestConfidence = res.confidence || 92;
          engineUsed = 'Google ML Kit (AI Vision)';
          nativeSuccess = true;
          console.log('ML Kit OCR recognized:', bestText, 'Confidence:', bestConfidence);
        }
      } catch (nativeErr) {
        console.warn('Native ML Kit OCR notice, falling back to Tesseract:', nativeErr);
      }
    }

    // Route 2: Fallback or Printed Document Mode (Offline Tesseract.js)
    if (!nativeSuccess) {
      updateOcrProgress('Initializing Tesseract AI Engine...', 30);
      const worker = await preloadOcrWorker();
      if (!worker) {
        throw new Error('Failed to start OCR engine. Verify device storage access.');
      }

      if (currentOcrMode === 'handwriting') {
        engineUsed = 'Tesseract (Handwriting Filter)';
        updateOcrProgress('Enhancing ink contrast...', 45);
        const enhancedBlob = await preprocessHandwriting(blob);

        await worker.setParameters({
          tessedit_pageseg_mode: '6',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -.,!?'
        });

        updateOcrProgress('Reading handwritten characters...', 65);
        const res1 = await worker.recognize(enhancedBlob);
        let t1 = res1.data && res1.data.text ? res1.data.text.trim() : '';
        let c1 = res1.data && typeof res1.data.confidence === 'number' ? res1.data.confidence : 0;

        await worker.setParameters({ tessedit_pageseg_mode: '3' });
        updateOcrProgress('Fine-tuning layout...', 80);
        const res2 = await worker.recognize(enhancedBlob);
        let t2 = res2.data && res2.data.text ? res2.data.text.trim() : '';
        let c2 = res2.data && typeof res2.data.confidence === 'number' ? res2.data.confidence : 0;

        if (t2 && c2 >= c1) {
          bestText = t2;
          bestConfidence = c2;
        } else {
          bestText = t1;
          bestConfidence = c1;
        }

        bestText = filterOcrNoise(bestText, 'handwriting');
      } else {
        // Printed Document Mode
        engineUsed = 'Tesseract (Printed)';
        await worker.setParameters({ tessedit_pageseg_mode: '6' });
        updateOcrProgress('Reading printed document...', 50);
        const enhancedBlob = await preprocessImage(blob);
        const res = await worker.recognize(enhancedBlob);
        bestText = res.data && res.data.text ? res.data.text.trim() : '';
        bestConfidence = res.data && typeof res.data.confidence === 'number' ? res.data.confidence : 0;

        if (!bestText || bestConfidence < 30) {
          await worker.setParameters({ tessedit_pageseg_mode: '3' });
          const fb = await worker.recognize(blob);
          if (fb.data && fb.data.text) {
            bestText = fb.data.text.trim();
            bestConfidence = fb.data.confidence || 0;
          }
        }
      }
    }

    const confidence = Math.max(0, Math.round(bestConfidence));
    lastUsedEngine = engineUsed;

    if (el.metaEngine) {
      el.metaEngine.textContent = engineUsed;
    }

    // Populate results
    el.resultTextarea.value = bestText || '(No clear text detected. Check camera focus and lighting)';
    updateStats(bestText, confidence);

    // Switch to Text tab
    switchTab('text');

    // Save to Scan History
    addToHistory({
      timestamp: Date.now(),
      source: sourceLabel,
      confidence,
      engine: engineUsed,
      text: bestText || '(No text detected)',
      preview: currentCapturedUrl
    });

    if (bestText && confidence >= 40) {
      showToast(`Recognized with ${engineUsed}! (${confidence}% confidence)`, 'success');
    } else if (bestText) {
      showToast(`Low confidence (${confidence}%). Tip: Use Crop Box or rotate photo.`, 'info');
    } else {
      showToast('Scan complete, but no clear text was found.', 'danger');
    }
  } catch (err) {
    console.error('OCR Error:', err);
    showToast(`OCR Error: ${err.message || err}`, 'danger');
  } finally {
    isOcrBusy = false;
    el.ocrOverlay.classList.add('hidden');
  }
}

// Trigger Capture from ESP32
async function captureFromEsp32() {
  if (isOcrBusy) return;

  el.ocrOverlay.classList.remove('hidden');
  updateOcrProgress('Requesting photo from ESP32-CAM...', 5);

  try {
    const wasStreaming = isStreaming;
    stopCameraStream();

    const { blob } = await fetchEsp32Image(config.captureEndpoint, 15000);
    if (!blob || blob.size < 500) {
      throw new Error('Received empty or invalid image from ESP32.');
    }

    if (wasStreaming) {
      setTimeout(startCameraStream, 1500);
    }

    await processImageForOcr(blob, 'ESP32 Photo');
  } catch (err) {
    console.error('Capture error:', err);
    el.ocrOverlay.classList.add('hidden');
    showToast(`Capture failed: ${err.message || err}. Check ESP32 Wi-Fi connection.`, 'danger');
    if (isStreaming) {
      startCameraStream();
    }
  }
}

// Update text statistics
function updateStats(text, confidence) {
  const trimmed = text.trim();
  const words = trimmed.length > 0 ? trimmed.split(/\s+/).length : 0;
  const chars = trimmed.length;

  el.metaConfidence.textContent = confidence !== undefined ? `${confidence}%` : '--';
  el.metaWords.textContent = words.toLocaleString();
  el.metaChars.textContent = chars.toLocaleString();
}

// Copy to Clipboard Action
async function handleCopy() {
  const text = el.resultTextarea.value.trim();
  if (!text) {
    showToast('No text available to copy', 'danger');
    return;
  }

  let copied = false;
  try {
    await Clipboard.write({ string: text });
    copied = true;
  } catch {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      } else {
        el.resultTextarea.select();
        document.execCommand('copy');
        copied = true;
      }
    } catch (e) {
      console.error('Copy fallback failed:', e);
    }
  }

  if (copied) {
    el.btnCopy.classList.add('copied');
    el.copyTextLabel.textContent = 'Copied!';
    showToast('Text copied to clipboard!', 'success');
    setTimeout(() => {
      el.btnCopy.classList.remove('copied');
      el.copyTextLabel.textContent = 'Copy Text';
    }, 2000);
  } else {
    showToast('Failed to copy text', 'danger');
  }
}

// Read Aloud (Text-to-Speech)
function handleSpeak() {
  const text = el.resultTextarea.value.trim();
  if (!text) {
    showToast('No text to speak', 'danger');
    return;
  }

  if (!('speechSynthesis' in window)) {
    showToast('Text-to-speech not supported on this device', 'danger');
    return;
  }

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    el.speakBtnText.textContent = 'Speak';
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 1.0;

  utterance.onstart = () => {
    el.speakBtnText.textContent = 'Stop';
  };
  utterance.onend = () => {
    el.speakBtnText.textContent = 'Speak';
  };
  utterance.onerror = () => {
    el.speakBtnText.textContent = 'Speak';
  };

  window.speechSynthesis.speak(utterance);
}

// Share text
async function handleShare() {
  const text = el.resultTextarea.value.trim();
  if (!text) {
    showToast('No text to share', 'danger');
    return;
  }

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'ESP32 Recognized Text',
        text: text
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast('Could not share text', 'danger');
      }
    }
  } else {
    handleCopy();
  }
}

// Tab Switching
function switchTab(tabName) {
  el.tabs.forEach((tab) => {
    if (tab.getAttribute('data-tab') === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  el.tabContents.forEach((content) => {
    if (content.id === `tab-${tabName}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

function initTabs() {
  el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

// Scan History Management
function addToHistory(item) {
  scanHistory.unshift(item);
  if (scanHistory.length > 30) {
    scanHistory.pop();
  }
  try {
    localStorage.setItem('esp32_scan_history', JSON.stringify(scanHistory));
  } catch {
    scanHistory = scanHistory.slice(0, 15);
  }
  renderHistory();
}

function renderHistory() {
  if (!el.historyList) return;

  if (scanHistory.length === 0) {
    el.historyList.innerHTML = `
      <div class="history-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <p>No previous scans yet.</p>
      </div>`;
    return;
  }

  el.historyList.innerHTML = scanHistory
    .map((item, index) => {
      const dateStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const engineBadge = item.engine ? ` • ${item.engine.includes('ML Kit') ? 'AI Vision' : 'Tesseract'}` : '';
      return `
        <div class="history-item" data-index="${index}">
          <div class="history-item-header">
            <span>${item.source}${engineBadge} • ${dateStr}</span>
            <span>${item.confidence ? `${item.confidence}%` : ''}</span>
          </div>
          <div class="history-item-text">${escapeHtml(item.text)}</div>
        </div>
      `;
    })
    .join('');

  el.historyList.querySelectorAll('.history-item').forEach((itemEl) => {
    itemEl.addEventListener('click', () => {
      const idx = parseInt(itemEl.getAttribute('data-index'), 10);
      const record = scanHistory[idx];
      if (record) {
        el.resultTextarea.value = record.text;
        updateStats(record.text, record.confidence);
        if (el.metaEngine && record.engine) {
          el.metaEngine.textContent = record.engine;
        }
        el.historyDrawer.classList.add('hidden');
        switchTab('text');
        showToast('Loaded past scan', 'success');
      }
    });
  });
}

function clearAllHistory() {
  if (confirm('Clear all scan history?')) {
    scanHistory = [];
    localStorage.removeItem('esp32_scan_history');
    renderHistory();
    showToast('Scan history cleared', 'success');
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Toast notification
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  el.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// Event Listeners
function initEventListeners() {
  el.btnCapture.addEventListener('click', captureFromEsp32);

  el.fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      processImageForOcr(file, 'Gallery Upload');
    }
  });

  el.btnCopy.addEventListener('click', handleCopy);
  el.btnSpeak.addEventListener('click', handleSpeak);
  el.btnShare.addEventListener('click', handleShare);
  el.btnClear.addEventListener('click', () => {
    el.resultTextarea.value = '';
    updateStats('', 0);
  });

  el.resultTextarea.addEventListener('input', () => {
    updateStats(el.resultTextarea.value);
  });

  el.btnToggleStream.addEventListener('click', () => {
    if (isStreaming) {
      stopCameraStream();
    } else {
      startCameraStream();
    }
  });

  el.btnRetryConnect.addEventListener('click', () => {
    restartCameraStream();
  });

  el.btnGrid.addEventListener('click', () => {
    el.gridOverlay.classList.toggle('hidden');
  });

  el.btnSaveImage.addEventListener('click', () => {
    if (!currentCapturedUrl) return;
    const a = document.createElement('a');
    a.href = currentCapturedUrl;
    a.download = `esp32-scan-${Date.now()}.jpg`;
    a.click();
    showToast('Image downloaded', 'success');
  });

  el.btnRescanCurrent.addEventListener('click', () => {
    if (currentCapturedBlob) {
      processImageForOcr(currentCapturedBlob, 'Re-scanned Photo');
    }
  });

  if (el.btnRotateImage) {
    el.btnRotateImage.addEventListener('click', async () => {
      if (!currentCapturedBlob || isOcrBusy) return;
      showToast('Rotating photo 90°...', 'info');
      const rotated = await rotateBlob(currentCapturedBlob, 90, false);
      await processImageForOcr(rotated, 'Rotated Photo');
    });
  }

  if (el.btnFlipImage) {
    el.btnFlipImage.addEventListener('click', async () => {
      if (!currentCapturedBlob || isOcrBusy) return;
      showToast('Flipping photo horizontally...', 'info');
      const flipped = await rotateBlob(currentCapturedBlob, 0, true);
      await processImageForOcr(flipped, 'Flipped Photo');
    });
  }

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.classList.remove('hidden');
  });
  el.btnCloseSettings.addEventListener('click', () => {
    el.settingsModal.classList.add('hidden');
  });
  el.btnSaveSettings.addEventListener('click', saveSettings);

  el.btnHistory.addEventListener('click', () => {
    el.historyDrawer.classList.remove('hidden');
  });
  el.btnCloseHistory.addEventListener('click', () => {
    el.historyDrawer.classList.add('hidden');
  });
  el.btnClearHistory.addEventListener('click', clearAllHistory);
}
