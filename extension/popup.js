const API_BASE = "http://localhost:8000";

const els = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel"),

  // Lookup tab
  form: document.getElementById("lookup-form"),
  wordInput: document.getElementById("word-input"),
  explainBtn: document.getElementById("explain-btn"),
  contextBox: document.getElementById("context-box"),
  contextText: document.getElementById("context-text"),
  clearContext: document.getElementById("clear-context"),
  result: document.getElementById("result"),
  resultWord: document.getElementById("result-word"),
  resultPron: document.getElementById("result-pronunciation"),
  resultStyleBadge: document.getElementById("result-style-badge"),
  resultMeaning: document.getElementById("result-meaning"),
  resultExample: document.getElementById("result-example"),
  relatedWrap: document.getElementById("related-wrap"),
  resultRelated: document.getElementById("result-related"),
  saveBtn: document.getElementById("save-btn"),
  otherStylesBtn: document.getElementById("other-styles-btn"),
  stylePicker: document.getElementById("style-picker"),
  lookupPanel: document.getElementById("tab-lookup"),
  status: document.getElementById("status"),
  loadingDots: document.getElementById("loading-dots"),

  // Saved tab
  searchInput: document.getElementById("search-input"),
  savedList: document.getElementById("saved-list"),
  emptyState: document.getElementById("empty-state"),
  listChips: document.getElementById("list-chips"),
  newListBtn: document.getElementById("new-list-btn"),
  newListForm: document.getElementById("new-list-form"),
  newListInput: document.getElementById("new-list-input"),
  newListConfirm: document.getElementById("new-list-confirm"),
  newListCancel: document.getElementById("new-list-cancel"),
};

let currentExplanation = null; // last explanation payload for the currently displayed word
let currentContext = null;
let currentSourceUrl = null;
let activeListFilter = "all"; // "all" or a list name

// =========================================================================
// Tabs
// =========================================================================
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    els.tabs.forEach((t) => {
      t.classList.remove("tab--active");
      t.setAttribute("aria-selected", "false");
    });
    els.panels.forEach((p) => p.classList.remove("tab-panel--active"));
    tab.classList.add("tab--active");
    tab.setAttribute("aria-selected", "true");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("tab-panel--active");

    if (tab.dataset.tab === "saved") {
      renderListChips();
      renderSavedWords();
    }
  });
});

// =========================================================================
// Pre-fill from a highlighted word (set by content script / background)
// =========================================================================
async function loadPendingSelection() {
  const { pendingSelection } = await chrome.storage.local.get("pendingSelection");
  if (pendingSelection) {
    els.wordInput.value = pendingSelection.word;
    if (pendingSelection.context) {
      currentContext = pendingSelection.context;
      currentSourceUrl = pendingSelection.sourceUrl || null;
      els.contextText.textContent = pendingSelection.context;
      els.contextBox.classList.remove("hidden");
    }
    chrome.storage.local.remove("pendingSelection");
  }
}
loadPendingSelection();

els.clearContext.addEventListener("click", () => {
  currentContext = null;
  currentSourceUrl = null;
  els.contextBox.classList.add("hidden");
});

// =========================================================================
// Lookup — always starts with the "general" style. Other styles are
// fetched on demand only if the user asks for them.
// =========================================================================

async function fetchExplanation(word, style) {
  const res = await fetch(`${API_BASE}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, context: currentContext, style }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Server error (${res.status})`);
  }
  return res.json();
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = els.wordInput.value.trim();
  if (!word) return;
  await runLookup(word, "general");
});

async function runLookup(word, style) {
  els.lookupPanel.classList.add("is-compact"); // collapse the hero for good
  setStatus("", null);
  els.explainBtn.disabled = true;
  els.result.classList.add("hidden");
  els.stylePicker.classList.add("hidden");
  els.loadingDots.classList.remove("hidden");

  try {
    const data = await fetchExplanation(word, style);
    currentExplanation = data;
    renderResult(data);
    setStatus("", null);
  } catch (err) {
    console.error(err);
    setStatus(
      err.message.includes("fetch")
        ? "Can't reach the backend. Is it running at " + API_BASE + "?"
        : err.message,
      "error"
    );
  } finally {
    els.explainBtn.disabled = false;
    els.loadingDots.classList.add("hidden");
  }
}

