/**
 * Libiry BookSpineScanner - Main Application
 * PWA to scan book spines and extract metadata using OCR
 */

import Tesseract from 'tesseract.js';

// ============================================================================
// State Management
// ============================================================================

const state = {
  currentScreen: 'main',
  previousScreen: null,  // For returning from settings
  currentImage: null,
  books: [],
  batchFiles: [],      // For multi-file batch processing
  batchIndex: 0,
  batchResults: [],
  scanCount: 0,
  isProcessing: false,
  isOffline: !navigator.onLine,
  deferredInstallPrompt: null, // PWA install prompt
  shelfTags: '',  // Tags for current shelf/scan (e.g. "type/analog, shelf/upper-left, wishlist")
  tagHistory: [], // Previously used tags for autocomplete suggestions
  settings: {
    lookupSources: {
      openlibrary: true,
      googlebooks: true,
      europeana: false,
      loc: false,
      amazon: false,
      goodreads: false,
      boekwinkeltjes: false,
      bolcom: false
    },
    ocrEngine: 'tesseract',
    language: 'eng+nld',
    exportFormat: 'obsidian', //now redundant
    filenamePattern: '[author] - [booktitle] - [DATE]_[SEQ].md',
    includeMetadata: true,
    includeConfidence: true,
    includePhotoInExport: false,
    darkMode: false,
    barcodeMode: false,
    googleApiKey: '',
    googleVisionApiKey: '',
    europeanaApiKey: '',
    fieldNames: {
      cover: '',
      booktitle: '',
      author: '',
      isbn: '',           // Was isbn_analog plus isbn_digital, simplified
      rating: '',         // Goodreads: My Rating
      publisher: '',      // Goodreads: Publisher
      year: '',           // Goodreads: Year Published
      language: '',       // Extra
      tags: '',           // Goodreads: Bookshelves
      series: '',         // Extra
      series_index: '',   // Extra
      description: '',    // Goodreads: My Review
      notes: ''           // Goodreads: Private Notes
    }
  },
  recentScans: []
};

// ============================================================================
// DOM Elements
// ============================================================================

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const elements = {
  screens: {
    main: $('#screen-main'),
    processing: $('#screen-processing'),
    results: $('#screen-results'),
    settings: $('#screen-settings')
  },
  fileInput: $('#file-input'),
  uploadArea: $('#upload-area'),
  btnCamera: $('#btn-camera'),
  btnSelectFile: $('#btn-select-file'),
  btnSettings: $('#btn-settings'),
  btnInfo: $('#btn-info'),
  btnSupport: $('#btn-support'),
  btnSettingsBack: $('#btn-settings-back'),
  btnCancel: $('#btn-cancel'),
  btnNewScan: $('#btn-new-scan'),
  btnExport: $('#btn-export'),
  previewImage: $('#preview-image'),
  detectionCanvas: $('#detection-canvas'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),
  resultsImage: $('#results-image'),
  resultsCanvas: $('#results-canvas'),
  resultsCount: $('#results-count'),
  booksList: $('#books-list'),
  recentList: $('#recent-list'),
  toast: $('#toast')
};

// ============================================================================
// Screen Navigation
// ============================================================================

function showScreen(screenName) {
  Object.values(elements.screens).forEach(screen => {
    screen.classList.remove('active');
  });
  elements.screens[screenName]?.classList.add('active');
  state.currentScreen = screenName;
}

// ============================================================================
// Settings Management
// ============================================================================

function loadSettings() {
  try {
    const saved = localStorage.getItem('bookspine-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(state.settings, parsed);

      // Migrate old isbn_analog/isbn_digital to single isbn field
      if (state.settings.fieldNames) {
        if (state.settings.fieldNames.isbn_analog !== undefined && state.settings.fieldNames.isbn === undefined) {
          state.settings.fieldNames.isbn = state.settings.fieldNames.isbn_analog;
          delete state.settings.fieldNames.isbn_analog;
          delete state.settings.fieldNames.isbn_digital;
          saveSettings(); // Persist migration
        }
      }

      // Migrate old lookupSource string to lookupSources object
      if (state.settings.lookupSource && !state.settings.lookupSources) {
        const oldSource = state.settings.lookupSource;
        state.settings.lookupSources = {
          openlibrary: oldSource === 'openlibrary' || oldSource === 'both' || oldSource === 'all',
          googlebooks: oldSource === 'googlebooks' || oldSource === 'both' || oldSource === 'all',
          europeana: oldSource === 'europeana' || oldSource === 'all',
          loc: oldSource === 'loc' || oldSource === 'all',
          amazon: oldSource === 'amazon' || oldSource === 'scrape' || oldSource === 'all',
          goodreads: oldSource === 'goodreads' || oldSource === 'scrape' || oldSource === 'all',
          boekwinkeltjes: oldSource === 'boekwinkeltjes' || oldSource === 'dutch' || oldSource === 'scrape' || oldSource === 'all',
          bolcom: oldSource === 'bolcom' || oldSource === 'dutch' || oldSource === 'scrape' || oldSource === 'all'
        };
        delete state.settings.lookupSource;
        saveSettings(); // Persist migration
      }
    } else {
      // No saved settings (new user): follow system dark mode preference
      state.settings.darkMode = window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }

  // Load tag history for autocomplete
  try {
    const tagHistory = localStorage.getItem('bookspine-tag-history');
    if (tagHistory) {
      state.tagHistory = JSON.parse(tagHistory);
    }
  } catch (e) {
    console.error('Failed to load tag history:', e);
  }

  applySettings();
}

function saveSettings() {
  try {
    localStorage.setItem('bookspine-settings', JSON.stringify(state.settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

/**
 * Save tag history to localStorage for autocomplete suggestions.
 * Keeps max 50 unique tags, most recently used first.
 */
function saveTagHistory() {
  try {
    localStorage.setItem('bookspine-tag-history', JSON.stringify(state.tagHistory));
  } catch (e) {
    console.error('Failed to save tag history:', e);
  }
}

/**
 * Add tags to history for autocomplete suggestions.
 * Tags are stored individually (not as comma-separated string).
 */
function addTagsToHistory(tagsString) {
  if (!tagsString || !tagsString.trim()) return;

  // Split by comma, trim whitespace, filter empty
  const newTags = tagsString.split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);

  // Add to front of history, remove duplicates, limit to 50
  const existing = new Set(state.tagHistory);
  for (const tag of newTags) {
    existing.delete(tag); // Remove if exists (will be re-added at front)
  }

  state.tagHistory = [...newTags, ...Array.from(existing)].slice(0, 50);
  saveTagHistory();
  updateTagSuggestions();
}

/**
 * Update the datalist with tag suggestions for autocomplete.
 */
function updateTagSuggestions() {
  const datalist = document.getElementById('tags-suggestions');
  if (!datalist) return;

  datalist.innerHTML = state.tagHistory
    .map(tag => `<option value="${tag}">`)
    .join('');
}

function applySettings() {
  // Apply dark mode
  const isDark = state.settings.darkMode;
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';

  // Switch header icons between light and dark variants
  // Volgorde: customize/icons(darkmode) > resources/icons(darkmode) > fallback
  const base = import.meta.env.BASE_URL;
  const iconFolder = isDark ? 'iconsdarkmode' : 'icons';

  // Helper functie om icon te laden met fallback chain
  const setIconWithFallback = (imgId, iconName) => {
    const img = document.getElementById(imgId);
    if (!img) return;

    // Probeer eerst customize/icons(darkmode), dan resources/icons(darkmode)
    img.src = `${base}customize/${iconFolder}/${iconName}.png`;
    img.onerror = function() {
      this.src = `${base}resources/${iconFolder}/${iconName}.png`;
      this.onerror = function() {
        // Laatste fallback: resources/icons (light mode versie)
        this.src = `${base}resources/icons/${iconName}.png`;
        this.onerror = null;
      };
    };
  };

  setIconWithFallback('gear-icon-img', 'gear');
  setIconWithFallback('info-icon-img', 'information');
  setIconWithFallback('support-icon-img', 'support');

  // Update lookup source checkboxes
  const sources = state.settings.lookupSources || {};
  const lookupIds = ['openlibrary', 'googlebooks', 'europeana', 'loc', 'amazon', 'goodreads', 'boekwinkeltjes', 'bolcom'];
  for (const id of lookupIds) {
    const checkbox = $(`#lookup-${id}`);
    if (checkbox) checkbox.checked = !!sources[id];
  }

  // Update form fields
  $('#setting-ocr-engine').value = state.settings.ocrEngine;
  $('#setting-language').value = state.settings.language;
  $('#setting-filename').value = state.settings.filenamePattern;
  $('#setting-metadata').checked = state.settings.includeMetadata;
  $('#setting-confidence').checked = state.settings.includeConfidence;
  $('#setting-include-photo').checked = state.settings.includePhotoInExport;
  $('#setting-darkmode').checked = state.settings.darkMode;
  $('#setting-apikey').value = state.settings.googleApiKey;
  $('#setting-vision-apikey').value = state.settings.googleVisionApiKey;
  // Europeana API key veld vullen indien aanwezig
  const europeanaKeyField = $('#setting-europeana-apikey');
  if (europeanaKeyField) europeanaKeyField.value = state.settings.europeanaApiKey || '';

  // Show/hide Vision API key field based on OCR engine selection
  const visionKeyGroup = $('#vision-apikey-group');
  if (visionKeyGroup) {
    visionKeyGroup.style.display = state.settings.ocrEngine === 'google' ? 'block' : 'none';
  }

  // Barcode mode
  const barcodeToggle = $('#setting-barcode');
  if (barcodeToggle) barcodeToggle.checked = state.settings.barcodeMode;

  // Field names
  $('#field-cover').value = state.settings.fieldNames.cover;
  $('#field-booktitle').value = state.settings.fieldNames.booktitle;
  $('#field-author').value = state.settings.fieldNames.author;
  $('#field-isbn-analog').value = state.settings.fieldNames.isbn;
  $('#field-tags').value = state.settings.fieldNames.tags || '';

  // Update tag autocomplete suggestions
  updateTagSuggestions();
}

function collectSettings() {
  // Collect lookup source checkboxes
  const lookupIds = ['openlibrary', 'googlebooks', 'europeana', 'loc', 'amazon', 'goodreads', 'boekwinkeltjes', 'bolcom'];
  state.settings.lookupSources = {};
  for (const id of lookupIds) {
    const checkbox = $(`#lookup-${id}`);
    state.settings.lookupSources[id] = checkbox ? checkbox.checked : false;
  }

  state.settings.ocrEngine = $('#setting-ocr-engine').value;
  state.settings.language = $('#setting-language').value;
  state.settings.filenamePattern = $('#setting-filename').value;
  state.settings.includeMetadata = $('#setting-metadata').checked;
  state.settings.includeConfidence = $('#setting-confidence').checked;
  state.settings.includePhotoInExport = $('#setting-include-photo').checked;
  state.settings.darkMode = $('#setting-darkmode').checked;
  state.settings.googleApiKey = $('#setting-apikey').value;
  state.settings.googleVisionApiKey = $('#setting-vision-apikey').value;
  // Europeana API key ophalen
  const europeanaKeyField = $('#setting-europeana-apikey');
  if (europeanaKeyField) state.settings.europeanaApiKey = europeanaKeyField.value;

  const barcodeEl = $('#setting-barcode');
  if (barcodeEl) state.settings.barcodeMode = barcodeEl.checked;

  state.settings.fieldNames.cover = $('#field-cover').value;
  state.settings.fieldNames.booktitle = $('#field-booktitle').value;
  state.settings.fieldNames.author = $('#field-author').value;
  state.settings.fieldNames.isbn = $('#field-isbn-analog').value;
  state.settings.fieldNames.tags = $('#field-tags').value;

  saveSettings();
  applySettings();
}

// ============================================================================
// Recent Scans
// ============================================================================

function loadRecentScans() {
  try {
    const saved = localStorage.getItem('bookspine-recent');
    if (saved) {
      state.recentScans = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load recent scans:', e);
  }
  renderRecentScans();
}

function saveRecentScans() {
  try {
    // Keep only last 10 scans
    const toSave = state.recentScans.slice(0, 10);
    localStorage.setItem('bookspine-recent', JSON.stringify(toSave));
  } catch (e) {
    console.error('Failed to save recent scans:', e);
  }
}

function addRecentScan(scan) {
  state.recentScans.unshift(scan);
  saveRecentScans();
  renderRecentScans();
}

function renderRecentScans() {
  if (state.recentScans.length === 0) {
    elements.recentList.innerHTML = '<p class="empty-state">No recent scans</p>';
    return;
  }

  elements.recentList.innerHTML = state.recentScans.map((scan, index) => `
    <div class="recent-item" data-index="${index}">
      <div class="recent-info">
        <div class="recent-name">${scan.filename || 'Scan'}</div>
        <div class="recent-meta">${scan.bookCount} books · ${formatDate(scan.date)}</div>
      </div>
    </div>
  `).join('');
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString();
}

// ============================================================================
// Image Handling
// ============================================================================

function handleFileSelect(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please select an image file');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    // Check image size (regel 203)
    const img = new Image();
    img.onload = () => {
      if (img.width < 1000 && img.height < 1000) {
        showToast('Warning: Image resolution is low (< 1000px). Results may be poor. Try a higher resolution photo.');
      }
      state.currentImage = {
        dataUrl: e.target.result,
        filename: file.name,
        file: file,
        width: img.width,
        height: img.height
      };
      processImage();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Batch processing: handle multiple files
function handleBatchFiles(files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) {
    showToast('No image files selected');
    return;
  }
  if (imageFiles.length === 1) {
    handleFileSelect(imageFiles[0]);
    return;
  }

  state.batchFiles = imageFiles;
  state.batchIndex = 0;
  state.batchResults = [];
  processBatch();
}

async function processBatch() {
  showScreen('processing');
  const total = state.batchFiles.length;

  for (let i = 0; i < total; i++) {
    state.batchIndex = i;
    updateProgress(
      Math.round((i / total) * 100),
      `Processing image ${i + 1} of ${total}...`
    );

    const file = state.batchFiles[i];
    const dataUrl = await readFileAsDataUrl(file);

    state.currentImage = {
      dataUrl,
      filename: file.name,
      file: file
    };

    try {
      let ocrText = '';
      if (state.settings.barcodeMode) {
        ocrText = await detectBarcodes(dataUrl);
      } else if (state.settings.ocrEngine === 'google') {
        ocrText = await runGoogleVisionOCR(dataUrl);
      } else {
        ocrText = await runTesseractOCR(dataUrl);
      }

      const parsedBooks = parseOcrText(ocrText);
      const books = await lookupBooks(parsedBooks);
      state.batchResults.push(...books);
    } catch (error) {
      console.error(`Batch error on file ${file.name}:`, error);
      showToast(`Error processing ${file.name}: ${error.message}`);
    }
  }

  state.books = state.batchResults;
  updateProgress(100, 'Done!');
  setTimeout(() => showResults(), 300);

  addRecentScan({
    filename: `Batch (${total} images)`,
    date: new Date().toISOString(),
    bookCount: state.books.length
  });

  state.batchFiles = [];
  state.batchResults = [];
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// Image Preprocessing (contrast, noise reduction, deskewing)
// ============================================================================

/**
 * Preprocess image for improved OCR accuracy (Tesseract only).
 *
 * IMPORTANT: This function is ONLY called when the OCR engine is Tesseract.
 * It is deliberately SKIPPED for Google Vision.
 *
 * WHY NOT FOR GOOGLE VISION:
 * Google Vision's DOCUMENT_TEXT_DETECTION performs its own sophisticated
 * preprocessing server-side (adaptive thresholding, deskewing, noise removal).
 * During testing, we found that running our histogram stretching BEFORE
 * sending to Google Vision actually DEGRADED results — the stretching can
 * clip subtle details that Google's own pipeline would have preserved.
 * User feedback confirmed: "zoekresultaten verslechterd" (search results
 * worsened) after we initially applied preprocessing to all engines.
 *
 * WHY YES FOR TESSERACT:
 * Tesseract.js runs in-browser with no server-side preprocessing. It
 * benefits significantly from contrast enhancement on book spine photos
 * which often have uneven lighting, shadows between books, and low contrast
 * between spine text and spine color.
 *
 * TECHNIQUE: Simple histogram stretching — finds the darkest and lightest
 * pixels, then stretches all pixel values to fill the full 0-255 range.
 * This maximizes contrast without introducing artifacts. We avoided more
 * aggressive approaches (adaptive thresholding, binarization) because
 * book spines have colored backgrounds where aggressive processing
 * destroys the text.
 */
function preprocessImage(imageDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Contrast enhancement (simple histogram stretching)
      let min = 255, max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (gray < min) min = gray;
        if (gray > max) max = gray;
      }
      const range = max - min || 1;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, Math.max(0, ((data[i] - min) / range) * 255));
        data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1] - min) / range) * 255));
        data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2] - min) / range) * 255));
      }

      // Sharpening (unsharp mask approximation)
      ctx.putImageData(imageData, 0, 0);
      ctx.globalCompositeOperation = 'source-over';

      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.src = imageDataUrl;
  });
}

