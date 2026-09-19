"""
AI Vocabulary Browser Extension — backend API.

Implements the two core endpoints from the project plan's first milestone:
  POST /explain          -> contextual, style-specific word explanation via an LLM
  POST /words             -> save a word
  GET  /words              -> list saved words
  DELETE /words/{id}       -> delete a saved word

Storage for V1 is a local JSON file (words.json), matching the plan's
"start simple, add PostgreSQL later" guidance. Swap `storage.py` for a
real database without touching the route handlers.
"""

import os
import re
import uuid
import json
from datetime import datetime, timezone
from typing import Optional, List

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv
from google import genai

load_dotenv()

app = FastAPI(title="AI Vocabulary Extension API", version="1.0.0")

# The extension's popup runs from a chrome-extension:// origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

WORDS_FILE = os.path.join(os.path.dirname(__file__), "words.json")
CACHE_FILE = os.path.join(os.path.dirname(__file__), "explain_cache.json")
DICTIONARY_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/{word}"

VALID_STYLES = {"simple", "general", "technical", "academic", "literary"}

# Accepts 1-4 space-separated words, letters plus internal apostrophes/hyphens
# only (e.g. "well-being", "don't"). Rejects newlines, digits, and anything
# that looks like an attempt to smuggle a full prompt/instruction through
# the word field on a public, keyless endpoint.
WORD_PATTERN = re.compile(r"^[A-Za-z]+(?:['\-][A-Za-z]+)*(?: [A-Za-z]+(?:['\-][A-Za-z]+)*){0,3}$")

STYLE_INSTRUCTIONS = {
    "simple": "Explain it the way you'd explain it to a curious 10-year-old. Very short words.",
    "general": "Give a clear, everyday explanation suitable for a general adult audience.",
    "technical": "Explain it the way you would for a computer science student — connect the concept to programming, algorithms, data structures, or computing terminology wherever a natural link exists, and give the precise technical definition.",
    "academic": "Give a formal, academic explanation, noting etymology or nuance where relevant.",
    "literary": "Give an explanation with attention to connotation, tone, and literary usage.",
}


# ---------- Schemas ----------

class ExplainRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=40)
    context: Optional[str] = Field(None, max_length=300)
    style: str = "general"

    @field_validator("word")
    @classmethod
    def validate_word_shape(cls, v: str) -> str:
        v = v.strip()
        if not WORD_PATTERN.match(v):
            raise ValueError(
                "word must be 1-4 plain words (letters, hyphens, apostrophes only) — "
                "not a sentence, prompt, or special characters"
            )
        return v

    @field_validator("context")
    @classmethod
    def validate_context_no_newlines(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        # Collapse newlines rather than reject outright — real page text
        # sometimes carries them, but they're not needed in the prompt.
        return " ".join(v.split())


class ExplainResponse(BaseModel):
    word: str
    meaning: str
    example: Optional[str] = None
    pronunciation: Optional[str] = None
    related_words: List[str] = []
    style: str


class WordEntry(BaseModel):
    word: str
    meaning: str
    explanation_type: str
    example: Optional[str] = ""
    context: Optional[str] = ""
    source_url: Optional[str] = ""


class WordEntryOut(WordEntry):
    id: str
    date_saved: str


# ---------- Storage helpers ----------

def _load_words() -> List[dict]:
    if not os.path.exists(WORDS_FILE):
        return []
    with open(WORDS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_words(words: List[dict]) -> None:
    with open(WORDS_FILE, "w", encoding="utf-8") as f:
        json.dump(words, f, indent=2, ensure_ascii=False)


# ---------- Step 3: cache for context-free lookups ----------
# Keyed by "word|style". Only used when the request has no `context`, since
# context is user/page-specific and shouldn't be shared across users.

def _load_cache() -> dict:
    if not os.path.exists(CACHE_FILE):
        return {}
    with open(CACHE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_cache(cache: dict) -> None:
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def _cache_key(word: str, style: str) -> str:
    return f"{word.lower()}|{style}"


# ---------- Step 2: free dictionary API for plain "general" lookups ----------

async def fetch_from_dictionary_api(word: str) -> Optional[dict]:
    """Try the free dictionaryapi.dev API for a plain general-style definition.
    Returns None on any failure (word not found, API down, timeout, etc.) so
    the caller can fall back to the LLM — this API is community-run and not
    guaranteed to be up or to have every word."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as http_client:
            resp = await http_client.get(DICTIONARY_API_URL.format(word=word))
        if resp.status_code != 200:
            return None

        data = resp.json()
        if not data or not isinstance(data, list):
            return None

        entry = data[0]
        phonetic = entry.get("phonetic") or ""
        phonetic = phonetic.strip("/") if phonetic else None

        meanings = entry.get("meanings") or []
        if not meanings:
            return None
        definitions = meanings[0].get("definitions") or []
        if not definitions:
            return None

        first_def = definitions[0]
        meaning = first_def.get("definition")
        if not meaning:
            return None
        example = first_def.get("example")
        synonyms = first_def.get("synonyms") or meanings[0].get("synonyms") or []

        return {
            "meaning": meaning,
            "example": example,
            "pronunciation": phonetic,
            "related_words": synonyms[:4],
        }
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return None


# ---------- Routes ----------

@app.get("/health")
def health():
    return {"status": "ok", "llm_configured": client is not None}


@app.post("/explain", response_model=ExplainResponse)
async def explain(req: ExplainRequest):
    style = req.style if req.style in VALID_STYLES else "general"
    cacheable = req.context is None or req.context == ""
    cache_key = _cache_key(req.word, style) if cacheable else None

    # 1. Cache hit — zero cost, regardless of how it was originally produced.
    if cacheable:
        cache = _load_cache()
        if cache_key in cache:
            return ExplainResponse(word=req.word, style=style, **cache[cache_key])

    # 2. Plain "general" lookup with no context — try the free dictionary
    #    API first and skip the LLM entirely if it has an answer.
    if style == "general" and cacheable:
        dict_result = await fetch_from_dictionary_api(req.word)
        if dict_result:
            if cacheable:
                cache = _load_cache()
                cache[cache_key] = dict_result
                _save_cache(cache)
            return ExplainResponse(word=req.word, style=style, **dict_result)

    # 3. Fall back to the LLM — styled explanations, context-aware requests,
    #    or words the dictionary API didn't have.
    if client is None:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not set on the server. Add it to backend/.env",
        )

    context_line = f'\nSentence context: "{req.context}"' if req.context else ""

    prompt = f"""You are a vocabulary assistant. A user wants to understand the word: "{req.word}"{context_line}

Style instructions: {STYLE_INSTRUCTIONS[style]}

Respond ONLY with a JSON object (no markdown fences, no preamble) with exactly these keys:
{{
  "meaning": "<the explanation, 1-3 sentences>",
  "example": "<one example sentence using the word, different from the given context if any>",
  "pronunciation": "<a simple phonetic pronunciation, or null if unsure>",
  "related_words": ["<up to 4 related or similar words, or empty list>"]
}}"""

    try:
        try:
            interaction = client.interactions.create(
                model="gemini-3.6-flash",
                input=prompt,
            )
            # Google's Interactions API (Beta) has shown both response shapes
            # in its own docs while it stabilizes — support both defensively.
            raw_text = getattr(interaction, "output_text", None)
            if not raw_text:
                outputs = getattr(interaction, "outputs", None)
                if outputs:
                    raw_text = outputs[-1].text
            raw_text = raw_text or ""
        except AttributeError:
            # Installed google-genai SDK predates the Interactions API —
            # fall back to the older models.generate_content call.
            response = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=prompt,
            )
            raw_text = response.text or ""

        cleaned = raw_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Could not parse the LLM's response. Try again.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e}")

    result = {
        "meaning": parsed.get("meaning", ""),
        "example": parsed.get("example"),
        "pronunciation": parsed.get("pronunciation"),
        "related_words": parsed.get("related_words", []) or [],
    }

    # Cache LLM results too, whenever the request was context-free — a
    # styled ("technical", "academic", etc.) lookup of the same word will
    # hit this cache next time instead of calling Gemini again.
    if cacheable:
        cache = _load_cache()
        cache[cache_key] = result
        _save_cache(cache)

    return ExplainResponse(word=req.word, style=style, **result)


@app.post("/words", response_model=WordEntryOut, status_code=201)
def save_word(entry: WordEntry):
    words = _load_words()
    new_entry = {
        "id": str(uuid.uuid4()),
        "date_saved": datetime.now(timezone.utc).isoformat(),
        **entry.model_dump(),
    }
    words.insert(0, new_entry)
    _save_words(words)
    return new_entry


@app.get("/words", response_model=List[WordEntryOut])
def list_words(q: Optional[str] = None):
    words = _load_words()
    if q:
        q_lower = q.lower()
        words = [w for w in words if q_lower in w["word"].lower()]
    return words


@app.delete("/words/{word_id}", status_code=204)
def delete_word(word_id: str):
    words = _load_words()
    remaining = [w for w in words if w["id"] != word_id]
    if len(remaining) == len(words):
        raise HTTPException(status_code=404, detail="Word not found")
    _save_words(remaining)
    return None