function renderResult(data) {
  els.resultWord.textContent = data.word;
  els.resultWord.style.setProperty("--chars", String(data.word.length));
  els.resultPron.textContent = data.pronunciation ? `/${data.pronunciation}/` : "";
  els.resultStyleBadge.textContent = data.style;
  els.resultMeaning.textContent = data.meaning;
  els.resultExample.textContent = data.example || "—";

  if (data.related_words && data.related_words.length) {
    els.resultRelated.textContent = data.related_words.join(", ");
    els.relatedWrap.classList.remove("hidden");
  } else {
    els.relatedWrap.classList.add("hidden");
  }

  els.result.classList.remove("hidden");
  els.stylePicker.classList.add("hidden");

  // Grey out whichever style chip matches what's currently shown, so the
  // user can see which alternates they haven't tried yet.
  document.querySelectorAll(".style-chip").forEach((chip) => {
    chip.classList.toggle("style-chip--active", chip.dataset.style === data.style);
  });
}

// "Not what you needed?" reveals the style picker instead of immediately
// re-querying — the user picks which alternate they want.
els.otherStylesBtn.addEventListener("click", () => {
  els.stylePicker.classList.toggle("hidden");
});

document.querySelectorAll(".style-chip").forEach((chip) => {
  chip.addEventListener("click", async () => {
    if (!currentExplanation) return;
    await runLookup(currentExplanation.word, chip.dataset.style);
  });
});

// =========================================================================
// Save
// =========================================================================
els.saveBtn.addEventListener("click", async () => {
  if (!currentExplanation) return;

  const entry = {
    id: crypto.randomUUID(),
    word: currentExplanation.word,
    meaning: currentExplanation.meaning,
    explanation_type: currentExplanation.style,
    example: currentExplanation.example || "",
    context: currentContext || "",
    source_url: currentSourceUrl || "",
    date_saved: new Date().toISOString(),
    lists: [],
  };

  const { savedWords = [] } = await chrome.storage.local.get("savedWords");
  savedWords.unshift(entry);
  await chrome.storage.local.set({ savedWords });

  setStatus(`Saved "${entry.word}" to your vocabulary list.`, "success");
});

// =========================================================================
// Lists / folders
// =========================================================================

async function getLists() {
  const { wordLists = [] } = await chrome.storage.local.get("wordLists");
  return wordLists;
}

async function createList(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const lists = await getLists();
  if (lists.includes(trimmed)) return;
  lists.push(trimmed);
  await chrome.storage.local.set({ wordLists: lists });
  activeListFilter = trimmed;
  renderListChips();
  renderSavedWords(els.searchInput.value);
}

async function deleteList(name) {
  const lists = (await getLists()).filter((l) => l !== name);
  await chrome.storage.local.set({ wordLists: lists });

  const { savedWords = [] } = await chrome.storage.local.get("savedWords");
  const updated = savedWords.map((w) => ({
    ...w,
    lists: (w.lists || []).filter((l) => l !== name),
  }));
  await chrome.storage.local.set({ savedWords: updated });

  if (activeListFilter === name) activeListFilter = "all";
  renderListChips();
  renderSavedWords(els.searchInput.value);
}

async function toggleWordInList(wordId, listName) {
  const { savedWords = [] } = await chrome.storage.local.get("savedWords");
  const updated = savedWords.map((w) => {
    if (w.id !== wordId) return w;
    const current = w.lists || [];
    const has = current.includes(listName);
    return { ...w, lists: has ? current.filter((l) => l !== listName) : [...current, listName] };
  });
  await chrome.storage.local.set({ savedWords: updated });
  renderSavedWords(els.searchInput.value);
}

