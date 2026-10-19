# AI Vocabulary Browser Extension

A Chrome extension (Manifest V3) that explains any word you highlight or
type — using its surrounding sentence for context — backed by a FastAPI
server that calls Gemini only when it actually needs to. The UI follows a
Bauhaus design system: primary colors, hard geometric shadows, and a
constructivist logo mark built from a circle, a square, and a triangle.

## What's included

```
ai-vocab-extension/
├── extension/          Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── popup.html / popup.css / popup.js   Lookup tab + Saved Words tab (with lists)
│   ├── content.js                          Detects page text selection + sentence context
│   ├── background.js                       Right-click "Explain word" context menu
│   └── icons/                              Bauhaus-style toolbar icon (16/48/128px)
└── backend/             FastAPI server
    ├── main.py           POST /explain, POST/GET/DELETE /words
    ├── requirements.txt
    └── .env.example
```

## Core features

- **Type or highlight a word** — the popup opens pre-filled if you right-click
  a selection on any page, with the surrounding sentence captured as context.
- **General-first explanations** — every lookup returns a plain "general"
  definition immediately. Click **"Not what you needed?"** to reveal
  Simple, Technical, Academic, and Literary as alternates, fetched on demand.
- **Lists (folders)** — organize saved words into named lists, like albums
  for photos. Filter the Saved Words tab by list, add or remove a word from
  a list without deleting it, and a word can belong to more than one list.
- **Cost-safety by design** (see below) — the backend avoids calling Gemini
  whenever a cheaper or free option can answer the same question.
- **Bauhaus visual design** — color-blocked bands, hard offset shadows,
  square/pill-only corner radii, and a geometric circle/square/triangle
  logo mark used consistently in the header and the toolbar icon.

## How the backend keeps costs down

This matters if you ever run the backend publicly rather than just locally
for yourself — a public, keyless `/explain` endpoint is otherwise an easy
target for someone using it as a free unrestricted LLM proxy.

1. **Input validation** — `word` must be 1-4 plain words (letters, hyphens,
   apostrophes only), max 40 characters. `context` is capped at 300
   characters with newlines collapsed. This closes off using the word field
   to smuggle arbitrary prompts or instructions.
2. **Free dictionary API first** — a plain "general" style lookup with no
   context tries dictionaryapi.dev (free, no key) before ever touching
   Gemini. The LLM is only called for styled explanations
   (Technical/Academic/Literary/Simple), context-aware lookups, or words
   the dictionary API doesn't have.
3. **Server-side caching** — every context-free result, regardless of
   whether it came from the dictionary API or Gemini, is cached in
   `explain_cache.json` keyed by `word|style`. The next lookup of the same
   word in the same style, from any user, is served instantly for free.

What this does not yet cover, worth adding before going fully public:
- **Rate limiting** per user/IP (e.g. via `slowapi`) — nothing currently
  stops one client from calling `/explain` in a tight loop.
- **A hard spending cap** on the Gemini API key itself, via Google Cloud
  billing alerts, as a last-resort safety net.

## Design system

The popup follows a Bauhaus-inspired system rather than a generic utility
look:

- **Palette**: primary red (`#D02020`), blue (`#1040C0`), yellow (`#F0C020`),
  near-black (`#121212`), and an off-white background — nothing else.
- **Shape language**: every border radius is either `0` (square) or `9999px`
  (pill/circle) — no in-between rounding. Decorative elements are built from
  circles, squares, and triangles, matching the header logo mark.
- **Shadows**: hard offset shadows (e.g. `4px 4px 0 0 black`), never blurred.
  Buttons visually "press" on click by translating into their own shadow.
- **Typography**: Outfit (geometric sans), loaded from Google Fonts with a
  system geometric-sans fallback stack for offline use. Headlines are bold,
  uppercase, and tightly tracked.
- Respects `prefers-reduced-motion` by disabling hover-lift and press
  animations for users who've requested reduced motion at the OS level.

## 1. Run the backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt
cp .env.example .env
# edit .env and paste your GEMINI_API_KEY (get one at https://aistudio.google.com/app/apikey)
uvicorn main:app --reload --port 8000
```

Check it's alive: open http://localhost:8000/health — it should report
`"llm_configured": true` once your key is in `.env`.

Interactive API docs are auto-generated at http://localhost:8000/docs —
use this to test `/explain` directly before wiring up the extension.

## 2. Load the extension in Chrome

1. Go to `chrome://extensions`
2. Turn on Developer mode (top right)
3. Click Load unpacked
4. Select the `extension/` folder
5. Pin the extension from the puzzle-piece menu for easy access

If you're updating from a previous version, remove the old unpacked
extension entirely before loading the new folder, rather than just
reloading it — this avoids Chrome serving stale cached files.

## 3. Try it

- **Type a word**: click the extension icon, type a word, hit Explain — you
  get the general explanation immediately (from the free dictionary API if
  it has the word, otherwise from Gemini). Click "Not what you needed?"
  to try Simple/Technical/Academic/Literary instead.
- **Highlight a word on a page**: select any word/phrase, right-click,
  choose "Explain '...' with AI Vocabulary". Opens the popup pre-filled
  with the word and the sentence it came from.
- **Save**: after an explanation appears, click Save Word.
- **Organize into lists**: open the Saved Words tab, click + New
  list, name it, then use the "+ Add to list" dropdown on any saved word
  to file it into one or more lists. Click a list chip to filter down to
  just that list; click the x on a chip to delete the list entirely
  (the words themselves aren't deleted, just un-filed).

## API reference

| Endpoint | Method | Purpose |
|---|---|---|
| /health | GET | Check the server is up and the Gemini key is configured |
| /explain | POST | `{ word, context?, style }` -> explanation. Tries cache, then dictionary API, then Gemini, in that order |
| /words | POST | Save a word (not currently used by the extension, see note below) |
| /words | GET | List saved words, optional `?q=` search |
| /words/{id} | DELETE | Delete a saved word |

Note: the extension currently saves words to `chrome.storage.local`
directly, not through these `/words` endpoints — they're implemented and
ready for whenever you want saved words to live server-side instead of
per-browser (e.g. for cross-device sync).

## Notes

- The backend uses Gemini (`gemini-3.6-flash` via the Interactions API) as
  the LLM. This API is new and marked Beta by Google — if a future SDK
  update changes its shape again, the error will look like a 404 or a
  missing-attribute error naming the old method/model.
- `words.json` and `explain_cache.json` are flat files for simplicity —
  swap `_load_words`/`_save_words`/`_load_cache`/`_save_cache` for real
  database calls if you outgrow them (e.g. PostgreSQL, once you have
  multiple users or need real querying).
- Lists live only in `chrome.storage.local`, per-browser-profile — they
  don't sync across devices and are lost if the user removes the extension.