// ============================================================================
// Spine Detection using OpenCV.js
// ============================================================================

let opencvLoaded = false;

function loadOpenCV() {
  if (opencvLoaded) return Promise.resolve();
  if (window.cv) { opencvLoaded = true; return Promise.resolve(); }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.x/opencv.js';
    script.async = true;
    script.onload = () => {
      // OpenCV.js needs a moment to initialize
      const checkReady = () => {
        if (window.cv && window.cv.Mat) {
          opencvLoaded = true;
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    };
    script.onerror = () => reject(new Error('Failed to load OpenCV.js'));
    document.head.appendChild(script);
  });
}

async function detectSpines(imageDataUrl) {
  try {
    await loadOpenCV();
    updateProgress(15, 'Detecting spines...');

    const img = new Image();
    await new Promise((resolve) => { img.onload = resolve; img.src = imageDataUrl; });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const cv = window.cv;
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    const edges = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();

    // Convert to grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Apply Gaussian blur for noise reduction
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    // Canny edge detection
    cv.Canny(gray, edges, 50, 150);

    // Dilate to connect edges
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 10));
    cv.dilate(edges, edges, kernel);

    // Find contours
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const regions = [];
    const minHeight = img.height * 0.3; // Spine should be at least 30% of image height
    const minWidth = 15;

    for (let i = 0; i < contours.size(); i++) {
      const rect = cv.boundingRect(contours.get(i));
      // Book spines are tall and narrow
      if (rect.height > minHeight && rect.width > minWidth && rect.height / rect.width > 2) {
        regions.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        });
      }
    }

    // Sort left to right
    regions.sort((a, b) => a.x - b.x);

    // Clean up OpenCV mats
    src.delete(); gray.delete(); edges.delete();
    contours.delete(); hierarchy.delete(); kernel.delete();

    return regions;
  } catch (error) {
    console.warn('Spine detection failed, falling back to full image OCR:', error);
    return [];
  }
}

function extractSpineRegion(imageDataUrl, region) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Add padding around the region
      const pad = 10;
      const x = Math.max(0, region.x - pad);
      const y = Math.max(0, region.y - pad);
      const w = Math.min(img.width - x, region.width + pad * 2);
      const h = Math.min(img.height - y, region.height + pad * 2);

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

      // If the region is taller than wide (vertical text), rotate 90 degrees
      if (h > w * 3) {
        const rotated = document.createElement('canvas');
        rotated.width = h;
        rotated.height = w;
        const rCtx = rotated.getContext('2d');
        rCtx.translate(h / 2, w / 2);
        rCtx.rotate(Math.PI / 2);
        rCtx.drawImage(canvas, -w / 2, -h / 2);
        resolve(rotated.toDataURL('image/jpeg', 0.95));
      } else {
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      }
    };
    img.src = imageDataUrl;
  });
}

// ============================================================================
// Barcode Detection
// ============================================================================

async function detectBarcodes(imageDataUrl) {
  // Try native BarcodeDetector API first (Chrome/Edge)
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'isbn'] });
      const img = new Image();
      await new Promise((resolve) => { img.onload = resolve; img.src = imageDataUrl; });

      const barcodes = await detector.detect(img);
      if (barcodes.length > 0) {
        return barcodes.map(b => b.rawValue).join('\n');
      }
    } catch (e) {
      console.warn('BarcodeDetector failed:', e);
    }
  }

  // Fallback: use OCR and extract ISBN patterns
  let ocrText = '';
  if (state.settings.ocrEngine === 'google') {
    ocrText = await runGoogleVisionOCR(imageDataUrl);
  } else {
    ocrText = await runTesseractOCR(imageDataUrl);
  }

  // Extract ISBN-like patterns (10 or 13 digits, possibly with hyphens)
  const isbnPattern = /(?:ISBN[:\s-]*)?(\d[\d\s-]{8,16}\d)/gi;
  const matches = ocrText.match(isbnPattern) || [];
  const isbns = matches.map(m => m.replace(/[^\d]/g, '')).filter(m => m.length === 10 || m.length === 13);

  return isbns.length > 0 ? isbns.join('\n') : ocrText;
}

// ============================================================================
// OCR Processing
// ============================================================================

let tesseractWorker = null;

async function initTesseract() {
  if (tesseractWorker) return tesseractWorker;

  updateProgress(5, 'Loading Tesseract OCR...');

  tesseractWorker = await Tesseract.createWorker(state.settings.language, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        const progress = Math.round(30 + m.progress * 50);
        updateProgress(progress, 'Reading text...');
      }
    }
  });

  return tesseractWorker;
}

async function runGoogleVisionOCR(imageDataUrl) {
  const apiKey = state.settings.googleVisionApiKey;
  if (!apiKey) {
    throw new Error('Google Cloud Vision API key not configured. Go to Settings to add your API key.');
  }

  // Extract base64 image data (remove data:image/...;base64, prefix)
  const base64Image = imageDataUrl.split(',')[1];

  // Use DOCUMENT_TEXT_DETECTION for better results on book spines
  // This is the same OCR engine used by Google Docs "Open with Google Docs"
  // It provides much better layout analysis and handles rotated text better
  const requestBody = {
    requests: [{
      image: {
        content: base64Image
      },
      features: [{
        type: 'DOCUMENT_TEXT_DETECTION',
        maxResults: 50
      }],
      imageContext: {
        languageHints: state.settings.language.split('+')
      }
    }]
  };

  updateProgress(30, 'Sending to Google Vision...');

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `API error: ${response.status}`);
  }

  updateProgress(60, 'Processing results...');

  const data = await response.json();
  const result = data.responses?.[0];

  // -----------------------------------------------------------------------
  // Extract text from Google Vision response, preserving spatial order.
  //
  // WHY NOT JUST USE fullTextAnnotation.text:
  // Google Vision's fullTextAnnotation.text is a single string with all
  // detected text. Its reading order follows Google's layout analysis
  // (typically top-to-bottom, left-to-right for a document page). But for
  // a bookshelf photo, text from different spines gets interleaved because
  // Google reads across the image rather than per-spine. This causes book
  // titles to get "shuffled" — the user reported exactly this problem.
  //
  // SOLUTION — Use the structured block data:
  // fullTextAnnotation.pages[].blocks[] contains individual text blocks,
  // each with a boundingBox (polygon with 4 vertices). We:
  // 1. Extract each block's text and its horizontal center (x-coordinate)
  // 2. Sort blocks by x-coordinate (left to right on the bookshelf)
  // 3. Group blocks that overlap horizontally (= same spine region)
  // 4. Join with "---" separators between groups (= between books)
  //
  // This preserves the physical left-to-right order of books on the shelf
  // and keeps text from the same spine together. The "---" separators
  // help parseOcrText() identify individual book boundaries.
  //
  // FALLBACK: If structured data isn't available (older API responses or
  // edge cases), we fall back to fullTextAnnotation.text or the simpler
  // textAnnotations[0].description.
  // -----------------------------------------------------------------------
  if (result?.fullTextAnnotation?.pages?.length > 0) {
    const blocks = [];

    // Step 1: Extract each text block with its horizontal position
    for (const page of result.fullTextAnnotation.pages) {
      for (const block of (page.blocks || [])) {
        if (block.blockType !== 'TEXT') continue;

        // Get the block's horizontal center from its bounding box vertices
        const vertices = block.boundingBox?.vertices || [];
        if (vertices.length < 4) continue;

        // x-center of the block (average of left and right edges)
        const xCenter = (vertices[0].x + vertices[1].x) / 2;
        // x-range for overlap detection
        const xMin = Math.min(vertices[0].x, vertices[3].x);
        const xMax = Math.max(vertices[1].x, vertices[2].x);

        // Reconstruct text from paragraphs → words → symbols
        let blockText = '';
        for (const paragraph of (block.paragraphs || [])) {
          for (const word of (paragraph.words || [])) {
            const wordText = (word.symbols || [])
              .map(s => s.text + (s.property?.detectedBreak ? getBreakChar(s.property.detectedBreak.type) : ''))
              .join('');
            blockText += wordText;
          }
        }
        blockText = blockText.trim();

        if (blockText.length > 0) {
          blocks.push({ text: blockText, xCenter, xMin, xMax });
        }
      }
    }

    if (blocks.length > 0) {
      // Step 2: Sort blocks by horizontal position (left to right)
      blocks.sort((a, b) => a.xCenter - b.xCenter);

      // Step 3: Group blocks that overlap horizontally (same spine)
      // A block belongs to the current group if its x-range overlaps
      // significantly with the group's combined x-range. We track the
      // group's x-range (groupXMin/Max) and expand it as blocks are added.
      //
      // Why compare against the whole group, not just the previous block:
      // A book spine may have a narrow title block and a wider publisher
      // block. If we only compared adjacent blocks, the publisher block
      // might not overlap with the title and would start a new group.
      // By tracking the group's full x-range, we catch all blocks that
      // fall within the same spine column.
      const groups = [];
      let currentGroup = [blocks[0]];
      let groupXMin = blocks[0].xMin;
      let groupXMax = blocks[0].xMax;

      for (let i = 1; i < blocks.length; i++) {
        const curr = blocks[i];

        // Check horizontal overlap between current block and the group
        const overlapMin = Math.max(groupXMin, curr.xMin);
        const overlapMax = Math.min(groupXMax, curr.xMax);
        const overlap = Math.max(0, overlapMax - overlapMin);
        const currWidth = curr.xMax - curr.xMin;

        if (currWidth > 0 && overlap / currWidth > 0.3) {
          // Significant overlap with group → same spine
          currentGroup.push(curr);
          groupXMin = Math.min(groupXMin, curr.xMin);
          groupXMax = Math.max(groupXMax, curr.xMax);
        } else {
          // No overlap → new spine group
          groups.push(currentGroup);
          currentGroup = [curr];
          groupXMin = curr.xMin;
          groupXMax = curr.xMax;
        }
      }
      groups.push(currentGroup);

      // Step 4: Join blocks within each group, separate groups with "---"
      const spineTexts = groups.map(group =>
        group.map(b => b.text).join('\n')
      );
      return spineTexts.join('\n---\n');
    }
  }

  // Fallback: use the plain text from fullTextAnnotation
  if (result?.fullTextAnnotation?.text) {
    return result.fullTextAnnotation.text;
  }

  // Last resort fallback: textAnnotations (simpler, less structured)
  const textAnnotations = result?.textAnnotations;
  if (!textAnnotations || textAnnotations.length === 0) {
    return '';
  }
  return textAnnotations[0].description || '';
}

/**
 * Convert Google Vision break type to a whitespace character.
 * Google Vision encodes line breaks and spaces as "detectedBreak" on the
 * last symbol of each word, rather than inserting whitespace characters.
 */
function getBreakChar(breakType) {
  switch (breakType) {
    case 'SPACE':
    case 'SURE_SPACE':
      return ' ';
    case 'EOL_SURE_SPACE':
    case 'LINE_BREAK':
      return '\n';
    case 'HYPHEN':
      return '-\n';
    default:
      return ' ';
  }
}

async function runTesseractOCR(imageDataUrl) {
  await initTesseract();
  updateProgress(30, 'Reading text with Tesseract...');
  const result = await tesseractWorker.recognize(imageDataUrl);
  return result.data.text;
}

