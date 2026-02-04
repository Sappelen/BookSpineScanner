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
  currentImage: null,
  books: [],
  batchFiles: [],      // For multi-file batch processing
  batchIndex: 0,
  batchResults: [],
  scanCount: 0,
  isProcessing: false,
  isOffline: !navigator.onLine,
  deferredInstallPrompt: null, // PWA install prompt
  settings: {
    lookupSource: 'openlibrary',
    ocrEngine: 'tesseract',
    language: 'eng+nld',
    exportFormat: 'libiry',
    filenamePattern: 'shelf_[DATE]_[TIME].md',
    includeMetadata: true,
    includeConfidence: true,
    darkMode: false,
    barcodeMode: false,
    googleApiKey: '',
    googleVisionApiKey: '',
    fieldNames: {
      cover: '',
      booktitle: '',
      author: '',
      isbn_analog: '',
      isbn_digital: ''
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
  btnSettingsBack: $('#btn-settings-back'),
  btnCancel: $('#btn-cancel'),
  btnNewScan: $('#btn-new-scan'),
  btnCopy: $('#btn-copy'),
  btnExport: $('#btn-export'),
  previewImage: $('#preview-image'),
  detectionCanvas: $('#detection-canvas'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),
  resultsImage: $('#results-image'),
  resultsCanvas: $('#results-canvas'),
  resultsCount: $('#results-count'),
  booksList: $('#books-list'),
  countHigh: $('#count-high'),
  countMedium: $('#count-medium'),
  countNone: $('#count-none'),
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
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
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

function applySettings() {
  // Apply dark mode
  document.documentElement.dataset.theme = state.settings.darkMode ? 'dark' : 'light';

  // Update form fields
  $('#setting-lookup').value = state.settings.lookupSource;
  $('#setting-ocr-engine').value = state.settings.ocrEngine;
  $('#setting-language').value = state.settings.language;
  $('#setting-format').value = state.settings.exportFormat;
  $('#setting-filename').value = state.settings.filenamePattern;
  $('#setting-metadata').checked = state.settings.includeMetadata;
  $('#setting-confidence').checked = state.settings.includeConfidence;
  $('#setting-darkmode').checked = state.settings.darkMode;
  $('#setting-apikey').value = state.settings.googleApiKey;
  $('#setting-vision-apikey').value = state.settings.googleVisionApiKey;

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
  $('#field-isbn-analog').value = state.settings.fieldNames.isbn_analog;
  $('#field-isbn-digital').value = state.settings.fieldNames.isbn_digital;
}

function collectSettings() {
  state.settings.lookupSource = $('#setting-lookup').value;
  state.settings.ocrEngine = $('#setting-ocr-engine').value;
  state.settings.language = $('#setting-language').value;
  state.settings.exportFormat = $('#setting-format').value;
  state.settings.filenamePattern = $('#setting-filename').value;
  state.settings.includeMetadata = $('#setting-metadata').checked;
  state.settings.includeConfidence = $('#setting-confidence').checked;
  state.settings.darkMode = $('#setting-darkmode').checked;
  state.settings.googleApiKey = $('#setting-apikey').value;
  state.settings.googleVisionApiKey = $('#setting-vision-apikey').value;

  const barcodeEl = $('#setting-barcode');
  if (barcodeEl) state.settings.barcodeMode = barcodeEl.checked;

  state.settings.fieldNames.cover = $('#field-cover').value;
  state.settings.fieldNames.booktitle = $('#field-booktitle').value;
  state.settings.fieldNames.author = $('#field-author').value;
  state.settings.fieldNames.isbn_analog = $('#field-isbn-analog').value;
  state.settings.fieldNames.isbn_digital = $('#field-isbn-digital').value;

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
          isbn_analog: cleanIsbn,
          isbn_digital: bookData?.isbn_digital || '',
          cover: bookData?.cover || '',
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
        isbn_analog: '',
        isbn_digital: '',
        cover: '',
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

  for (const parsed of parsedBooks) {
    const searchQuery = parsed.possibleTitle || parsed.rawText;

    let bookData = null;
    let confidence = 'none';
    let candidates = [];

    try {
      if (state.settings.lookupSource === 'openlibrary' || state.settings.lookupSource === 'both') {
        const olResult = await searchOpenLibrary(searchQuery);
        if (olResult) {
          bookData = olResult.best;
          candidates = olResult.candidates;
          confidence = calculateConfidence(searchQuery, bookData);
        }
      }

      if (!bookData && (state.settings.lookupSource === 'googlebooks' || state.settings.lookupSource === 'both')) {
        const gbResult = await searchGoogleBooks(searchQuery);
        if (gbResult) {
          bookData = gbResult.best;
          candidates = gbResult.candidates;
          confidence = calculateConfidence(searchQuery, bookData);
        }
      }
    } catch (error) {
      console.error('Lookup error for:', searchQuery, error);
    }

    results.push({
      id: crypto.randomUUID(),
      rawOcr: parsed.rawText || '',
      preliminaryTitle: parsed.possibleTitle || parsed.rawText || '', // Raw OCR text before lookup
      booktitle: bookData?.title || '',  // Only from lookup, not raw OCR
      author: bookData?.author || parsed.possibleAuthor || '',
      isbn_analog: bookData?.isbn || '',
      isbn_digital: bookData?.isbn_digital || '',
      cover: bookData?.cover || '',
      confidence: confidence,
      candidates: candidates,
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

    const candidates = data.docs.slice(0, 5).map(doc => ({
      title: doc.title,
      author: doc.author_name?.[0] || '',
      isbn: doc.isbn?.[0] || '',
      isbn_digital: doc.isbn?.find(i => i.startsWith('978')) || '',
      cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : ''
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

    const candidates = data.items.slice(0, 5).map(item => {
      const info = item.volumeInfo;
      const identifiers = info.industryIdentifiers || [];
      const isbn10 = identifiers.find(i => i.type === 'ISBN_10')?.identifier || '';
      const isbn13 = identifiers.find(i => i.type === 'ISBN_13')?.identifier || '';

      return {
        title: info.title,
        author: info.authors?.[0] || '',
        isbn: isbn13 || isbn10,
        isbn_digital: isbn13 || '',
        cover: info.imageLinks?.thumbnail || ''
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

  // Update counts
  const counts = { high: 0, medium: 0, none: 0 };
  state.books.forEach(book => counts[book.confidence]++);

  elements.countHigh.textContent = counts.high;
  elements.countMedium.textContent = counts.medium;
  elements.countNone.textContent = counts.none;
  elements.resultsCount.textContent = `${state.books.length} books detected`;

  // Show/hide ZIP button based on export format
  const zipBtn = document.getElementById('btn-export-zip');
  if (zipBtn) {
    const isMultiFile = state.settings.exportFormat === 'obsidian' && state.books.length > 1;
    zipBtn.style.display = isMultiFile ? 'inline-flex' : 'none';
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
        <div class="book-status ${book.confidence}" onclick="event.stopPropagation(); cycleConfidence('${book.id}')" title="Click to cycle: none → medium → high"></div>
        <div class="book-title">${book.confidence === 'none'
          ? (book.preliminaryTitle || book.booktitle || 'Unknown')
          : (book.booktitle || book.preliminaryTitle || 'Unknown')}</div>
        <svg class="book-expand" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="book-details">
        ${book.confidence === 'none' || !book.booktitle ? `
          <div class="book-field">
            <label>Preliminary Title (from OCR)</label>
            <input type="text" value="${escapeHtml(book.preliminaryTitle)}" onchange="updateBook('${book.id}', 'preliminaryTitle', this.value)">
          </div>
        ` : ''}
        <div class="book-field">
          <label>Title${book.confidence === 'none' ? ' (from lookup - empty if not found)' : ''}</label>
          <input type="text" value="${escapeHtml(book.booktitle)}" onchange="updateBook('${book.id}', 'booktitle', this.value)">
        </div>
        <div class="book-field">
          <label>Author</label>
          <input type="text" value="${escapeHtml(book.author)}" onchange="updateBook('${book.id}', 'author', this.value)">
        </div>
        <div class="book-field">
          <label>ISBN (Print)</label>
          <input type="text" value="${escapeHtml(book.isbn_analog)}" onchange="updateBook('${book.id}', 'isbn_analog', this.value)">
        </div>
        <div class="book-field">
          <label>ISBN (Digital)</label>
          <input type="text" value="${escapeHtml(book.isbn_digital)}" onchange="updateBook('${book.id}', 'isbn_digital', this.value)">
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
        <button class="btn btn-remove" onclick="event.stopPropagation(); removeBook('${book.id}')" aria-label="Remove book">Remove</button>
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
    book.isbn_analog = candidate.isbn;
    book.isbn_digital = candidate.isbn_digital;
    book.cover = candidate.cover;
    book.confidence = 'medium';
    renderBooksList();
  }
};

window.removeBook = function(id) {
  state.books = state.books.filter(b => b.id !== id);
  renderBooksList();
  updateBookCounts();
};

window.addBook = function() {
  state.books.push({
    id: crypto.randomUUID(),
    rawOcr: '',
    preliminaryTitle: '',
    booktitle: '',
    author: '',
    isbn_analog: '',
    isbn_digital: '',
    cover: '',
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
  const counts = { high: 0, medium: 0, none: 0 };
  state.books.forEach(b => counts[b.confidence]++);
  elements.countHigh.textContent = counts.high;
  elements.countMedium.textContent = counts.medium;
  elements.countNone.textContent = counts.none;
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

// Information modal — fetches and renders README.md
window.showInfo = async function() {
  const modal = document.getElementById('info-modal');
  const content = document.getElementById('info-content');
  if (!modal || !content) return;

  content.innerHTML = '<p>Loading...</p>';
  modal.classList.add('active');

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}README.md`);
    if (!response.ok) throw new Error('Not found');
    const md = await response.text();
    content.innerHTML = simpleMarkdownToHtml(md);
  } catch {
    content.innerHTML = '<p>Could not load documentation.</p>';
  }
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
    const cycle = { none: 'medium', medium: 'high', high: 'none' };
    book.confidence = cycle[book.confidence] || 'none';
    renderBooksList();
    updateBookCounts();
  }
};

// ============================================================================
// Export
// ============================================================================

function generateMarkdown() {
  const s = state.settings;
  const fieldNames = {
    cover: s.fieldNames.cover || 'cover',
    booktitle: s.fieldNames.booktitle || 'booktitle',
    author: s.fieldNames.author || 'author',
    isbn_analog: s.fieldNames.isbn_analog || 'isbn_analog',
    isbn_digital: s.fieldNames.isbn_digital || 'isbn_digital'
  };

  if (s.exportFormat === 'obsidian') {
    // One file per book - return array
    return state.books.map(book => {
      // For red (none confidence) items: use preliminary title, clear other fields
      const isRed = book.confidence === 'none';
      const title = isRed ? (book.preliminaryTitle || book.booktitle || '') : (book.booktitle || '');
      const author = isRed ? '' : (book.author || '');
      const isbn_a = isRed ? '' : (book.isbn_analog || '');
      const isbn_d = isRed ? '' : (book.isbn_digital || '');
      const cover = isRed ? '' : (book.cover || '');

      const filenamePattern = s.filenamePattern || '[author] - [booktitle].md';
      const filename = sanitizeFilename(
        filenamePattern
          .replace('[author]', author || 'Unknown')
          .replace('[booktitle]', title || 'Untitled')
          .replace('[DATE]', new Date().toISOString().split('T')[0])
          .replace('[TIME]', new Date().toTimeString().split(' ')[0].replace(/:/g, '-'))
      );
      const finalFilename = filename.endsWith('.md') ? filename : filename + '.md';
      const content = [
        '---',
        `${fieldNames.cover}: "${cover}"`,
        `${fieldNames.booktitle}: "${title}"`,
        `${fieldNames.author}: "${author}"`,
        `${fieldNames.isbn_analog}: "${isbn_a}"`,
        `${fieldNames.isbn_digital}: "${isbn_d}"`,
        s.includeConfidence ? `scan_confidence: ${book.confidence}` : null,
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
  } else {
    // Libiry format - multiple books per file
    const date = new Date();
    const filename = s.filenamePattern
      .replace('[DATE]', date.toISOString().split('T')[0])
      .replace('[TIME]', date.toTimeString().split(' ')[0].replace(/:/g, '-'));

    const header = s.includeMetadata ? [
      '---',
      `scan_date: ${date.toISOString()}`,
      `scan_source: ${state.currentImage?.filename || ''}`,
      `books_detected: ${state.books.length}`,
      `lookup_source: ${s.lookupSource}`,
      `scanner_version: 1.0.0`,
      '---',
      ''
    ].join('\n') : '';

    const booksContent = state.books.map(book => {
      // For red (none confidence) items: use preliminary title, clear other fields
      const isRed = book.confidence === 'none';
      const title = isRed ? (book.preliminaryTitle || book.booktitle || '') : (book.booktitle || '');
      const author = isRed ? '' : (book.author || '');
      const isbn_a = isRed ? '' : (book.isbn_analog || '');
      const isbn_d = isRed ? '' : (book.isbn_digital || '');
      const cover = isRed ? '' : (book.cover || '');

      const lines = [
        `${fieldNames.cover}: ${cover}`,
        `${fieldNames.booktitle}: ${title}`,
        `${fieldNames.author}: ${author}`,
        `${fieldNames.isbn_analog}: ${isbn_a}`,
        `${fieldNames.isbn_digital}: ${isbn_d}`
      ];

      if (s.includeConfidence) {
        lines.push(`scan_confidence: ${book.confidence}`);
        if (book.confidence === 'medium' && book.candidates.length > 1) {
          const candidateStr = book.candidates.map(c => `${c.title} (${c.author})`).join(' | ');
          lines.push(`scan_candidates: ${candidateStr}`);
        }
        if (book.confidence === 'none' && book.preliminaryTitle) {
          lines.push(`scan_preliminary: ${book.preliminaryTitle}`);
        }
      }

      return lines.join('\n');
    }).join('\n\n');

    return [{ filename, content: header + booksContent }];
  }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
}

function downloadMarkdown() {
  const files = generateMarkdown();
  files.forEach((file, i) => {
    setTimeout(() => downloadFile(file.filename, file.content), i * 100);
  });
  showToast(`Exported ${files.length} file(s)`);
}

function downloadMarkdownAsZip() {
  const files = generateMarkdown();
  downloadAsZip(files);
  showToast(`Exported ${files.length} files as ZIP`);
}

function downloadAsZip(files) {
  // Minimal ZIP file creation (store-only, no compression)
  const encoder = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.filename);
    const contentBytes = encoder.encode(file.content);
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

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3000);
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
  elements.btnSettings.addEventListener('click', () => showScreen('settings'));
  elements.btnSettingsBack.addEventListener('click', () => {
    collectSettings();
    showScreen('main');
  });

  elements.btnCancel.addEventListener('click', () => {
    showScreen('main');
  });

  elements.btnNewScan.addEventListener('click', () => {
    state.books = [];
    state.currentImage = null;
    showScreen('main');
  });

  // Export
  elements.btnExport.addEventListener('click', downloadMarkdown);
  const btnZip = document.getElementById('btn-export-zip');
  if (btnZip) btnZip.addEventListener('click', downloadMarkdownAsZip);
  elements.btnCopy.addEventListener('click', copyToClipboard);

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
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'o') {
        e.preventDefault();
        elements.fileInput.click();
      } else if (e.key === 's' && state.currentScreen === 'results') {
        e.preventDefault();
        downloadMarkdown();
      } else if (e.key === 'c' && state.currentScreen === 'results') {
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
  loadCustomizeSettings();
  showScreen('main');

  // Show/hide share button based on API availability
  const shareBtn = document.getElementById('btn-share');
  if (shareBtn && !navigator.share) shareBtn.style.display = 'none';

  console.log('Libiry BookSpineScanner initialized');
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
