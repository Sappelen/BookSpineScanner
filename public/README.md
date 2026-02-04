# Libiry BookSpineScanner

Libiry BookSpineScanner is a Progressive Web App (PWA) that photographs bookshelves and extracts book metadata using OCR and book database lookups. It gives you flat '.md' (markdown) files, that can be used in Libiry (https://github.com/Sappelen/Libiry), Obsidian, Calibre and other tools.

## Getting started

Open the app in your browser:

**https://sappelen.github.io/BookSpineScanner/**

No installation required. Works on desktop and mobile.

### Install as app (optional)

- **Android (Chrome):** Tap the three-dot menu > "Install app" or "Add to home screen"
- **iPhone (Safari):** Tap the share icon (square with arrow) > "Add to Home Screen"
- **Desktop (Chrome/Edge):** Click the install icon in the address bar

### Start scanning

1. Check the settings with the settings button in the top right corner
2. Open the app
3. **Mobile:** Tap "Take Photo" to photograph a bookshelf
4. **Desktop:** Drag and drop a photo or click "Select File"
5. Wait for the scan to complete
6. Review the results and export as markdown file(s)

## How it works

1. **Spine detection** -- OpenCV.js detects individual book spines in the photo
2. **OCR** -- Text is read from each spine using Google Cloud Vision or Tesseract.js
3. **Book lookup** -- Extracted text is searched in Open Library and/or Google Books
4. **Review** -- Results are shown with confidence indicators (green/orange/red)
5. **Export** -- Save as Libiry-compatible or Obsidian-compatible markdown files

## OCR engines

### Tesseract.js (default)

- Works offline, no setup required
- Runs entirely in your browser
- Good for high-contrast, well-lit photos

### Google Cloud Vision (recommended)

- Much better results, especially for book spines with small or rotated text
- Requires a Google Cloud Vision API key
- Free tier: 1,000 scans/month, then approximately $1.50 per 1,000 scans

**To set up Google Cloud Vision:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select an existing one)
3. Enable the "Cloud Vision API"
4. Go to "Credentials" and create an API key
5. In BookSpineScanner, tap the gear icon (Settings)
6. Paste your API key in the "Google Vision API Key" field
7. Select "Google Cloud Vision" as OCR engine

## Barcode mode

For books with a visible ISBN barcode:

1. Enable "Barcode mode" in Settings
2. Take a photo of the barcodes
3. The app reads ISBN numbers directly from the barcodes
4. Books are looked up by ISBN in Open Library and Google Books
5. If a book is not found in these databases, a WorldCat search link is provided as the book title -- click it to look up the book manually

## Phone camera vs. desktop upload -- why results may differ

When you scan a bookshelf with your phone camera, the results may be different from uploading the same shelf as a photo on desktop. This is normal and has several causes:

- **Resolution:** Phone cameras compress the photo before sending it to the app. The uploaded photo on desktop is usually the original, uncompressed file with more detail.
- **Focus and sharpness:** A phone camera may not focus perfectly on every spine, especially at the edges of the frame. A carefully taken photo that you upload later may be sharper.
- **Lighting:** Phone photos taken in indoor lighting often have more noise and less contrast than well-lit photos.
- **Camera angle:** A slight angle or tilt causes perspective distortion, making some spines harder to read.

**Tips for better phone results:**

- Hold the phone steady and straight in front of the bookshelf
- Make sure there is good, even lighting (avoid shadows across the spines)
- Take the photo from a distance where all spines are readable to the human eye
- If results are poor, try taking multiple photos of smaller sections of the shelf
- Use Google Cloud Vision instead of Tesseract for significantly better results on phone photos

## Confidence indicators

- **Green:** High confidence -- OCR text clearly matches a book in the database (>85% match)
- **Orange:** Medium confidence -- multiple candidates found, or moderate match (50-85%). Review and pick the right one.
- **Red:** No match found, or OCR could not read enough text. You can enter the book details manually.

Click on a confidence dot to cycle its status (red > orange > green > red).

## Export formats

### Libiry format (default)

- One '.md' file per scan (per photo)
- YAML header with scan metadata
- Each book as a block with 'key: value' lines
- Compatible with Libiry, readable in any text editor

### Obsidian format

- One '.md' file per book
- All metadata in YAML frontmatter
- Compatible with Obsidian Bases, Dataview, and other Obsidian plugins
- Download as ZIP when exporting multiple books

## Customizing options

Edit file 'customize/customize.txt' to change the app's appearance.
If your existing Obsidian or Libiry setup uses different field names, you can configure them in Settings.

## Data and privacy

- All processing happens in your browser. No data is sent to any server (except API calls to Google Vision, Open Library and Google Books when looking up books)
- Settings are stored in your browser's localStorage
- Book lookup results are cached in IndexedDB to reduce API calls
- No account required, no tracking, no analytics

## Integration with Libiry

1. Scan your bookshelf
2. Review and correct the results
3. Export as '.md'
4. Place the '.md' file(s) in your Libiry book folder
5. Refresh Libiry

Libiry reads the fields 'cover', 'booktitle', 'author', 'isbn_analog', and 'isbn_digital' from the markdown files. 
All other fields are ignored by Libiry but preserved in the file.