async function processImage() {
  showScreen('processing');
  state.isProcessing = true;

  // Show preview
  elements.previewImage.src = state.currentImage.dataUrl;

  try {
    const originalImage = state.currentImage.dataUrl;
    let imageData = originalImage;

    // -----------------------------------------------------------------------
    // Preprocessing: ONLY for Tesseract, NEVER for Google Vision.
    //
    // See the JSDoc comment on preprocessImage() for the full rationale.
    // Short version: Google Vision does its own superior preprocessing
    // server-side. Our histogram stretching degrades Google Vision results.
    // -----------------------------------------------------------------------
    if (state.settings.ocrEngine !== 'google') {
      updateProgress(5, 'Preprocessing image...');
      imageData = await preprocessImage(imageData);
    }

    // Barcode mode: detect barcodes instead of text
    if (state.settings.barcodeMode) {
      updateProgress(10, 'Detecting barcodes...');
      const barcodeText = await detectBarcodes(originalImage);

      if (!barcodeText) {
        showToast('No barcodes detected. Try disabling barcode mode for text OCR.');
        showScreen('main');
        state.isProcessing = false;
        return;
      }

      // Each barcode/ISBN is a line
      const isbns = barcodeText.split('\n').filter(l => l.trim());
      updateProgress(60, 'Looking up ISBNs...');

      const books = [];
      for (const isbn of isbns) {
        const cleanIsbn = isbn.replace(/[^\d]/g, '');
        let bookData = null;
        try {
          const result = await searchOpenLibrary(`isbn:${cleanIsbn}`);
          if (result) bookData = result.best;
          if (!bookData) {
            const gbResult = await searchGoogleBooks(`isbn:${cleanIsbn}`);
            if (gbResult) bookData = gbResult.best;
          }
        } catch (e) { console.error('ISBN lookup error:', e); }

        // Spec 32: If a 13-digit ISBN was successfully read from the barcode
        // but no book was found in the lookup databases, mark as orange (medium)
        // rather than red (none). The ISBN is still valid and useful — the user
        // can look up the book manually or it may be found in other databases.
        const confidence = bookData ? 'high'
          : (cleanIsbn.length === 13 ? 'medium' : 'none');

        // If no book found in Open Library or Google Books, provide a
        // WorldCat search URL as booktitle so the user can look it up manually.
        const worldcatUrl = `https://search.worldcat.org/search?q=${cleanIsbn}&offset=1`;

        books.push({
          id: crypto.randomUUID(),
          rawOcr: isbn,
          preliminaryTitle: isbn,
          booktitle: bookData?.title || (!bookData && cleanIsbn ? worldcatUrl : ''),
          author: bookData?.author || '',
          isbn: cleanIsbn,
          cover: bookData?.cover || '',
          // Extra metadata uit API lookups
          publisher: bookData?.publisher || '',
          year: bookData?.year || '',
          language: bookData?.language || '',
          subjects: bookData?.subjects || '',
          description: bookData?.description || '',
          confidence,
          candidates: [],
        });
      }

      state.books = books;
      updateProgress(100, 'Done!');
      setTimeout(() => showResults(), 300);

      addRecentScan({
        filename: state.currentImage.filename,
        date: new Date().toISOString(),
        bookCount: books.length
      });

      state.isProcessing = false;
      return;
    }

    // -----------------------------------------------------------------------
    // OCR Engine Dispatch — Google Vision vs Tesseract
    //
    // CRITICAL ARCHITECTURE DECISION: The two engines use fundamentally
    // different strategies for reading book spines from a bookshelf photo.
    //
    // GOOGLE VISION — Full-image approach:
    //   Google Vision's DOCUMENT_TEXT_DETECTION analyzes the entire image
    //   at once. It performs its own layout analysis to identify text
    //   regions, handles rotated/vertical text (common on book spines),
    //   and understands spatial relationships between text blocks.
    //   Sending it fragmented spine regions HURTS accuracy because:
    //   - It loses context about neighboring spines
    //   - Its layout analysis works best with the full image
    //   - Small cropped regions can confuse its text detection
    //   This was discovered through user testing: results worsened
    //   significantly when we switched from full-image to per-spine OCR.
    //
    // TESSERACT — Per-spine-region approach:
    //   Tesseract.js runs locally in the browser. It has limited layout
    //   analysis compared to Google Vision. Feeding it the full bookshelf
    //   photo often produces garbled text because it struggles with:
    //   - Multiple text orientations (vertical spines next to each other)
    //   - Very small text regions within a large image
    //   - Mixed font sizes and colors across different spines
    //   By using OpenCV.js to detect individual spine regions first, then
    //   running Tesseract on each cropped/straightened region separately,
    //   we get much better results. The "---" separator between spine
    //   texts helps parseOcrText() identify individual books later.
    //
    // ALTERNATIVE APPROACHES WE TRIED AND REJECTED:
    //   1. Same strategy for both engines → Google Vision results degraded
    //   2. Per-spine for both → Tesseract was already doing this, fine;
    //      but Google Vision got worse (see above)
    //   3. Preprocessing for both → Histogram stretching hurt Google Vision
    //      (it clips subtle details that Google's own pipeline preserves)
    //   4. Full-image for both → Tesseract produced garbled multi-spine text
    // -----------------------------------------------------------------------
    let ocrText = '';

    if (state.settings.ocrEngine === 'google') {
      // Google Vision: send full image, let its DOCUMENT_TEXT_DETECTION
      // handle layout analysis and spine text extraction natively.
      updateProgress(10, 'Reading text with Google Vision...');
      ocrText = await runGoogleVisionOCR(imageData);
    } else {
      // Tesseract: use OpenCV.js spine detection to isolate individual
      // spine regions, then OCR each region separately for best results.
      updateProgress(10, 'Detecting spines...');
      const spineRegions = await detectSpines(imageData);

      if (spineRegions.length > 0) {
        // Spine regions found: OCR each one individually.
        // Results are joined with "---" separators so parseOcrText()
        // can identify book boundaries.
        const spineTexts = [];
        for (let i = 0; i < spineRegions.length; i++) {
          updateProgress(
            10 + Math.round((i / spineRegions.length) * 60),
            `Reading spine ${i + 1} of ${spineRegions.length}...`
          );
          const regionImage = await extractSpineRegion(imageData, spineRegions[i]);
          const text = await runTesseractOCR(regionImage);
          if (text.trim()) spineTexts.push(text.trim());
        }
        ocrText = spineTexts.join('\n---\n');
      } else {
        // No spine regions detected (e.g. single book photo, poor contrast).
        // Fall back to full-image OCR.
        updateProgress(10, 'Initializing OCR...');
        ocrText = await runTesseractOCR(imageData);
      }
    }

    console.log('OCR Result:', ocrText);

    if (!ocrText || ocrText.trim().length < 3) {
      showToast('No text detected. Try better lighting, a different angle, or a higher resolution image. You can also add books manually.');
      // Still show results screen with empty list so user can add manually
      state.books = [];
      showResults();
      state.isProcessing = false;
      return;
    }

    // Step 2: Parse OCR text into potential books
    updateProgress(80, 'Analyzing text...');
    const parsedBooks = parseOcrText(ocrText);

    // Step 3: Look up books (with offline handling)
    updateProgress(85, 'Looking up books...');
    let books;
    if (!navigator.onLine) {
      // Offline: skip lookup, mark all as needs review
      books = parsedBooks.map(parsed => ({
        id: crypto.randomUUID(),
        rawOcr: parsed.rawText || '',
        preliminaryTitle: parsed.possibleTitle || parsed.rawText || '',
        booktitle: '',
        author: parsed.possibleAuthor || '',
        isbn: '',
        cover: '',
        // Extra metadata (leeg in offline mode)
        publisher: '',
        year: '',
        language: '',
        subjects: '',
        description: '',
        confidence: 'none',
        candidates: [],
      }));
      showToast('Offline: book lookup skipped. Connect to internet and re-scan for better results.');
    } else {
      books = await lookupBooks(parsedBooks);
    }

    state.books = books;

    // Step 4: Show results
    updateProgress(100, 'Done!');
    setTimeout(() => {
      showResults();
    }, 300);

    // Save to recent
    addRecentScan({
      filename: state.currentImage.filename,
      date: new Date().toISOString(),
      bookCount: books.length
    });

  } catch (error) {
    console.error('Processing error:', error);
    // Specific error messages
    if (error.message?.includes('API key')) {
      showToast('Invalid API key. Check your key in Settings or switch to Tesseract.js (offline).');
    } else if (error.message?.includes('rate') || error.message?.includes('429')) {
      showToast('API rate limited. Please wait a moment and try again.');
    } else {
      showToast('Error processing image: ' + error.message);
    }
    showScreen('main');
  } finally {
    state.isProcessing = false;
  }
}

function updateProgress(percent, text) {
  elements.progressFill.style.width = percent + '%';
  elements.progressText.textContent = text;
}

// ============================================================================
// Text Parsing
// ============================================================================

/**
 * Parse raw OCR text into an array of potential book entries.
 *
 * INPUT FORMAT:
 * The OCR text may contain "---" separators between sections. These come
 * from two sources:
 * - Google Vision: runGoogleVisionOCR() groups text blocks by x-position
 *   (each group = one spine) and separates them with "---"
 * - Tesseract: when spine detection finds individual regions, their OCR
 *   results are joined with "---"
 *
 * PARSING STRATEGY:
 * 1. If "---" separators exist → each section is treated as one book.
 *    Within each section, the longest non-author line becomes the title,
 *    and lines matching author patterns become the author.
 * 2. If no "---" separators → fall back to the line-by-line heuristic
 *    where each substantial non-author line starts a new book entry.
 *
 * WHY THIS TWO-TIER APPROACH:
 * The "---" separator gives us confident book boundaries (from spatial
 * analysis of the image). Without it, we're guessing based on text alone,
 * which is error-prone — hence the simpler heuristic as fallback.
 */
function parseOcrText(text) {
  // Check if text contains "---" spine separators
  if (text.includes('\n---\n')) {
    // Structured input: each section between "---" markers is one spine/book
    const sections = text.split('\n---\n');
    const potentialBooks = [];

    for (const section of sections) {
      const lines = section.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 2 && !/^\d+$/.test(line));

      if (lines.length === 0) continue;

      // Within a spine section: find the most likely title and author
      let possibleTitle = '';
      let possibleAuthor = '';
      const allText = lines.join(' ');

      for (const line of lines) {
        if (isLikelyAuthor(line)) {
          if (!possibleAuthor) possibleAuthor = line;
        } else {
          // Title heuristic: prefer the longest non-author line
          // (book titles on spines tend to be more prominent than publisher names)
          if (line.length > possibleTitle.length) {
            possibleTitle = line;
          }
        }
      }

      // If no clear title found, use all text as raw
      if (!possibleTitle) possibleTitle = lines[0];

      potentialBooks.push({
        rawText: allText,
        possibleTitle,
        possibleAuthor: possibleAuthor || ''
      });
    }

    return potentialBooks.slice(0, 20);
  }

  // No "---" separators: fall back to line-by-line heuristic.
  // This happens when Google Vision's block structure is unavailable
  // or when Tesseract processes the full image without spine detection.
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 2);

  const potentialBooks = [];
  let currentBook = { rawText: '' };

  for (const line of lines) {
    if (line.length < 3 || /^\d+$/.test(line)) continue;

    if (isLikelyAuthor(line)) {
      currentBook.possibleAuthor = line;
    } else {
      if (currentBook.rawText || currentBook.possibleAuthor) {
        potentialBooks.push({ ...currentBook });
      }
      currentBook = {
        rawText: line,
        possibleTitle: line
      };
    }
  }

  if (currentBook.rawText || currentBook.possibleAuthor) {
    potentialBooks.push(currentBook);
  }

  return potentialBooks
    .filter(book => book.possibleTitle || book.rawText)
    .slice(0, 20);
}

function isLikelyAuthor(text) {
  // Common author patterns
  const authorPatterns = [
    /^[A-Z][a-z]+\s+[A-Z][a-z]+$/, // "John Smith"
    /^[A-Z]\.\s*[A-Z][a-z]+$/, // "J. Smith"
    /^[A-Z][a-z]+,\s*[A-Z]/, // "Smith, John"
  ];

  return authorPatterns.some(pattern => pattern.test(text.trim()));
}

// ============================================================================
// IndexedDB Cache for Book Lookups
// ============================================================================

const CACHE_DB_NAME = 'libiry-bookspinescanner-cache';
const CACHE_DB_VERSION = 1;
const CACHE_STORE_NAME = 'lookups';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function openCacheDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedLookup(source, query) {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
      const store = tx.objectStore(CACHE_STORE_NAME);
      const key = `${source}:${query.toLowerCase().trim()}`;
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result;
        if (result && (Date.now() - result.timestamp) < CACHE_MAX_AGE_MS) {
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCachedLookup(source, query, data) {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CACHE_STORE_NAME);
    store.put({
      key: `${source}:${query.toLowerCase().trim()}`,
      data,
      timestamp: Date.now()
    });
  } catch {
    // Cache write failure is non-critical
  }
}

// ============================================================================
// Rate Limiter
// ============================================================================

let lastOpenLibraryCall = 0;

async function rateLimitedFetch(url) {
  const now = Date.now();
  const elapsed = now - lastOpenLibraryCall;
  if (elapsed < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
  }
  lastOpenLibraryCall = Date.now();
  return fetch(url);
}

// ============================================================================
// Book Lookup
// ============================================================================