async function renderListChips() {
  const lists = await getLists();
  els.listChips.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "list-chip" + (activeListFilter === "all" ? " list-chip--active" : "");
  allChip.textContent = "All";
  allChip.addEventListener("click", () => {
    activeListFilter = "all";
    renderListChips();
    renderSavedWords(els.searchInput.value);
  });
  els.listChips.appendChild(allChip);

  lists.forEach((name) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "list-chip" + (activeListFilter === name ? " list-chip--active" : "");
    chip.innerHTML = `<span>${escapeHtml(name)}</span>`;

    const removeBtn = document.createElement("span");
    removeBtn.className = "list-chip__remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteList(name);
    });
    chip.appendChild(removeBtn);

    chip.addEventListener("click", () => {
      activeListFilter = name;
      renderListChips();
      renderSavedWords(els.searchInput.value);
    });

    els.listChips.appendChild(chip);
  });
}

els.newListBtn.addEventListener("click", () => {
  els.newListForm.classList.toggle("hidden");
  els.newListInput.value = "";
  els.newListInput.focus();
});

els.newListCancel.addEventListener("click", () => {
  els.newListForm.classList.add("hidden");
});

els.newListConfirm.addEventListener("click", async () => {
  await createList(els.newListInput.value);
  els.newListForm.classList.add("hidden");
});

els.newListInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    await createList(els.newListInput.value);
    els.newListForm.classList.add("hidden");
  }
});

// =========================================================================
// Saved words tab
// =========================================================================
async function renderSavedWords(filter = "") {
  const { savedWords = [] } = await chrome.storage.local.get("savedWords");
  const allLists = await getLists();

  let filtered = savedWords;
  if (activeListFilter !== "all") {
    filtered = filtered.filter((w) => (w.lists || []).includes(activeListFilter));
  }
  if (filter) {
    filtered = filtered.filter((w) => w.word.toLowerCase().includes(filter.toLowerCase()));
  }

  els.savedList.innerHTML = "";
  els.emptyState.classList.toggle("hidden", savedWords.length !== 0);

  filtered.forEach((entry) => {
    const wordLists = entry.lists || [];
    const availableToAdd = allLists.filter((l) => !wordLists.includes(l));

    const card = document.createElement("div");
    card.className = "saved-card";
    card.innerHTML = `
      <div class="saved-card__top">
        <strong>${escapeHtml(entry.word)}</strong>
        <button data-id="${entry.id}">Delete</button>
      </div>
      <p>${escapeHtml(entry.meaning)}</p>
      <div class="meta">
        <span class="meta__style">${escapeHtml(entry.explanation_type)}</span>
        <span>Saved ${new Date(entry.date_saved).toLocaleDateString()}</span>
      </div>
      <div class="saved-card__lists"></div>
      ${
        availableToAdd.length
          ? `<select class="saved-card__add-list">
              <option value="">+ Add to list</option>
              ${availableToAdd.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")}
            </select>`
          : ""
      }
    `;

    card.querySelector("[data-id]").addEventListener("click", async () => {
      const { savedWords: current = [] } = await chrome.storage.local.get("savedWords");
      const next = current.filter((w) => w.id !== entry.id);
      await chrome.storage.local.set({ savedWords: next });
      renderSavedWords(els.searchInput.value);
    });

    const listsWrap = card.querySelector(".saved-card__lists");
    wordLists.forEach((listName) => {
      const tag = document.createElement("span");
      tag.className = "word-list-tag";
      tag.innerHTML = `<span>${escapeHtml(listName)}</span>`;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `Remove from ${listName}`);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => toggleWordInList(entry.id, listName));
      tag.appendChild(removeBtn);
      listsWrap.appendChild(tag);
    });

    const addSelect = card.querySelector(".saved-card__add-list");
    if (addSelect) {
      addSelect.addEventListener("change", () => {
        if (addSelect.value) toggleWordInList(entry.id, addSelect.value);
      });
    }

    els.savedList.appendChild(card);
  });
}

els.searchInput.addEventListener("input", (e) => renderSavedWords(e.target.value));

// =========================================================================
// Utilities
// =========================================================================
function setStatus(msg, kind) {
  els.status.textContent = msg;
  els.status.className = "status" + (kind ? ` status--${kind}` : "");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
