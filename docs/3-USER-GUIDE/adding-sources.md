# Adding Sources - Getting Content Into Your Notebook

Sources are the raw materials of your research. This guide covers how to add different types of content.

---

## Quick-Start: Add Your First Source

### Option 1: Upload a File (PDF, Word, etc.)

```
1. In your notebook, click "Add Source"
2. Select "Upload File"
3. Choose a file from your computer
4. Click "Upload"
5. Wait 30-60 seconds for processing
6. Done! Source appears in your notebook
```

### Option 2: Add a Web Link

```
1. Click "Add Source"
2. Select "Web Link"
3. Paste URL: https://example.com/article
4. Click "Add"
5. Wait for processing (usually faster than files)
6. Done!
```

### Option 3: Paste Text

```
1. Click "Add Source"
2. Select "Text"
3. Paste or type your content
4. Click "Save"
5. Done! Immediately available
```

### Option 4: Import from Dropbox or Google Drive

**Add Source → Cloud**: pick files and/or folders from a connected account, and choose whether to keep them in sync (new files imported, modified files update their source, deleted files remove it). See [Cloud Storage Sync](cloud-sync.md).

---

## Supported File Types

### Documents
- **PDF** (.pdf) — Best support, including scanned PDFs with OCR
- **Word** (.docx, .doc) — Full support
- **PowerPoint** (.pptx) — Slides converted to text
- **Excel** (.xlsx, .xls) — Spreadsheet data
- **EPUB** (.epub) — eBook files
- **Markdown** (.md, .txt) — Plain text formats
- **HTML** (.html, .htm) — Web page files
- **Images** (.png, .jpg, .jpeg, .tiff, .bmp) — Text read via OCR (**requires Docling enabled** — see below)

**File size limits:** Up to ~100MB (varies by system)

**Processing time:** 10 seconds - 2 minutes (depending on length and file type)

**OCR (scanned PDFs & images):** Text is read off scanned PDFs and image files using OCR. OCR runs through the **Docling** engine, which is **optional** and installed on first startup when you set `OPEN_NOTEBOOK_ENABLE_DOCLING=true`. Once enabled, OCR is on by default; you can turn it off (or force a more accurate extraction engine) in **Settings → Content Processing** — see [Content Processing Engines](content-processing-engines.md).

### Audio & Video
- **Audio**: MP3, WAV, M4A, OGG, FLAC (~30 seconds - 3 minutes per hour)
- **Video**: MP4, AVI, MOV, MKV, WebM (~3-10 minutes per hour)
- **YouTube**: Direct URL support
- **Podcasts**: RSS feed URL

**Automatic transcription**: Audio/video is transcribed to text automatically. This requires enabling speech-to-text in settings.