async function lookupBooks(parsedBooks) {
  const results = [];
  const HIGH_CONFIDENCE_THRESHOLD = 0.85;

  for (const parsed of parsedBooks) {
    const searchQuery = parsed.possibleTitle || parsed.rawText;

    // Early exit strategy: stop searching when we find a high confidence match.
    // This significantly speeds up lookups when exact title/author is provided.
    let allResults = [];
    let foundHighConfidence = false;

    // Helper to add result and check for early exit
    const addResult = (source, searchResult) => {
      if (!searchResult || !searchResult.best) return false;
      const score = calculateConfidenceScore(searchQuery, searchResult.best);
      allResults.push({
        source: source,
        bookData: searchResult.best,
        candidates: searchResult.candidates,
        score: score
      });
      // Return true if this is a high confidence match
      return score > HIGH_CONFIDENCE_THRESHOLD;
    };

    try {
      const sources = state.settings.lookupSources || {};

      // Open Library lookup (fast, reliable - check first)
      if (sources.openlibrary) {
        const olResult = await searchOpenLibrary(searchQuery);
        if (addResult('openlibrary', olResult)) foundHighConfidence = true;
      }

      // Google Books lookup
      if (!foundHighConfidence && sources.googlebooks) {
        const gbResult = await searchGoogleBooks(searchQuery);
        if (addResult('googlebooks', gbResult)) foundHighConfidence = true;
      }

      // Skip slower sources if we already have a high confidence match
      if (!foundHighConfidence) {
        // Europeana lookup
        if (sources.europeana) {
          const euResult = await searchEuropeana(searchQuery);
          if (addResult('europeana', euResult)) foundHighConfidence = true;
        }

        // Library of Congress lookup
        if (!foundHighConfidence && sources.loc) {
          const locResult = await searchLibraryOfCongress(searchQuery);
          if (addResult('loc', locResult)) foundHighConfidence = true;
        }

        // Amazon lookup - slower due to scraping
        if (!foundHighConfidence && sources.amazon) {
          const amazonResult = await searchAmazon(searchQuery);
          if (addResult('amazon', amazonResult)) foundHighConfidence = true;
        }

        // Goodreads lookup - slower due to scraping
        if (!foundHighConfidence && sources.goodreads) {
          const grResult = await searchGoodreads(searchQuery);
          if (addResult('goodreads', grResult)) foundHighConfidence = true;
        }

        // Boekwinkeltjes.nl lookup (Dutch second-hand books) - slower due to scraping
        if (!foundHighConfidence && sources.boekwinkeltjes) {
          const bwResult = await searchBoekwinkeltjes(searchQuery);
          if (addResult('boekwinkeltjes', bwResult)) foundHighConfidence = true;
        }

        // Bol.com lookup (Dutch e-commerce) - slower due to scraping
        if (!foundHighConfidence && sources.bolcom) {
          const bolResult = await searchBolCom(searchQuery);
          addResult('bolcom', bolResult);
        }
      }
    } catch (error) {
      console.error('Lookup error for:', searchQuery, error);
    }

    // Kies de beste match: hoogste similarity score wint
    // Bij gelijke score: voorkeur voor bronnen met cover image
    let bestResult = null;
    if (allResults.length > 0) {
      allResults.sort((a, b) => {
        // Primair: hoogste score wint
        if (b.score !== a.score) return b.score - a.score;
        // Secundair: voorkeur voor resultaat met cover
        const aHasCover = a.bookData.cover ? 1 : 0;
        const bHasCover = b.bookData.cover ? 1 : 0;
        return bHasCover - aHasCover;
      });
      bestResult = allResults[0];
    }

    // Combineer candidates van alle bronnen (voor dropdown bij medium confidence)
    const allCandidates = allResults.flatMap(r => r.candidates || []);
    // Verwijder duplicaten op basis van titel+auteur
    const uniqueCandidates = allCandidates.filter((candidate, index, self) =>
      index === self.findIndex(c =>
        c.title?.toLowerCase() === candidate.title?.toLowerCase() &&
        c.author?.toLowerCase() === candidate.author?.toLowerCase()
      )
    );

    const bookData = bestResult?.bookData || null;
    const confidenceScore = bestResult?.score || 0;
    const confidence = scoreToConfidence(confidenceScore);

    // Extra metadata velden in Goodreads volgorde
    results.push({
      id: crypto.randomUUID(),
      rawOcr: parsed.rawText || '',
      preliminaryTitle: parsed.possibleTitle || parsed.rawText || '', // Raw OCR text before lookup
      booktitle: bookData?.title || '',  // Only from lookup, not raw OCR
      author: bookData?.author || parsed.possibleAuthor || '',
      isbn: bookData?.isbn || '',
      cover: bookData?.cover || '',
      // Extra metadata uit API lookups (Goodreads volgorde)
      publisher: bookData?.publisher || '',
      year: bookData?.year || '',
      language: bookData?.language || '',
      description: bookData?.description || '',
      subjects: bookData?.subjects || '',  // API subjects (los van user-entered shelf tags)
      confidence: confidence,
      confidenceScore: confidenceScore,  // Numerieke score (0-1) voor export als percentage
      confidenceSource: bestResult?.source || '',  // Welke bron de beste match leverde
      candidates: uniqueCandidates,
      spineRegion: null // TODO: Add when spine detection is implemented
    });
  }

  return results;
}

async function searchOpenLibrary(query) {
  try {
    // Check cache first
    const cached = await getCachedLookup('openlibrary', query);
    if (cached) return cached;

    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`;
    const response = await rateLimitedFetch(url);
    const data = await response.json();

    if (!data.docs || data.docs.length === 0) return null;

    // Extra metadata velden ophalen uit Open Library API
    // Volgorde gebaseerd op Goodreads CSV export
    const candidates = data.docs.slice(0, 5).map(doc => ({
      title: doc.title,
      author: doc.author_name?.[0] || '',
      isbn: doc.isbn?.[0] || '',
      cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
      // Extra metadata in Goodreads volgorde
      publisher: doc.publisher?.[0] || '',
      year: doc.publish_year?.[0]?.toString() || '',
      language: doc.language?.[0] || '',
      description: doc.first_sentence?.value || doc.first_sentence || '',
      // subjects worden tags (Goodreads: Bookshelves)
      subjects: doc.subject?.slice(0, 5).join(', ') || ''
    }));

    const result = { best: candidates[0], candidates };
    await setCachedLookup('openlibrary', query, result);
    return result;
  } catch (error) {
    console.error('Open Library search error:', error);
    return null;
  }
}

async function searchGoogleBooks(query) {
  try {
    // Check cache first
    const cached = await getCachedLookup('googlebooks', query);
    if (cached) return cached;

    let url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`;

    if (state.settings.googleApiKey) {
      url += `&key=${state.settings.googleApiKey}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!data.items || data.items.length === 0) return null;

    // Extra metadata velden ophalen uit Google Books API
    // Volgorde gebaseerd op Goodreads CSV export
    const candidates = data.items.slice(0, 5).map(item => {
      const info = item.volumeInfo;
      const identifiers = info.industryIdentifiers || [];
      const isbn10 = identifiers.find(i => i.type === 'ISBN_10')?.identifier || '';
      const isbn13 = identifiers.find(i => i.type === 'ISBN_13')?.identifier || '';

      // Extract year from publishedDate (can be "2020-03-15" or "2020")
      let year = '';
      if (info.publishedDate) {
        year = info.publishedDate.split('-')[0];
      }

      return {
        title: info.title,
        author: info.authors?.[0] || '',
        isbn: isbn13 || isbn10,
        cover: info.imageLinks?.thumbnail || '',
        // Extra metadata in Goodreads volgorde
        publisher: info.publisher || '',
        year: year,
        language: info.language || '',
        description: info.description || '',
        // categories worden tags (Goodreads: Bookshelves)
        subjects: info.categories?.slice(0, 5).join(', ') || ''
      };
    });

    const result = { best: candidates[0], candidates };
    await setCachedLookup('googlebooks', query, result);
    return result;
  } catch (error) {
    console.error('Google Books search error:', error);
    return null;
  }
}

/**
 * Search Europeana API for book metadata
 * Europeana is strong for historical and European cultural heritage works
 * API docs: https://pro.europeana.eu/page/search
 *
 * @param {string} query - Search query (title, author, or combined)
 * @returns {Object|null} - { best, candidates } or null if not found
 */
async function searchEuropeana(query) {
  try {
    // Europeana vereist een API key
    if (!state.settings.europeanaApiKey) {
      console.warn('Europeana API key not configured');
      return null;
    }

    // Check cache first
    const cached = await getCachedLookup('europeana', query);
    if (cached) return cached;

    // Europeana Search API endpoint
    // qf=TYPE:TEXT filtert op tekstuele werken (boeken, manuscripten, etc.)
    // We zoeken ook specifiek naar "what:book" voor betere resultaten
    const url = `https://api.europeana.eu/record/v2/search.json?wskey=${state.settings.europeanaApiKey}&query=${encodeURIComponent(query)}&qf=TYPE:TEXT&rows=5&profile=standard`;

    const response = await fetch(url);

    if (!response.ok) {
      console.error('Europeana API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) return null;

    // Map Europeana response naar ons standaard formaat
    // Europeana structuur is anders: dcCreator, dcTitleLangAware, etc.
    const candidates = data.items.slice(0, 5).map(item => {
      // Titel: probeer eerst dcTitleLangAware, dan title array
      let title = '';
      if (item.dcTitleLangAware) {
        // dcTitleLangAware is een object met taalcodes als keys
        const titleObj = item.dcTitleLangAware;
        // Probeer Nederlands, Engels, of neem de eerste beschikbare
        title = titleObj.nl?.[0] || titleObj.en?.[0] || titleObj.def?.[0] ||
                Object.values(titleObj)[0]?.[0] || '';
      } else if (item.title && item.title.length > 0) {
        title = item.title[0];
      }

      // Auteur: dcCreator array
      let author = '';
      if (item.dcCreator && item.dcCreator.length > 0) {
        author = item.dcCreator[0];
      } else if (item.dcCreatorLangAware) {
        const creatorObj = item.dcCreatorLangAware;
        author = creatorObj.def?.[0] || Object.values(creatorObj)[0]?.[0] || '';
      }

      // Cover/thumbnail: edmPreview of edmIsShownBy
      let cover = '';
      if (item.edmPreview && item.edmPreview.length > 0) {
        cover = item.edmPreview[0];
      } else if (item.edmIsShownBy && item.edmIsShownBy.length > 0) {
        cover = item.edmIsShownBy[0];
      }

      // ISBN: Europeana heeft zelden ISBN, maar we proberen dcIdentifier
      // Europeana focust op cultureel erfgoed, niet moderne ISBN-catalogisering
      let isbn = '';
      if (item.dcIdentifier) {
        // Zoek naar iets dat op een ISBN lijkt (10 of 13 cijfers)
        const isbnMatch = item.dcIdentifier.find(id =>
          /^(?:\d{10}|\d{13}|97[89]\d{10})$/.test(id?.replace(/[-\s]/g, ''))
        );
        if (isbnMatch) {
          isbn = isbnMatch.replace(/[-\s]/g, '');
        }
      }

      // Extra metadata velden uit Europeana
      // Publisher: dcPublisher
      let publisher = '';
      if (item.dcPublisher && item.dcPublisher.length > 0) {
        publisher = item.dcPublisher[0];
      }

      // Year: jaar uit dcDate of year veld
      let year = '';
      if (item.year && item.year.length > 0) {
        year = item.year[0];
      } else if (item.dcDate && item.dcDate.length > 0) {
        // Probeer jaar te extraheren uit dcDate (kan "1920", "1920-01-01", etc. zijn)
        const dateMatch = item.dcDate[0].match(/\d{4}/);
        if (dateMatch) year = dateMatch[0];
      }

      // Language: dcLanguage
      let language = '';
      if (item.dcLanguage && item.dcLanguage.length > 0) {
        language = item.dcLanguage[0];
      }

      // Description: dcDescription
      let description = '';
      if (item.dcDescription && item.dcDescription.length > 0) {
        description = item.dcDescription[0];
      } else if (item.dcDescriptionLangAware) {
        const descObj = item.dcDescriptionLangAware;
        description = descObj.nl?.[0] || descObj.en?.[0] || descObj.def?.[0] ||
                      Object.values(descObj)[0]?.[0] || '';
      }

      // Subjects: dcSubject (voor tags)
      let subjects = '';
      if (item.dcSubject && item.dcSubject.length > 0) {
        subjects = item.dcSubject.slice(0, 5).join(', ');
      }

      return {
        title: title,
        author: author,
        isbn: isbn,
        cover: cover,
        // Extra metadata in Goodreads volgorde
        publisher: publisher,
        year: year,
        language: language,
        description: description,
        subjects: subjects,
        // Extra info voor debug/display
        europeanaId: item.id,
        dataProvider: item.dataProvider?.[0] || ''
      };
    });

    // Filter kandidaten zonder titel eruit
    const validCandidates = candidates.filter(c => c.title);

    if (validCandidates.length === 0) return null;

    const result = { best: validCandidates[0], candidates: validCandidates };
    await setCachedLookup('europeana', query, result);
    return result;
  } catch (error) {
    console.error('Europeana search error:', error);
    return null;
  }
}

/**
 * Search Library of Congress SRU API for book metadata
 * Strong for academic works, historical publications, and authoritative bibliographic data
 * API docs: https://www.loc.gov/apis/additional-apis/search-retrieval-via-url/
 *
 * Note: LoC returns XML (Dublin Core), not JSON, and does not provide cover images.
 *
 * @param {string} query - Search query (title, author, ISBN, or combined)
 * @returns {Object|null} - { best, candidates } or null if not found
 */
async function searchLibraryOfCongress(query) {
  try {
    // Check cache first
    const cached = await getCachedLookup('loc', query);
    if (cached) return cached;

    // SRU endpoint met Dublin Core schema (eenvoudiger te parsen dan MARCXML)
    // CQL query: zoek in alle velden met de query
    // bath.isbn voor ISBN zoekopdrachten, anders dc.title of algemeen
    let cqlQuery;
    const cleanQuery = query.replace(/[-\s]/g, '');

    // Check of het een ISBN is (10 of 13 cijfers)
    if (/^(\d{10}|\d{13}|97[89]\d{10})$/.test(cleanQuery)) {
      cqlQuery = `bath.isbn="${cleanQuery}"`;
    } else {
      // Algemene zoekopdracht - escape speciale CQL karakters
      const escapedQuery = query.replace(/"/g, '\\"');
      cqlQuery = `dc.title="${escapedQuery}" or dc.creator="${escapedQuery}"`;
    }

    const url = `https://lx2.loc.gov/sru/lcdb?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(cqlQuery)}&recordSchema=dc&maximumRecords=5`;

    const response = await fetch(url);

    if (!response.ok) {
      console.error('Library of Congress API error:', response.status, response.statusText);
      return null;
    }

    const xmlText = await response.text();

    // Parse XML response
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    // Check voor parse errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      console.error('LoC XML parse error:', parseError.textContent);
      return null;
    }

    // Zoek Dublin Core records in de response
    // SRU response structuur: searchRetrieveResponse > records > record > recordData > dc
    const records = xmlDoc.querySelectorAll('record');

    if (!records || records.length === 0) return null;

    const candidates = [];

    for (const record of records) {
      // Dublin Core velden extraheren
      // Namespace kan variëren, dus we zoeken case-insensitief
      const getField = (fieldName) => {
        // Probeer met en zonder namespace prefix
        const el = record.querySelector(`dc\\:${fieldName}, ${fieldName}`);
        return el ? el.textContent.trim() : '';
      };

      const getAllFields = (fieldName) => {
        const els = record.querySelectorAll(`dc\\:${fieldName}, ${fieldName}`);
        return Array.from(els).map(el => el.textContent.trim()).filter(Boolean);
      };

      const title = getField('title');
      const creator = getField('creator');
      const publisher = getField('publisher');
      const date = getField('date');
      const language = getField('language');
      const description = getField('description');
      const subjects = getAllFields('subject');
      const identifiers = getAllFields('identifier');

      // ISBN uit identifiers halen
      let isbn = '';
      for (const id of identifiers) {
        // Zoek naar ISBN patroon
        const isbnMatch = id.match(/(?:ISBN[:\s]*)?(\d{10}|\d{13}|97[89][\d-]{10,14})/i);
        if (isbnMatch) {
          isbn = isbnMatch[1].replace(/[-\s]/g, '');
          break;
        }
      }

      // LCCN (Library of Congress Control Number) uit identifiers
      let lccn = '';
      for (const id of identifiers) {
        if (id.toLowerCase().includes('lccn') || /^\d{8,10}$/.test(id)) {
          lccn = id.replace(/[^\d]/g, '');
          break;
        }
      }

      // Jaar uit date extraheren
      let year = '';
      if (date) {
        const yearMatch = date.match(/\d{4}/);
        if (yearMatch) year = yearMatch[0];
      }

      if (title) {
        candidates.push({
          title: title,
          author: creator,
          isbn: isbn,
          cover: '',  // LoC levert geen cover images
          publisher: publisher,
          year: year,
          language: language,
          description: description,
          subjects: subjects.slice(0, 5).join(', '),
          // Extra LoC-specifieke velden
          lccn: lccn,
          source: 'Library of Congress'
        });
      }
    }

    if (candidates.length === 0) return null;

    const result = { best: candidates[0], candidates: candidates };
    await setCachedLookup('loc', query, result);
    return result;
  } catch (error) {
    console.error('Library of Congress search error:', error);
    return null;
  }
}

// =============================================================================
// CORS Proxy Helper for Web Scraping
// =============================================================================

/**
 * Fetch URL through a CORS proxy to bypass browser restrictions.
 * Uses corsproxy.io which is reliable and fast.
 * Falls back to allorigins.win if first proxy fails.
 *
 * @param {string} url - The URL to fetch
 * @returns {Promise<string>} - HTML content of the page
 */
async function fetchViaCorsProxy(url) {
  // Primary proxy: corsproxy.io (fast, reliable)
  const primaryProxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;

  try {
    const response = await fetch(primaryProxy, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      return await response.text();
    }
  } catch (e) {
    console.warn('Primary CORS proxy failed, trying fallback...', e);
  }

  // Fallback proxy: allorigins.win
  try {
    const fallbackProxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const fallbackResponse = await fetch(fallbackProxy, { signal: AbortSignal.timeout(10000) });

    if (fallbackResponse.ok) {
      return await fallbackResponse.text();
    }
  } catch (e) {
    console.warn('Fallback CORS proxy also failed:', e);
  }

  // Both proxies failed - return empty string instead of throwing
  // This prevents the error from bubbling up and crashing the UI
  console.error('All CORS proxies failed for:', url);
  return '';
}

// =============================================================================
// Amazon Scraping (International books)
// =============================================================================

/**
 * Search Amazon for book metadata.
 * Amazon has the largest book catalog worldwide.
 * Uses amazon.com for broadest coverage.
 *
 * @param {string} query - Search query (title, author, or combined)
 * @returns {Object|null} - { best, candidates } or null if not found
 */
async function searchAmazon(query) {
  try {
    // Check cache first
    const cached = await getCachedLookup('amazon', query);
    if (cached) return cached;

    // Search in Books category on Amazon.com
    const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=stripbooks`;
    const html = await fetchViaCorsProxy(searchUrl);

    // If proxy failed, return null gracefully
    if (!html || html.length < 100) {
      console.log('Amazon: No response from proxy');
      return null;
    }

    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Amazon uses data-component-type="s-search-result" for search results
    const searchResults = doc.querySelectorAll('[data-component-type="s-search-result"], .s-result-item');

    const candidates = [];
    const results = Array.from(searchResults).slice(0, 5);

    for (const item of results) {
      // Skip sponsored items
      if (item.querySelector('[data-component-type="sp-sponsored-result"]')) continue;

      // Extract title
      let title = '';
      const titleEl = item.querySelector('h2 a span, h2 span, .a-text-normal');
      if (titleEl) {
        title = titleEl.textContent.trim();
      }

      // Extract author (usually in a div below title)
      let author = '';
      const authorEl = item.querySelector('.a-row .a-size-base+ .a-size-base, [class*="author"], .a-color-secondary');
      if (authorEl) {
        author = authorEl.textContent.replace(/^by\s+/i, '').trim();
      }

      // Extract cover image
      let cover = '';
      const imgEl = item.querySelector('img.s-image, img[data-image-latency="s-product-image"]');
      if (imgEl && imgEl.src) {
        cover = imgEl.src;
      }

      // Extract ASIN (Amazon's ID) from data attribute or URL
      let isbn = '';
      const asin = item.dataset.asin;
      if (asin && /^\d{10}$/.test(asin)) {
        // 10-digit ASIN might be ISBN-10
        isbn = asin;
      }

      if (title) {
        candidates.push({
          title: title,
          author: author,
          isbn: isbn,
          cover: cover,
          publisher: '',
          year: '',
          language: '',
          description: '',
          subjects: '',
          source: 'Amazon'
        });
      }
    }

    if (candidates.length === 0) return null;

    const result = { best: candidates[0], candidates };
    await setCachedLookup('amazon', query, result);
    return result;

  } catch (error) {
    console.error('Amazon search error:', error);
    return null;
  }
}

// =============================================================================
// Goodreads Scraping (Book community & reviews)
// =============================================================================

/**
 * Search Goodreads for book metadata.
 * Goodreads has extensive book data with community ratings and reviews.
 * Good for finding books with reader reviews and ratings.
 *
 * @param {string} query - Search query (title, author, or combined)
 * @returns {Object|null} - { best, candidates } or null if not found
 */
async function searchGoodreads(query) {
  try {
    // Check cache first
    const cached = await getCachedLookup('goodreads', query);
    if (cached) return cached;

    const searchUrl = `https://www.goodreads.com/search?q=${encodeURIComponent(query)}`;
    const html = await fetchViaCorsProxy(searchUrl);

    // If proxy failed, return null gracefully
    if (!html || html.length < 100) {
      console.log('Goodreads: No response from proxy');
      return null;
    }

    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Goodreads uses table rows for search results
    const bookRows = doc.querySelectorAll('tr[itemtype="http://schema.org/Book"], .tableList tr, .bookTitle');

    const candidates = [];
    const results = Array.from(bookRows).slice(0, 5);

    for (const row of results) {
      // Extract title
      let title = '';
      const titleEl = row.querySelector('.bookTitle, [itemprop="name"], a.bookTitle');
      if (titleEl) {
        title = titleEl.textContent.trim();
      }

      // Extract author
      let author = '';
      const authorEl = row.querySelector('.authorName, [itemprop="author"], a.authorName');
      if (authorEl) {
        author = authorEl.textContent.trim();
      }

      // Extract cover image
      let cover = '';
      const imgEl = row.querySelector('img.bookCover, img[itemprop="image"]');
      if (imgEl) {
        cover = imgEl.src || imgEl.dataset.src || '';
        // Goodreads sometimes uses small thumbnails, try to get larger version
        if (cover.includes('._SX')) {
          cover = cover.replace(/\._SX\d+_/, '._SX300_');
        }
      }

      // Extract rating if available
      let rating = '';
      const ratingEl = row.querySelector('.minirating, [itemprop="ratingValue"]');
      if (ratingEl) {
        const ratingMatch = ratingEl.textContent.match(/[\d.]+/);
        if (ratingMatch) rating = ratingMatch[0];
      }

      // Extract ISBN from URL or page
      let isbn = '';
      const linkEl = row.querySelector('a[href*="/book/show/"]');
      if (linkEl) {
        const isbnMatch = linkEl.href.match(/(\d{10}|\d{13})/);
        if (isbnMatch) isbn = isbnMatch[1];
      }

      if (title) {
        candidates.push({
          title: title,
          author: author,
          isbn: isbn,
          cover: cover,
          publisher: '',
          year: '',
          language: '',
          description: '',
          subjects: '',
          rating: rating,
          source: 'Goodreads'
        });
      }
    }

    if (candidates.length === 0) return null;

    const result = { best: candidates[0], candidates };
    await setCachedLookup('goodreads', query, result);
    return result;

  } catch (error) {
    console.error('Goodreads search error:', error);
    return null;
  }
}

// =============================================================================
// Boekwinkeltjes.nl Scraping (Dutch second-hand books)
// =============================================================================

/**
 * Search boekwinkeltjes.nl for book metadata.
 * Boekwinkeltjes is a Dutch marketplace for second-hand and antiquarian books.
 * Good for Dutch books and older editions.
 *
 * @param {string} query - Search query (title, author, or combined)
 * @returns {Object|null} - { best, candidates } or null if not found
 */
async function searchBoekwinkeltjes(query) {
  try {
    // Check cache first
    const cached = await getCachedLookup('boekwinkeltjes', query);
    if (cached) return cached;

    const searchUrl = `https://www.boekwinkeltjes.nl/s/?q=${encodeURIComponent(query)}`;
    const html = await fetchViaCorsProxy(searchUrl);

    // If proxy failed, return null gracefully
    if (!html || html.length < 100) {
      console.log('Boekwinkeltjes: No response from proxy');
      return null;
    }

    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Boekwinkeltjes uses article.book-card for search results
    const bookCards = doc.querySelectorAll('article.book-card, .search-result, .book-item');

    if (!bookCards || bookCards.length === 0) {
      // Try alternative selectors
      const altResults = doc.querySelectorAll('[class*="result"], [class*="book"]');
      if (!altResults || altResults.length === 0) {
        console.log('Boekwinkeltjes: No results found for', query);
        return null;
      }
    }

    const candidates = [];

    // Iterate through results (limit to first 5)
    const results = Array.from(bookCards).slice(0, 5);

    for (const card of results) {
      // Extract title - look for common title patterns
      let title = '';
      const titleEl = card.querySelector('h2, h3, .title, [class*="title"], a[href*="/b/"]');
      if (titleEl) {
        title = titleEl.textContent.trim();
      }

      // Extract author
      let author = '';
      const authorEl = card.querySelector('.author, [class*="author"], .creator');
      if (authorEl) {
        author = authorEl.textContent.trim();
      }

      // Extract price (useful indicator of result relevance)
      let price = '';
      const priceEl = card.querySelector('.price, [class*="price"]');
      if (priceEl) {
        price = priceEl.textContent.trim();
      }

      // Extract cover image
      let cover = '';
      const imgEl = card.querySelector('img');
      if (imgEl && imgEl.src) {
        cover = imgEl.src;
        // Make sure it's absolute URL
        if (cover.startsWith('/')) {
          cover = 'https://www.boekwinkeltjes.nl' + cover;
        }
      }

      // Extract ISBN if available (often in details or data attributes)
      let isbn = '';
      const isbnMatch = card.innerHTML.match(/(?:ISBN[:\s]*)?(\d{10}|\d{13})/i);
      if (isbnMatch) {
        isbn = isbnMatch[1];
      }

      if (title) {
        candidates.push({
          title: title,
          author: author,
          isbn: isbn,
          cover: cover,
          publisher: '',
          year: '',
          language: 'nld',  // Boekwinkeltjes is Dutch-focused
          description: '',
          subjects: '',
          source: 'Boekwinkeltjes.nl',
          price: price
        });
      }
    }

    if (candidates.length === 0) return null;

    const result = { best: candidates[0], candidates };
    await setCachedLookup('boekwinkeltjes', query, result);
    return result;

  } catch (error) {
    console.error('Boekwinkeltjes search error:', error);
    return null;
  }
}

// =============================================================================
// Bol.com Scraping (Dutch e-commerce)
// =============================================================================

/**
 * Search bol.com for book metadata.
 * Bol.com is the largest Dutch e-commerce site with extensive book catalog.
 * Good for current Dutch and international books.
 *
 * Note: Bol.com has anti-bot measures. Results may be limited.
 *
 * @param {string} query - Search query (title, author, or combined)
 * @returns {Object|null} - { best, candidates } or null if not found
 */
async function searchBolCom(query) {
  try {
    // Check cache first
    const cached = await getCachedLookup('bolcom', query);
    if (cached) return cached;

    // Search specifically in books category
    const searchUrl = `https://www.bol.com/nl/nl/s/?searchtext=${encodeURIComponent(query)}&categoryId=8299`;
    const html = await fetchViaCorsProxy(searchUrl);

    // If proxy failed, return null gracefully
    if (!html || html.length < 100) {
      console.log('Bol.com: No response from proxy');
      return null;
    }

    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Bol.com uses various product card classes
    const productCards = doc.querySelectorAll('[data-test="product-title"], .product-item, [class*="product-card"]');

    const candidates = [];

    // If direct product cards not found, try finding product links
    let productElements = Array.from(productCards);
    if (productElements.length === 0) {
      // Alternative: find any product-related elements
      const links = doc.querySelectorAll('a[href*="/p/"], [class*="product"]');
      productElements = Array.from(links).slice(0, 5);
    }

    // Limit to first 5 results
    productElements = productElements.slice(0, 5);

    for (const el of productElements) {
      // Find the parent product container
      const card = el.closest('[class*="product"]') || el;

      // Extract title
      let title = '';
      const titleEl = card.querySelector('[data-test="product-title"], h3, .product-title, [class*="title"]');
      if (titleEl) {
        title = titleEl.textContent.trim();
      } else if (el.textContent) {
        title = el.textContent.trim();
      }

      // Extract author/subtitle (Bol.com often shows author in subtitle)
      let author = '';
      const subtitleEl = card.querySelector('[class*="subtitle"], [class*="author"], .product-creator');
      if (subtitleEl) {
        author = subtitleEl.textContent.trim();
      }

      // Extract price
      let price = '';
      const priceEl = card.querySelector('[class*="price"], [data-test*="price"]');
      if (priceEl) {
        price = priceEl.textContent.trim().replace(/\s+/g, ' ');
      }

      // Extract cover image
      let cover = '';
      const imgEl = card.querySelector('img');
      if (imgEl) {
        cover = imgEl.src || imgEl.dataset.src || imgEl.getAttribute('data-lazy-src') || '';
      }

      // Extract ISBN from URL or page content
      let isbn = '';
      const linkEl = card.querySelector('a[href*="/p/"]') || card.closest('a[href*="/p/"]');
      if (linkEl) {
        // Bol.com URLs sometimes contain ISBN-like identifiers
        const urlMatch = linkEl.href.match(/\/(\d{13})(?:\/|$)/);
        if (urlMatch) {
          isbn = urlMatch[1];
        }
      }

      if (title && title.length > 2) {
        candidates.push({
          title: title,
          author: author,
          isbn: isbn,
          cover: cover,
          publisher: '',
          year: '',
          language: '',
          description: '',
          subjects: '',
          source: 'Bol.com',
          price: price
        });
      }
    }

    if (candidates.length === 0) return null;

    const result = { best: candidates[0], candidates };
    await setCachedLookup('bolcom', query, result);
    return result;

  } catch (error) {
    console.error('Bol.com search error:', error);
    return null;
  }
}

// Berekent numerieke confidence score (0-1) voor vergelijking tussen bronnen
// Gebruikt stringSimilarity om OCR tekst te vergelijken met gevonden titel
function calculateConfidenceScore(query, bookData) {
  if (!bookData || !bookData.title) return 0;

  const queryLower = query.toLowerCase();
  const titleLower = bookData.title.toLowerCase();

  return stringSimilarity(queryLower, titleLower);
}

// Converteert numerieke score naar categorie voor UI weergave
function scoreToConfidence(score) {
  if (score > 0.85) return 'high';
  if (score > 0.5) return 'medium';
  return 'none';
}

// Legacy functie - wordt nog gebruikt op andere plekken
function calculateConfidence(query, bookData) {
  if (!bookData || !bookData.title) return 'none';

  const queryLower = query.toLowerCase();
  const titleLower = bookData.title.toLowerCase();

  // Calculate similarity
  const similarity = stringSimilarity(queryLower, titleLower);

  if (similarity > 0.85) return 'high';
  if (similarity > 0.5) return 'medium';
  return 'none';
}

function stringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

// ============================================================================
// Results Display
// ============================================================================

function showResults() {
  showScreen('results');

  // Show image
  elements.resultsImage.src = state.currentImage.dataUrl;

  elements.resultsCount.textContent = `${state.books.length} books detected`;

  // Always show ZIP button - user can add more books later
  const zipBtn = document.getElementById('btn-export-zip');
  if (zipBtn) {
    zipBtn.style.display = 'inline-flex';
  }

  // Render books
  renderBooksList();

  // Show upgrade tip if using Tesseract and many red results
  if (state.settings.ocrEngine === 'tesseract' && counts.none > counts.high) {
    showUpgradeTip();
  }
}

function showUpgradeTip() {
  // Don't show if already dismissed
  if (localStorage.getItem('upgradeTipDismissed')) return;

  const tip = document.createElement('div');
  tip.className = 'upgrade-tip';
  tip.innerHTML = `
    <div class="upgrade-tip-content">
      <strong>💡 Better results available!</strong>
      <p>Google Cloud Vision provides much better OCR results, especially for book spines.</p>
      <p style="font-size:0.85em; opacity:0.85;">Go to Settings (gear icon) to set up your API key.</p>
      <div class="upgrade-tip-actions">
        <button onclick="this.parentElement.parentElement.parentElement.remove()">OK</button>
      </div>
    </div>
    <button class="upgrade-tip-close" onclick="dismissUpgradeTip(this)">&times;</button>
  `;
  document.body.appendChild(tip);
}

window.dismissUpgradeTip = function(btn) {
  localStorage.setItem('upgradeTipDismissed', 'true');
  btn.parentElement.remove();
};

function renderBooksList() {
  elements.booksList.innerHTML = state.books.map((book, index) => `
    <div class="book-item" data-id="${book.id}"
         ondragover="bookDragOver(event)"
         ondrop="bookDrop(event)">
      <div class="book-header" draggable="true"
           ondragstart="bookDragStart(event, '${book.id}')"
           ondragend="bookDragEnd(event)"
           onclick="toggleBook('${book.id}')">
        <input type="checkbox" class="book-select-cb" onclick="toggleBookSelect('${book.id}', event)" aria-label="Select book">
        <div class="book-status ${book.confidence}" onclick="event.stopPropagation(); cycleConfidence('${book.id}')" title="Click to cycle: none → medium → high">
          ${book.confidence === 'high' ? `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>` : ''}
          ${book.confidence === 'medium' ? `
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L1 21h22L12 2zm0 4l7.5 13h-15L12 6z"/>
              <rect x="11" y="10" width="2" height="5"/>
              <rect x="11" y="16" width="2" height="2"/>
            </svg>` : ''}
          ${book.confidence === 'none' ? `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>` : ''}
        </div>
        <div class="book-title">${book.confidence === 'none'
          ? (book.preliminaryTitle || book.booktitle || 'Unknown')
          : (book.author && (book.booktitle || book.preliminaryTitle)
              ? `${book.author} - ${book.booktitle || book.preliminaryTitle}`
              : (book.booktitle || book.preliminaryTitle || 'Unknown'))}</div>
        <svg class="book-expand" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="book-details">
        ${book.confidence === 'none' || !book.booktitle ? `
          <div class="book-field">
            <label>Preliminary</label>
            <input type="text" value="${escapeHtml(book.preliminaryTitle)}" onchange="updateBook('${book.id}', 'preliminaryTitle', this.value)">
          </div>
        ` : ''}
        <div class="book-field">
          <label>Title</label>
          <input type="text" value="${escapeHtml(book.booktitle)}" onchange="updateBook('${book.id}', 'booktitle', this.value)">
        </div>
        <div class="book-field">
          <label>Author</label>
          <input type="text" value="${escapeHtml(book.author)}" onchange="updateBook('${book.id}', 'author', this.value)">
        </div>
        <div class="book-field-row">
          <div class="book-field">
            <label>ISBN</label>
            <input type="text" value="${escapeHtml(book.isbn)}" onchange="updateBook('${book.id}', 'isbn', this.value)">
          </div>
          <div class="book-field">
            <label>Year</label>
            <input type="text" value="${escapeHtml(book.year || '')}" onchange="updateBook('${book.id}', 'year', this.value)">
          </div>
          <div class="book-field">
            <label>Language</label>
            <input type="text" value="${escapeHtml(book.language || '')}" onchange="updateBook('${book.id}', 'language', this.value)">
          </div>
        </div>
        <div class="book-field">
          <label>Publisher</label>
          <input type="text" value="${escapeHtml(book.publisher || '')}" onchange="updateBook('${book.id}', 'publisher', this.value)">
        </div>
        <div class="book-field">
          <label>Tags</label>
          <input type="text" value="${escapeHtml(book.subjects || '')}" onchange="updateBook('${book.id}', 'subjects', this.value)">
        </div>
        <div class="book-field">
          <label>Cover URL</label>
          <input type="text" value="${escapeHtml(book.cover)}" onchange="updateBook('${book.id}', 'cover', this.value)">
        </div>
        ${book.candidates.length > 1 ? `
          <div class="book-candidates">
            <label>Alternative matches</label>
            <select onchange="selectCandidate('${book.id}', this.value)">
              ${book.candidates.map((c, i) => `
                <option value="${i}">${c.title} - ${c.author}</option>
              `).join('')}
            </select>
          </div>
        ` : ''}
        <div class="book-actions">
          <button class="btn btn-lookup" onclick="event.stopPropagation(); relookupBook('${book.id}')" aria-label="Re-lookup book">Lookup</button>
          <button class="btn btn-remove" onclick="event.stopPropagation(); removeBook('${book.id}')" aria-label="Remove book">Delete</button>
        </div>
      </div>
    </div>
  `).join('') + `
  <button class="btn btn-add-book" onclick="addBook()">+ Add book</button>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Global functions for inline handlers
window.toggleBook = function(id) {
  const item = document.querySelector(`.book-item[data-id="${id}"]`);
  item?.classList.toggle('expanded');
};

window.updateBook = function(id, field, value) {
  const book = state.books.find(b => b.id === id);
  if (book) {
    book[field] = value;
  }
};

window.selectCandidate = function(id, index) {
  const book = state.books.find(b => b.id === id);
  if (book && book.candidates[index]) {
    const candidate = book.candidates[index];
    book.booktitle = candidate.title;
    book.author = candidate.author;
    book.isbn = candidate.isbn;
    book.cover = candidate.cover;
    // Extra metadata van kandidaat overnemen
    book.publisher = candidate.publisher || '';
    book.year = candidate.year || '';
    book.language = candidate.language || '';
    book.subjects = candidate.subjects || '';
    book.description = candidate.description || '';
    book.confidence = 'medium';
    renderBooksList();
  }
};

window.removeBook = function(id) {
  state.books = state.books.filter(b => b.id !== id);
  renderBooksList();
  updateBookCounts();
};

/**
 * Check if newValue is a "cleaner" version of oldValue.
 * Cleaner means: same content but better formatting (e.g., "Platt" vs "PLATT").
 * Returns true if newValue should replace oldValue.
 */
function isCleanerVersion(oldValue, newValue) {
  if (!oldValue || !newValue) return false;

  const oldNorm = oldValue.trim().toLowerCase();
  const newNorm = newValue.trim().toLowerCase();

  // Must be essentially the same content
  if (oldNorm !== newNorm) return false;

  // Check if old is ALL CAPS and new is not
  const oldIsAllCaps = oldValue === oldValue.toUpperCase() && oldValue !== oldValue.toLowerCase();
  const newIsAllCaps = newValue === newValue.toUpperCase() && newValue !== newValue.toLowerCase();

  if (oldIsAllCaps && !newIsAllCaps) return true;

  // Check if new has proper title case (first letter caps)
  const newHasProperCase = newValue[0] === newValue[0].toUpperCase();
  if (!newHasProperCase) return false;

  return false;
}

/**
 * Re-lookup a single book after manual edits to title/author/preliminaryTitle.
 * Uses the current field values as the search query.
 *
 * Special behavior for HIGH confidence (green) books:
 * - Only updates title/author with "cleaner" versions (e.g., "PLATT" → "Platt")
 * - Does NOT overwrite with guesses or different content
 * - Preserves user's manual entries
 */
window.relookupBook = async function(id) {
  const book = state.books.find(b => b.id === id);
  if (!book) return;

  // Remember original confidence and values for protection
  const wasHighConfidence = book.confidence === 'high';
  const originalTitle = book.booktitle;
  const originalAuthor = book.author;

  // Build search query from current values (prefer booktitle, fallback to preliminaryTitle)
  // If author is available, include it for better matching
  let searchQuery = book.booktitle || book.preliminaryTitle || '';
  if (book.author && searchQuery) {
    searchQuery = `${searchQuery} ${book.author}`;
  }

  if (!searchQuery.trim()) {
    showToast('Please enter a title or preliminary title first');
    return;
  }

  // Show loading state on the button
  const bookItem = document.querySelector(`.book-item[data-id="${id}"]`);
  const lookupBtn = bookItem?.querySelector('.btn-lookup');
  const originalText = lookupBtn?.innerHTML;
  if (lookupBtn) {
    lookupBtn.innerHTML = 'Looking up...';
    lookupBtn.disabled = true;
  }

  try {
    // Create a parsed book object for lookupBooks()
    const parsedBook = {
      rawText: book.rawOcr || book.preliminaryTitle || '',
      possibleTitle: searchQuery,
      possibleAuthor: book.author || ''
    };

    // Run lookup for this single book
    const results = await lookupBooks([parsedBook]);

    if (results && results.length > 0) {
      const result = results[0];

      if (wasHighConfidence) {
        // GREEN (high confidence) book: user has corrected title/author
        // Clear old (wrong) metadata first, then apply new lookup results
        // This ensures wrong ISBN etc. from previous lookup is removed

        // Only update title/author if result is high confidence AND it's a cleaner version
        if (result.confidence === 'high') {
          if (isCleanerVersion(originalTitle, result.booktitle)) {
            book.booktitle = result.booktitle;
          }
          if (isCleanerVersion(originalAuthor, result.author)) {
            book.author = result.author;
          }
        }
        // Keep confidence as high - don't downgrade
        book.confidence = 'high';

        // Clear old metadata and replace with new lookup results (or empty)
        // This removes wrong ISBN/cover etc. from previous incorrect lookup
        book.isbn = result.isbn || '';
        book.cover = result.cover || '';
        book.publisher = result.publisher || '';
        book.year = result.year || '';
        book.language = result.language || '';
        book.subjects = result.subjects || '';
        book.description = result.description || '';
        book.candidates = result.candidates || [];

        showToast('Metadata refreshed (title/author preserved)');
      } else {
        // ORANGE/RED book: update everything, clear old wrong metadata first
        book.booktitle = result.booktitle || book.booktitle;
        book.author = result.author || book.author;
        // Clear old metadata and replace with new (or empty if not found)
        book.isbn = result.isbn || '';
        book.cover = result.cover || '';
        book.publisher = result.publisher || '';
        book.year = result.year || '';
        book.language = result.language || '';
        book.subjects = result.subjects || '';
        book.description = result.description || '';
        book.confidence = result.confidence;
        book.confidenceScore = result.confidenceScore;
        book.confidenceSource = result.confidenceSource;
        book.candidates = result.candidates || [];

        // Show feedback
        if (result.confidence === 'high') {
          showToast(`Found: ${result.booktitle}`);
        } else if (result.confidence === 'medium') {
          showToast(`Possible match: ${result.booktitle || 'check candidates'}`);
        } else {
          showToast('No match found. Try editing the title.');
        }
      }
    } else {
      // No results found
      if (wasHighConfidence) {
        // Keep high confidence - user marked it as correct
        showToast('No additional metadata found');
      } else {
        book.confidence = 'none';
        showToast('No results found. Try a different search term.');
      }
    }

    renderBooksList();
    updateBookCounts();

    // Re-expand the book item after re-render
    const newBookItem = document.querySelector(`.book-item[data-id="${id}"]`);
    if (newBookItem) newBookItem.classList.add('expanded');

  } catch (error) {
    console.error('Relookup error:', error);
    showToast('Lookup failed. Please try again.');
  } finally {
    // Restore button state (will be re-rendered anyway, but just in case)
    if (lookupBtn) {
      lookupBtn.innerHTML = originalText;
      lookupBtn.disabled = false;
    }
  }
};

window.addBook = function() {
  state.books.push({
    id: crypto.randomUUID(),
    rawOcr: '',
    preliminaryTitle: '',
    booktitle: '',
    author: '',
    isbn: '',
    cover: '',
    // Extra metadata velden
    publisher: '',
    year: '',
    language: '',
    subjects: '',
    description: '',
    confidence: 'none',
    candidates: []
  });
  renderBooksList();
  updateBookCounts();
  // Auto-expand the new entry
  const items = document.querySelectorAll('.book-item');
  const lastItem = items[items.length - 1];
  if (lastItem) lastItem.classList.add('expanded');
};

function updateBookCounts() {
  elements.resultsCount.textContent = `${state.books.length} books detected`;
}

// Drag & drop reorder
window.bookDragStart = function(e, id) {
  e.dataTransfer.setData('text/plain', id);
  e.target.closest('.book-item').classList.add('dragging');
};

window.bookDragEnd = function(e) {
  e.target.closest('.book-item')?.classList.remove('dragging');
  document.querySelectorAll('.book-item.drag-over').forEach(el => el.classList.remove('drag-over'));
};

window.bookDragOver = function(e) {
  e.preventDefault();
  const item = e.target.closest('.book-item');
  if (item) {
    document.querySelectorAll('.book-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    item.classList.add('drag-over');
  }
};

window.bookDrop = function(e) {
  e.preventDefault();
  const draggedId = e.dataTransfer.getData('text/plain');
  const targetItem = e.target.closest('.book-item');
  if (!targetItem) return;
  const targetId = targetItem.dataset.id;
  if (draggedId === targetId) return;

  const fromIndex = state.books.findIndex(b => b.id === draggedId);
  const toIndex = state.books.findIndex(b => b.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = state.books.splice(fromIndex, 1);
  state.books.splice(toIndex, 0, moved);
  renderBooksList();
};

// Bulk selection
window.toggleBookSelect = function(id, e) {
  e.stopPropagation();
  const item = document.querySelector(`.book-item[data-id="${id}"]`);
  if (!item) return;
  const cb = item.querySelector('.book-select-cb');
  const isSelected = cb ? cb.checked : !item.classList.contains('selected');
  if (isSelected) {
    item.classList.add('selected');
  } else {
    item.classList.remove('selected');
  }
};

// Select or deselect all books (toggle)
window.selectAll = function() {
  if (state.books.length === 0) return;

  // Check if all books are already selected
  const allSelected = state.books.every(book => {
    const el = document.querySelector(`.book-item[data-id="${book.id}"]`);
    return el?.classList.contains('selected');
  });

  if (allSelected) {
    // Deselect all
    document.querySelectorAll('.book-item').forEach(el => {
      el.classList.remove('selected');
      const cb = el.querySelector('.book-select-cb');
      if (cb) cb.checked = false;
    });
    showToast(`Deselected ${state.books.length} book(s)`);
  } else {
    // Select all
    document.querySelectorAll('.book-item').forEach(el => {
      el.classList.add('selected');
      const cb = el.querySelector('.book-select-cb');
      if (cb) cb.checked = true;
    });
    showToast(`Selected ${state.books.length} book(s)`);
  }
};

window.selectAllByConfidence = function(confidence) {
  const matchingBooks = state.books.filter(b => b.confidence === confidence);
  if (matchingBooks.length === 0) return;

  // Check if all matching items are already selected (for toggle/deselect)
  const allSelected = matchingBooks.every(book => {
    const el = document.querySelector(`.book-item[data-id="${book.id}"]`);
    return el?.classList.contains('selected');
  });

  if (allSelected) {
    // Deselect all matching items
    matchingBooks.forEach(book => {
      const el = document.querySelector(`.book-item[data-id="${book.id}"]`);
      if (el) {
        el.classList.remove('selected');
        const cb = el.querySelector('.book-select-cb');
        if (cb) cb.checked = false;
      }
    });
    showToast(`Deselected ${matchingBooks.length} book(s)`);
  } else {
    // Clear all selections first, then select matching items
    document.querySelectorAll('.book-item').forEach(el => {
      el.classList.remove('selected');
      const cb = el.querySelector('.book-select-cb');
      if (cb) cb.checked = false;
    });
    matchingBooks.forEach(book => {
      const el = document.querySelector(`.book-item[data-id="${book.id}"]`);
      if (el) {
        el.classList.add('selected');
        const cb = el.querySelector('.book-select-cb');
        if (cb) cb.checked = true;
      }
    });
    showToast(`Selected ${matchingBooks.length} book(s)`);
  }
};

window.deleteSelected = function() {
  const selectedIds = Array.from(document.querySelectorAll('.book-item.selected'))
    .map(el => el.dataset.id);
  if (selectedIds.length === 0) {
    showToast('No books selected');
    return;
  }
  state.books = state.books.filter(b => !selectedIds.includes(b.id));
  renderBooksList();
  updateBookCounts();
  showToast(`Removed ${selectedIds.length} book(s)`);
};

// Preview export
window.previewExport = function() {
  const files = generateMarkdown();
  const content = files.map(f => `--- ${f.filename} ---\n${f.content}`).join('\n\n');
  const modal = document.getElementById('preview-modal');
  const pre = document.getElementById('preview-content');
  if (modal && pre) {
    pre.textContent = content;
    modal.classList.add('active');
  }
};

window.closePreview = function() {
  const modal = document.getElementById('preview-modal');
  if (modal) modal.classList.remove('active');
};

// Information button — open Libiry website
window.showInfo = function() {
  // Open the Libiry website in a new tab
  window.open('https://libiry.org/', '_blank');
};

window.closeInfo = function() {
  const modal = document.getElementById('info-modal');
  if (modal) modal.classList.remove('active');
};

// Lightweight markdown to HTML converter (no external dependency)
function simpleMarkdownToHtml(md) {
  let html = md
    // Escape HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Tables
  html = html.replace(/^(\|.+\|)\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/gm, (_, header, body) => {
    const thCells = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${thCells}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs (lines that aren't already wrapped in tags)
  html = html.split('\n\n').map(block => {
    block = block.trim();
    if (!block) return '';
    if (block.startsWith('<')) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html;
}

window.cycleConfidence = function(id) {
  const book = state.books.find(b => b.id === id);
  if (book) {
    // Remember if this item was expanded
    const bookItem = document.querySelector(`.book-item[data-id="${id}"]`);
    const wasExpanded = bookItem?.classList.contains('expanded');

    const cycle = { none: 'medium', medium: 'high', high: 'none' };
    book.confidence = cycle[book.confidence] || 'none';
    renderBooksList();
    updateBookCounts();

    // Re-expand if it was expanded before
    if (wasExpanded) {
      const newBookItem = document.querySelector(`.book-item[data-id="${id}"]`);
      if (newBookItem) newBookItem.classList.add('expanded');
    }
  }
};

// ============================================================================
// Export
// ============================================================================

function generateMarkdown() {
  const s = state.settings;
  // Veldnamen in Goodreads volgorde
  const fieldNames = {
    cover: s.fieldNames.cover || 'cover',
    booktitle: s.fieldNames.booktitle || 'booktitle',
    author: s.fieldNames.author || 'author',
    isbn: s.fieldNames.isbn || 'isbn',
    rating: 'rating',           // Goodreads: My Rating (leeg, user vult later in)
    publisher: 'publisher',     // Goodreads: Publisher
    year: 'year',               // Goodreads: Year Published
    language: 'language',       // Extra: taal
    tags: s.fieldNames.tags || 'tags',  // Goodreads: Bookshelves
    series: 'series',           // Extra: serie naam (leeg)
    series_index: 'series_index', // Extra: serie volgnummer (leeg)
    description: 'description', // Goodreads: My Review / beschrijving
    notes: 'notes'              // Goodreads: Private Notes (leeg)
  };

  // Get shelf tags from input (applies to all books in this scan)
  const shelfTags = state.shelfTags || '';

  // One file per book (Obsidian compatible format)
  // Sequence nummer toegevoegd om unieke bestandsnamen te garanderen in ZIP
  return state.books.map((book, index) => {
    // For red (none confidence) items: use preliminary title, clear ALL other fields
    const isRed = book.confidence === 'none';
    const title = isRed ? (book.preliminaryTitle || book.booktitle || '') : (book.booktitle || '');
    const author = isRed ? '' : (book.author || '');
    const isbn_a = isRed ? '' : (book.isbn || '');
    const cover = isRed ? '' : (book.cover || '');
    // Extra metadata (leeg bij rode items)
    const publisher = isRed ? '' : (book.publisher || '');
    const year = isRed ? '' : (book.year || '');
    const language = isRed ? '' : (book.language || '');
    const description = isRed ? '' : (book.description || '');
    // Combine API subjects with user shelf tags, format as YAML block list
    const apiSubjects = isRed ? '' : (book.subjects || '');
    const allTagsStr = [shelfTags, apiSubjects].filter(t => t).join(', ');
    const tagsArray = allTagsStr.split(',').map(t => t.trim()).filter(t => t);
    const tagsYaml = tagsArray.length > 0
      ? `${fieldNames.tags}:\n` + tagsArray.map(t => `  - ${t}`).join('\n')
      : `${fieldNames.tags}:`;

    // Sequence number (001, 002, etc.) for unique filenames
    const seqNum = String(index + 1).padStart(3, '0');
    // Force new pattern - ignore old saved settings that don't include author/title
    const filenamePattern = '[author] - [booktitle] - [DATE]_[SEQ].md';
    const baseFilename = sanitizeFilename(
      filenamePattern
        .replace('[author]', author || 'Unknown')
        .replace('[booktitle]', title || 'Untitled')
        .replace('[DATE]', new Date().toISOString().split('T')[0])
        .replace('[SEQ]', seqNum)
    );
    const finalFilename = baseFilename.endsWith('.md') ? baseFilename : baseFilename + '.md';
    // Volgorde gebaseerd op Goodreads CSV export
    const content = [
      '---',
      `${fieldNames.cover}: "${cover}"`,
      `${fieldNames.booktitle}: "${title}"`,
      `${fieldNames.author}: "${author}"`,
      `${fieldNames.isbn}: "${isbn_a}"`,
      `${fieldNames.publisher}: "${publisher}"`,
      `${fieldNames.year}: "${year}"`,
      `${fieldNames.language}: "${language}"`,
      tagsYaml,
      s.includeConfidence ? `scan_confidence: ${book.confidence} (${Math.round((book.confidenceScore || 0) * 100)}%)` : null,
      s.includeConfidence && book.confidenceSource ? `scan_source_api: ${book.confidenceSource}` : null,
      s.includeMetadata ? `scan_source: "${state.currentImage?.filename || ''}"` : null,
      s.includeMetadata ? `scan_date: ${new Date().toISOString()}` : null,
      '---',
      '',
      `# ${title || 'Untitled'}`,
      '',
      ''
    ].filter(line => line !== null).join('\n');

    return { filename: finalFilename, content };
  });
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

function downloadMarkdown() {
  const files = generateMarkdown();
  files.forEach((file, i) => {
    setTimeout(() => downloadFile(file.filename, file.content), i * 100);
  });

  // Als 'include photo in export' aan staat, download ook de gescande foto
  // Dit geeft de gebruiker de originele scan samen met de metadata
  if (state.settings.includePhotoInExport && state.currentImage?.dataUrl) {
    const photoFilename = state.currentImage.filename || 'scan.jpg';
    setTimeout(() => downloadDataUrl(state.currentImage.dataUrl, photoFilename), files.length * 100);
    showToast(`Exported ${files.length} file(s) + photo`);
  } else {
    showToast(`Exported ${files.length} file(s)`);
  }
}

function downloadMarkdownAsZip() {
  const files = generateMarkdown();

  // Als 'include photo in export' aan staat, voeg de gescande foto toe aan de ZIP
  // De foto wordt als apart bestand meegenomen zodat gebruikers de originele scan behouden
  if (state.settings.includePhotoInExport && state.currentImage?.dataUrl) {
    const photoFile = dataUrlToFile(state.currentImage.dataUrl, state.currentImage.filename || 'scan.jpg');
    if (photoFile) {
      files.push(photoFile);
    }
  }

  downloadAsZip(files);
  const photoNote = state.settings.includePhotoInExport && state.currentImage?.dataUrl ? ' (including photo)' : '';
  showToast(`Exported ${files.length} file(s) as ZIP${photoNote}`);
}

/**
 * Converteer een data URL naar een file object voor ZIP export
 * @param {string} dataUrl - De base64 data URL van de afbeelding
 * @param {string} filename - Bestandsnaam voor in de ZIP
 * @returns {Object|null} - { filename, binaryContent } of null bij fout
 */
function dataUrlToFile(dataUrl, filename) {
  try {
    // Data URL format: data:image/jpeg;base64,/9j/4AAQ...
    const parts = dataUrl.split(',');
    if (parts.length !== 2) return null;

    const base64 = parts[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return { filename, binaryContent: bytes };
  } catch (e) {
    console.error('Failed to convert data URL to file:', e);
    return null;
  }
}

function downloadAsZip(files) {
  // Minimal ZIP file creation (store-only, no compression)
  // Ondersteunt zowel text (content) als binary (binaryContent) bestanden
  const encoder = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.filename);
    // Ondersteun zowel text content als binary content (voor foto's)
    const contentBytes = file.binaryContent || encoder.encode(file.content);
    const crc = crc32(contentBytes);

    // Local file header (30 bytes + name + content)
    const local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);  // signature
    localView.setUint16(4, 20, true);           // version needed
    localView.setUint16(6, 0, true);            // flags
    localView.setUint16(8, 0, true);            // compression (store)
    localView.setUint16(10, 0, true);           // mod time
    localView.setUint16(12, 0, true);           // mod date
    localView.setUint32(14, crc, true);         // crc32
    localView.setUint32(18, contentBytes.length, true); // compressed size
    localView.setUint32(22, contentBytes.length, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true);    // name length
    localView.setUint16(28, 0, true);           // extra length
    local.set(nameBytes, 30);
    local.set(contentBytes, 30 + nameBytes.length);
    localHeaders.push(local);

    // Central directory header (46 bytes + name)
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);  // signature
    centralView.setUint16(4, 20, true);           // version made by
    centralView.setUint16(6, 20, true);           // version needed
    centralView.setUint16(8, 0, true);            // flags
    centralView.setUint16(10, 0, true);           // compression
    centralView.setUint16(12, 0, true);           // mod time
    centralView.setUint16(14, 0, true);           // mod date
    centralView.setUint32(16, crc, true);         // crc32
    centralView.setUint32(20, contentBytes.length, true); // compressed size
    centralView.setUint32(24, contentBytes.length, true); // uncompressed size
    centralView.setUint16(28, nameBytes.length, true);    // name length
    centralView.setUint16(30, 0, true);           // extra length
    centralView.setUint16(32, 0, true);           // comment length
    centralView.setUint16(34, 0, true);           // disk number
    centralView.setUint16(36, 0, true);           // internal attributes
    centralView.setUint32(38, 0, true);           // external attributes
    centralView.setUint32(42, offset, true);      // local header offset
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  // End of central directory (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);          // signature
  eocdView.setUint16(4, 0, true);                    // disk number
  eocdView.setUint16(6, 0, true);                    // central dir disk
  eocdView.setUint16(8, files.length, true);          // entries on disk
  eocdView.setUint16(10, files.length, true);         // total entries
  eocdView.setUint32(12, centralDirSize, true);       // central dir size
  eocdView.setUint32(16, centralDirOffset, true);     // central dir offset
  eocdView.setUint16(20, 0, true);                    // comment length

  const blob = new Blob([...localHeaders, ...centralHeaders, eocd], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date();
  a.href = url;
  a.download = `bookspine_export_${date.toISOString().split('T')[0]}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// CRC32 lookup table
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download een data URL als bestand (voor foto export)
 * @param {string} dataUrl - De base64 data URL
 * @param {string} filename - Bestandsnaam voor de download
 */
function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

window.shareExport = async function() {
  if (!navigator.share) {
    showToast('Share not available on this device');
    return;
  }

  const files = generateMarkdown();
  const content = files.map(f => f.content).join('\n\n---\n\n');

  // Try sharing as file if supported
  if (navigator.canShare && files.length === 1) {
    const file = new File([files[0].content], files[0].filename, { type: 'text/markdown' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Libiry BookSpineScanner Export' });
        return;
      } catch (e) {
        if (e.name !== 'AbortError') console.error('File share failed:', e);
        return;
      }
    }
  }

  // Fallback: share as text
  try {
    await navigator.share({
      title: 'Libiry BookSpineScanner Export',
      text: content
    });
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast('Share failed');
    }
  }
}

function copyToClipboard() {
  const files = generateMarkdown();
  const content = files.map(f => f.content).join('\n\n---\n\n');

  navigator.clipboard.writeText(content).then(() => {
    showToast('Copied to clipboard');
  }).catch(err => {
    showToast('Failed to copy');
    console.error('Copy failed:', err);
  });
}

// ============================================================================
// Toast
// ============================================================================

let toastTimeout = null;

function showToast(message, duration = 3000) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove('show');
  }, duration);
}

// ============================================================================
// Event Listeners
// ============================================================================

function initEventListeners() {
  // File input (supports multiple for batch)
  elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 1) {
      handleBatchFiles(e.target.files);
    } else if (e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  });

  // Upload buttons
  elements.btnCamera?.addEventListener('click', async () => {
    // Check camera permission first
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop()); // Release immediately
      elements.fileInput.setAttribute('capture', 'environment');
      elements.fileInput.click();
    } catch (err) {
      showCameraInstructions();
    }
  });

  elements.btnSelectFile.addEventListener('click', () => {
    elements.fileInput.removeAttribute('capture');
    elements.fileInput.setAttribute('multiple', 'true');
    elements.fileInput.click();
  });

  // Drag and drop
  elements.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadArea.classList.add('dragover');
  });

  elements.uploadArea.addEventListener('dragleave', () => {
    elements.uploadArea.classList.remove('dragover');
  });

  elements.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 1) {
      handleBatchFiles(e.dataTransfer.files);
    } else if (e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  // Navigation
  elements.btnSettings.addEventListener('click', () => {
    // Remember which screen we came from so we can return to it
    state.previousScreen = state.currentScreen;
    showScreen('settings');
  });

  // Info button - opent Libiry website
  elements.btnInfo.addEventListener('click', () => {
    window.open('https://libiry.org/', '_blank');
  });

  // Support button - opent support pagina
  elements.btnSupport.addEventListener('click', () => {
    window.open('https://libiry.org/Contributing', '_blank');
  });

  elements.btnSettingsBack.addEventListener('click', () => {
    collectSettings();
    // Return to previous screen (results if we had scan data, otherwise main)
    const returnTo = state.previousScreen || 'main';
    showScreen(returnTo);
  });

  elements.btnCancel.addEventListener('click', () => {
    showScreen('main');
  });

  elements.btnNewScan.addEventListener('click', () => {
    state.books = [];
    state.currentImage = null;
    state.shelfTags = '';  // Reset tags voor nieuwe scan
    const tagsInput = document.getElementById('shelf-tags');
    if (tagsInput) tagsInput.value = '';
    clearSession();  // Wis opgeslagen sessie
    showScreen('main');
  });

  // Tags input - update state en sla op bij blur (verlaten veld)
  const tagsInput = document.getElementById('shelf-tags');
  if (tagsInput) {
    tagsInput.addEventListener('input', (e) => {
      state.shelfTags = e.target.value;
    });
    // Sla tags op in historie zodra gebruiker het veld verlaat
    // Zo zijn ze direct beschikbaar als suggestie bij de volgende scan
    tagsInput.addEventListener('blur', (e) => {
      if (e.target.value.trim()) {
        addTagsToHistory(e.target.value);
      }
    });
  }

  // Export - save tags to history before export
  elements.btnExport.addEventListener('click', () => {
    addTagsToHistory(state.shelfTags);
    downloadMarkdown();
  });
  const btnZip = document.getElementById('btn-export-zip');
  if (btnZip) {
    btnZip.addEventListener('click', () => {
      addTagsToHistory(state.shelfTags);
      downloadMarkdownAsZip();
    });
  }

  // Settings changes
  $('#setting-darkmode').addEventListener('change', (e) => {
    state.settings.darkMode = e.target.checked;
    applySettings();
    saveSettings();
  });

  // OCR engine selection - show/hide Vision API key
  $('#setting-ocr-engine')?.addEventListener('change', (e) => {
    state.settings.ocrEngine = e.target.value;
    const visionKeyGroup = $('#vision-apikey-group');
    if (visionKeyGroup) {
      visionKeyGroup.style.display = e.target.value === 'google' ? 'block' : 'none';
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't intercept shortcuts when user is in an input field
    const activeEl = document.activeElement;
    const isInInput = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'o') {
        e.preventDefault();
        elements.fileInput.click();
      } else if (e.key === 's' && state.currentScreen === 'results') {
        e.preventDefault();
        downloadMarkdown();
      } else if (e.key === 'c' && state.currentScreen === 'results' && !isInInput) {
        // Only intercept Ctrl+C when NOT in an input field
        e.preventDefault();
        copyToClipboard();
      }
    }
  });
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Load visual customization from /customize/customize.txt and apply to CSS variables.
 *
 * ARCHITECTURE DECISION - Why a runtime fetch instead of build-time embedding:
 * --------------------------------------------------------------------------
 * We considered three approaches for theming:
 *
 * 1. Build-time injection (Vite plugin reads customize.txt, injects into CSS)
 *    - Pro: No flash of unstyled content (FOUC), no runtime fetch
 *    - Con: Requires rebuild when user changes customize.txt. This is a PWA
 *      aimed at non-technical users who just edit a text file — requiring
 *      npm/Vite knowledge is unacceptable.
 *
 * 2. CSS-only (user edits CSS variables directly)
 *    - Pro: Instant, no fetch
 *    - Con: Breaks the "just edit customize.txt" contract shared with the
 *      Libiry desktop app. Users expect one customize.txt for both apps.
 *
 * 3. Runtime fetch (current approach) — fetch customize.txt, parse, apply to
 *    CSS custom properties via document.documentElement.style.setProperty()
 *    - Pro: User edits customize.txt, refreshes browser, sees changes.
 *      Same workflow as Libiry desktop app. No build tools needed.
 *    - Con: Brief FOUC if CSS defaults don't match customize.txt
 *    - Mitigation: CSS defaults in styles.css are set to match the current
 *      customize.txt values, so for the default case there is no FOUC.
 *
 * SUPPORTED FIELDS (matched case-insensitively):
 *   "Background color"      → --color-primary, --color-header-bg
 *   "Background font color" → --color-header-text, --color-text
 *   "Rounded corners y/n"   → --radius (8px if Y, 0px otherwise),
 *                              --radius-sm (4px if Y, 0px otherwise)
 *
 * WHY SPLIT ON ':' WITH REST SPREAD:
 * The line format is "Key: value", but color values like "#6F9D9F" also
 * contain a colon in some edge cases (e.g. "rgb(1:2:3)" or custom fields).
 * By splitting on ':' and rejoining valueParts, we safely handle values
 * that contain colons.
 */
async function loadCustomizeSettings() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}customize/customize.txt`);
    if (!response.ok) return;
    const text = await response.text();
    const lines = text.split('\n');
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      if (!key || !valueParts.length) continue;
      const k = key.trim().toLowerCase();
      const v = valueParts.join(':').trim();

      if (k === 'background color' && v) {
        // Apply to both the general primary color and the header background.
        // These are separate variables because dark mode overrides header-bg
        // independently (see [data-theme="dark"] in styles.css).
        document.documentElement.style.setProperty('--color-primary', v);
        document.documentElement.style.setProperty('--color-header-bg', v);
      } else if (k === 'background font color' && v) {
        // Apply to both header text and general text color for consistency.
        document.documentElement.style.setProperty('--color-header-text', v);
        document.documentElement.style.setProperty('--color-text', v);
      } else if (k === 'rounded corners y/n') {
        // Two radius sizes: --radius for cards/panels (8px when rounded),
        // --radius-sm for small elements like scrollbar thumbs and inline
        // code blocks (4px when rounded). Both go to 0 for straight corners.
        // Circular elements (status dots) use border-radius: 50% directly
        // in CSS and are not affected by this setting.
        const rounded = v.toLowerCase() === 'y';
        document.documentElement.style.setProperty('--radius', rounded ? '8px' : '0px');
        document.documentElement.style.setProperty('--radius-sm', rounded ? '4px' : '0px');
      }
    }
  } catch (e) {
    // If customize.txt doesn't exist or can't be fetched (e.g. first-time
    // user, offline, different hosting setup), the CSS defaults in styles.css
    // already provide the correct default appearance. No action needed.
    console.log('Could not load customize.txt, using defaults');
  }
}