### Web Content
- **Articles**: Blog posts, news articles, Medium
- **YouTube**: Full videos, playlists, plus `/live/` and `/shorts/` URLs
- **Reddit**: Public post URLs (fetched via Reddit's public JSON)
- **PDFs online**: Direct PDF links
- **News**: News site articles

**Just paste the URL** in "Web Link" section.

**JavaScript-heavy sites:** How well a URL extracts depends on the URL processing engine. The default (`auto`) tries several engines; enabling Crawl4AI lets it render JavaScript pages locally. If a link comes back empty, see [Content Processing Engines](content-processing-engines.md).

### What Doesn't Work
- Paywalled content (WSJ, FT, etc.) — Can't extract
- Password-protected PDFs — Can't open
- Unsupported formats — Rejected immediately with a clear "unsupported file type" message (no long wait)
- Very large files (>100MB) — Timeout

---

## What Happens When You Add a Source

The system automatically does four things:

```
1. EXTRACT TEXT
   File/URL → Readable text
   (PDFs get OCR if scanned)
   (Videos get transcribed if enabled)

2. BREAK INTO CHUNKS
   Long text → ~500-word pieces
   (So search finds specific parts, not whole document)

3. CREATE EMBEDDINGS
   Each chunk → Vector representation
   (Enables semantic/concept search)

4. INDEX & STORE
   Everything → Database
   (Ready to search and retrieve)
```

**Time to use:** After the progress bar completes, the source is ready immediately. Embeddings are created in the background.

---

## Step-by-Step for Different Types

### PDFs

**Best practices:**
```
Clean PDFs:
  1. Upload → Done
  2. Processing time: ~30-60 seconds

Scanned/Image PDFs:
  1. Upload same way
  2. System auto-detects and uses OCR
  3. Processing time: ~2-3 minutes
  4. (Higher, due to OCR overhead)

Large PDFs (50+ pages):
  1. Consider splitting into smaller files
  2. Or upload as-is (system handles it)
  3. Processing time scales with size
```

**Common issues:**
- "Can't extract text" → PDF is corrupted or has copy protection
- Solution: Try opening in Adobe. If it won't, the PDF is likely protected.

### Web Links / Articles

**Best practices:**
```
1. Copy full URL from browser: https://example.com/article-title
2. Paste in "Web Link"
3. Click Add
4. Wait for extraction

Processing time: Usually 5-15 seconds
```

**What works:**
- Standard web articles
- Blog posts
- News articles
- Wikipedia pages
- Medium posts
- Substack articles

**What doesn't work:**
- Twitter threads (unreliable)
- Paywalled articles (can't access)
- JavaScript-heavy sites (content not extracted)

**Pro tip:** If it doesn't work, copy the article text and paste as "Text" instead.

### Audio Files

**Best practices:**
```
1. Ensure speech-to-text is enabled in Settings
2. Upload MP3, WAV, or M4A file
3. System automatically transcribes to text
4. Processing time: ~1 minute per 5 minutes of audio

Example:
  - 1-hour podcast → 12 minutes processing
  - 10-minute recording → 2 minutes processing
```

**Quality matters:**
- Clear audio: Fast transcription
- Muffled/noisy audio: Slower, less accurate transcription
- Background noise: Try to minimize before uploading

**Tip:** If audio quality is poor, the AI might misinterpret content. You can manually correct transcription if needed.

### YouTube Videos

**Best practices:**
```
Two ways to add:

Method 1: Direct URL
  1. Copy YouTube URL: https://www.youtube.com/watch?v=...
     (regular watch, /live/, and /shorts/ URLs all work)
  2. Paste in "Web Link"
  3. Click Add
  4. System extracts captions (if available) + transcript

Method 2: Playlist
  1. Paste playlist URL
  2. System adds all videos as separate sources
  3. Each video processed separately
  4. Takes longer (multiple videos)
```

**What's extracted:**
- Captions/subtitles (if available)
- Transcription (if captions aren't available)
- Basic metadata (title, channel, length)

**Processing:**
- 10-minute video: ~2-3 minutes
- 1-hour video: ~10-15 minutes

### Text / Paste Content

**Best practices:**
```
1. Select "Text" when adding source
2. Paste or type content
3. System processes immediately
4. No wait time needed

Good for:
  - Notes you want to reference
  - Quotes from books
  - Transcripts you have handy
  - Quick research snippets
```

---

## Managing Your Sources

### Viewing Source Details

```
Click on source → See:
  - Original file name/title
  - When it was added
  - Size and format
  - Processing status
  - Number of chunks
```

### Organizing with Metadata

You can add to each source:
- **Title**: Better name than original filename
- **Tags**: Category labels ("primary research", "background", "competitor analysis")
- **Description**: A few notes about what it contains

**Why this matters:**
- Makes sources easier to find
- Helps when contextualizing for Chat
- Useful for organizing large notebooks

### Searching Within Sources

```
After sources are added, you can:

Text search: "Find exact phrase"
Vector search: "Find conceptually similar"

Both search across all sources in notebook.
Results show:
  - Which source
  - Which section
  - Relevance score
```

### Deleting Sources

On the **all-Sources page** (`/sources`), each row has its own delete button. To clear out several at once:

- **Select sources** — reveals a checkbox per row (and a header checkbox to select every row currently loaded); pick the ones to remove and click **Delete Selected**.
- **Delete All Sources** — removes every source in the workspace, regardless of how many are loaded on screen. This is irreversible: it deletes the sources' text, insights and embeddings (and their files, if "auto delete files" is on). Cloud-synced sources you delete this way are not re-imported until the file changes remotely (see [Cloud Storage Sync](cloud-sync.md)).

Both actions ask for confirmation before deleting anything, and report how many sources were removed.

---

## Context Management: How Sources Get Used

You control how AI accesses sources:

### Three Levels (for Chat)

**Full Content:**
```
AI sees: Complete source text
Cost: 100% of tokens
Use when: Analyzing in detail, need precise citations
Example: "Analyze this methodology paper closely"
```

**Summary Only:**
```
AI sees: AI-generated summary (not full text)
Cost: ~10-20% of tokens
Use when: Background material, reference context
Example: "Use this as context but focus on the main source"
```

**Not in Context:**
```
AI sees: Nothing (excluded)
Cost: 0 tokens
Use when: Confidential, not relevant, or archived
Example: "Keep this in notebook but don't use in this conversation"
```

### How to Set Context (in Chat)

```
1. Go to Chat
2. Click "Select Context Sources"
3. For each source:
   - Toggle ON/OFF (include/exclude)
   - Choose level (Full/Summary/Excluded)
4. Click "Save"
5. Now chat uses these settings
```

---

## Common Mistakes

| Mistake | What Happens | How to Fix |
|---------|--------------|-----------|
| Upload 200 sources at once | System gets slow, processing stalls | Add 10-20 at a time, wait for processing |
| Use full content for all sources | Token usage skyrockets, expensive | Use "Summary" or "Excluded" for background material |
| Add huge PDFs without splitting | Processing is slow, search results less precise | Consider splitting large PDFs into chapters |
| Forget source titles | Can't distinguish between similar sources | Rename sources with descriptive titles right after uploading |
| Don't tag sources | Hard to find and organize later | Add tags immediately: "primary", "background", etc. |
| Mix languages in one source | Transcription/embedding quality drops | Keep each language in separate sources |
| Use same source multiple times | Takes up space, creates confusion | Add once; reuse in multiple chats/notebooks |

---

## Processing Status & Troubleshooting

### Following Everything in Progress: the Activity Page

**Activity** in the sidebar (with a badge counting the jobs in progress) lists every background job so you can follow a file through its pipeline: **extraction → transformations → saving insights → embeddings**. Cloud syncs, note embeddings, podcasts and embedding rebuilds appear there too. The page refreshes every 2 seconds while something is running.

- **Two views.** *By item* groups the jobs by the source (or cloud link, podcast…) they work on. *By phase* groups them by pipeline stage, e.g. every transformation running right now, across all sources. The chips above the lists (*Transformation · 3 running · 5 queued*) filter both views to one stage; the search box matches titles, transformation names and file names.
- **Live progress.** Each running job shows what it is doing right now — *Extracting content · report.pdf (docling)*, *Waiting for the AI model · Summary*, *Embedding chunks 120/400*, *Importing 7/30 · /Research/paper.pdf*, *Generating audio* — with a progress bar when the step has a counter, and a badge when the job is on a retry attempt.
- **Details (ⓘ).** Opens everything about one job, refreshed every second while it runs: current step, the timeline of its steps with timestamps, queue/start/end times, duration, attempts, notebooks, the full error, and the job input and output.
- **In progress** shows queued jobs (waiting for the worker) and running ones with their elapsed time. If jobs stay queued and nothing runs, the worker is probably stopped (`make worker-start`).
- **Recent** shows what finished in the last hour, day or week, with duration and the error of failed jobs; a failed extraction can be retried from there.
- **Stopping.** **Stop** a single job; tick several jobs (or a whole group) and **Stop selected**; **Stop all** the jobs of a source or cloud link, **Stop phase** in the *By phase* view, or **Stop everything** to stop all queued and running processing at once (after a confirmation). **Stop and delete source** drops a file you didn't mean to add. A queued job never starts; a running one stops within a few seconds (it shows *Stopping…* meanwhile). Stopping is best effort: work already handed to a follow-up job (e.g. an embedding queued by the extraction) keeps its own row and can be stopped too.
- **Remove from list** (×) or **Clear finished** hides finished jobs; nothing is deleted.

Transformations chosen at upload (or by a notebook's defaults) run as **one job each** after the extraction, so each one can be followed and stopped on its own; a failing transformation does not fail the source.

Timings and live steps are recorded for jobs created after these features were installed.

### What the Status Indicators Mean

```
🟡 Processing
  → Source is being extracted and embedded
  → Wait 30 seconds - 3 minutes depending on size
  → Don't use in Chat yet

🟢 Ready
  → Source is processed and searchable
  → Can use immediately in Chat
  → Can apply transformations

🔴 Error
  → Something went wrong
  → Common reasons:
    - Unsupported file format
    - File too large or corrupted
    - Network timeout

⚪ Not in Context
  → Source added but excluded from Chat
  → Still searchable, not sent to AI
```

### Common Errors & Solutions

**"Unsupported file type"**
- You tried to upload a format not in the list (e.g., `.webp` image)
- The upload is rejected **immediately** with a message naming the detected type — no long wait or stuck "Processing" state
- Note: image formats (PNG/JPEG/TIFF/BMP) are only supported when **Docling is enabled** (`OPEN_NOTEBOOK_ENABLE_DOCLING=true`)
- Solution: Convert to a supported format (PDF for documents, MP3 for audio), or enable Docling for images

**"Processing timeout"**
- Very large file (>100MB) or very long audio
- Solution: Split into smaller pieces or try uploading again

**"Transcription failed"**
- Audio quality too poor or language not detected
- Solution: Re-record with better quality, or paste text transcript manually

**"Web link won't extract"**
- Website blocks automated access or uses JavaScript for content
- Solution: Try a different URL processing engine (see [Content Processing Engines](content-processing-engines.md)) — enabling Crawl4AI renders JavaScript pages — or copy the article text and paste as "Text" instead

---

## Tips for Best Results

### For PDFs
- Clean, digital PDFs work best
- Remove copy protection if present (legally)
- Scanned PDFs work but take longer

### For Web Articles
- Use full URL including domain
- Avoid cookie/popup-laden sites
- If extraction fails, copy-paste text instead

### For Audio
- Clear, well-recorded audio transcribes better
- Remove background noise if possible
- YouTube videos usually have good transcriptions built-in

### For Large Documents
- Consider splitting into smaller sources
- Gives more precise search results
- Processing is faster for smaller pieces

### For Organization
- Name sources clearly (not "document_2.pdf")
- Add tags immediately after uploading
- Use descriptions for complex documents

---

## What Comes After: Using Your Sources

Once you've added sources, you can:

- **Chat** → Ask questions (see [Chat Effectively](chat-effectively.md))
- **Search** → Find specific content (see [Search Effectively](search.md))
- **Transformations** → Extract structured insights (see [Working with Notes](working-with-notes.md))
- **Ask** → Get comprehensive answers (see [Search Effectively](search.md))
- **Podcasts** → Turn into audio (see [Creating Podcasts](creating-podcasts.md))

---

## Summary Checklist

Before adding sources, confirm:

- [ ] File is in supported format
- [ ] File is under 100MB (or splitting large ones)
- [ ] Web links are full URLs (not shortened)
- [ ] Audio files have clear speech (if transcription-dependent)
- [ ] You've named source clearly
- [ ] You've added tags for organization
- [ ] You understand context levels (Full/Summary/Excluded)

Done! Sources are now ready for Chat, Search, Transformations, and more.