function init() {
  loadSettings();
  loadRecentScans();
  initEventListeners();
  initPWAInstall();
  initOnlineStatus();
  initMobileGestures();
  initSessionRestore();
  loadCustomizeSettings();

  // Try to restore previous session (e.g., after tab was unloaded)
  const restored = restoreSession();
  if (!restored) {
    showScreen('main');
  }

  // Show/hide share button based on API availability
  const shareBtn = document.getElementById('btn-share');
  if (shareBtn && !navigator.share) shareBtn.style.display = 'none';

  console.log('Libiry BookSpineScanner initialized');
}

// ============================================================================
// Session State Persistence
// ============================================================================
// Saves scan results to sessionStorage so they survive tab unload/reload.
// This prevents losing work when browser unloads inactive tabs.

function initSessionRestore() {
  // Save state when page is about to be hidden or unloaded
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveSession();
    }
  });

  window.addEventListener('beforeunload', () => {
    saveSession();
  });

  // Also save periodically while on results screen (every 30 seconds)
  setInterval(() => {
    if (state.currentScreen === 'results' && state.books.length > 0) {
      saveSession();
    }
  }, 30000);
}

function saveSession() {
  // Only save if we have meaningful state to preserve
  if (state.currentScreen !== 'results' || state.books.length === 0) {
    return;
  }

  try {
    const sessionData = {
      currentScreen: state.currentScreen,
      books: state.books,
      currentImage: state.currentImage,
      shelfTags: state.shelfTags,
      timestamp: Date.now()
    };
    sessionStorage.setItem('bookspine-session', JSON.stringify(sessionData));
    console.log('Session saved:', state.books.length, 'books');
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

function restoreSession() {
  try {
    const saved = sessionStorage.getItem('bookspine-session');
    if (!saved) return false;

    const sessionData = JSON.parse(saved);

    // Check if session is recent (less than 1 hour old)
    const age = Date.now() - (sessionData.timestamp || 0);
    if (age > 60 * 60 * 1000) {
      console.log('Session too old, discarding');
      clearSession();
      return false;
    }

    // Restore state
    if (sessionData.books && sessionData.books.length > 0) {
      state.books = sessionData.books;
      state.currentImage = sessionData.currentImage;
      state.shelfTags = sessionData.shelfTags || '';
      state.currentScreen = sessionData.currentScreen;

      // Show the results screen
      showScreen('results');
      showToast('Vorige sessie hersteld');
      console.log('Session restored:', state.books.length, 'books');
      return true;
    }
  } catch (e) {
    console.warn('Failed to restore session:', e);
  }
  return false;
}

function clearSession() {
  try {
    sessionStorage.removeItem('bookspine-session');
  } catch (e) {
    console.warn('Failed to clear session:', e);
  }
}

// ============================================================================
// PWA Installation
// ============================================================================

function initPWAInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    hideInstallButton();
    showToast('App installed successfully!');
  });
}

function showInstallButton() {
  const btn = document.getElementById('btn-install');
  if (btn) btn.style.display = 'inline-flex';
}

function hideInstallButton() {
  const btn = document.getElementById('btn-install');
  if (btn) btn.style.display = 'none';
}

window.installPWA = async function() {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  const result = await state.deferredInstallPrompt.userChoice;
  if (result.outcome === 'accepted') {
    showToast('Installing app...');
  }
  state.deferredInstallPrompt = null;
};

// ============================================================================
// Online/Offline Status
// ============================================================================

function initOnlineStatus() {
  window.addEventListener('online', () => {
    state.isOffline = false;
    showToast('Back online');
  });
  window.addEventListener('offline', () => {
    state.isOffline = true;
    showToast('You are offline. Book lookup will be skipped.');
  });
}

// ============================================================================
// Camera Error Handling
// ============================================================================

function showCameraInstructions() {
  const ua = navigator.userAgent.toLowerCase();
  let instructions = '';

  if (ua.includes('chrome')) {
    instructions = 'Chrome: Click the lock/info icon in the address bar → Site settings → Camera → Allow';
  } else if (ua.includes('firefox')) {
    instructions = 'Firefox: Click the lock icon in the address bar → Clear permission for camera → Reload and allow';
  } else if (ua.includes('safari')) {
    instructions = 'Safari: Go to Settings → Safari → Camera → Allow';
  } else if (ua.includes('edg')) {
    instructions = 'Edge: Click the lock icon in the address bar → Site permissions → Camera → Allow';
  } else {
    instructions = 'Check your browser settings to enable camera access for this site.';
  }

  showToast('Camera access denied. ' + instructions);
}

// ============================================================================
// Mobile Gestures
// ============================================================================

function initMobileGestures() {
  // Pinch-to-zoom on result image
  const imagePanel = document.querySelector('.results-image-panel');
  if (imagePanel) {
    let scale = 1;
    let startDistance = 0;

    imagePanel.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        startDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    imagePanel.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        scale = Math.min(5, Math.max(1, scale * (dist / startDistance)));
        startDistance = dist;
        const img = imagePanel.querySelector('img');
        if (img) img.style.transform = `scale(${scale})`;
      }
    }, { passive: true });

    imagePanel.addEventListener('touchend', () => {
      if (scale <= 1.05) {
        scale = 1;
        const img = imagePanel.querySelector('img');
        if (img) img.style.transform = '';
      }
    }, { passive: true });
  }

  // Pull-to-refresh on main screen scan list
  let pullStartY = 0;
  let pulling = false;
  const mainScreen = document.getElementById('screen-main');
  if (mainScreen) {
    mainScreen.addEventListener('touchstart', (e) => {
      if (mainScreen.scrollTop === 0) {
        pullStartY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    mainScreen.addEventListener('touchmove', (e) => {
      if (!pulling) return;
      const pullDist = e.touches[0].clientY - pullStartY;
      if (pullDist > 80) {
        pulling = false;
        loadRecentScans();
        showToast('Scan list refreshed');
      }
    }, { passive: true });

    mainScreen.addEventListener('touchend', () => { pulling = false; }, { passive: true });
  }
}

// Start app
init();
