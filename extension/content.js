// Tracks the most recent text selection on the page so the extension
// (popup or context-menu action) can grab both the word and its
// surrounding sentence for context-aware explanations.

let lastSelection = { word: "", context: "" };

function getSentenceContext(selection) {
  try {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const text = (container.textContent || "").trim();
    const selectedText = selection.toString().trim();

    if (!text || !selectedText) return selectedText;

    // Find the sentence that contains the selected word.
    const idx = text.indexOf(selectedText);
    if (idx === -1) return selectedText;

    const before = text.slice(0, idx);
    const after = text.slice(idx + selectedText.length);

    const sentenceStart = Math.max(
      before.lastIndexOf(". "),
      before.lastIndexOf("! "),
      before.lastIndexOf("? "),
      before.lastIndexOf("\n")
    );
    const startPos = sentenceStart === -1 ? 0 : sentenceStart + 2;

    const enders = [". ", "! ", "? ", "\n"];
    let endPos = after.length;
    for (const e of enders) {
      const p = after.indexOf(e);
      if (p !== -1) endPos = Math.min(endPos, p + 1);
    }

    return (before.slice(startPos) + selectedText + after.slice(0, endPos)).trim();
  } catch {
    return selection.toString().trim();
  }
}

document.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  const word = selection ? selection.toString().trim() : "";

  if (word && word.length > 0 && word.length < 60) {
    lastSelection = {
      word,
      context: getSentenceContext(selection),
    };
  }
});

// Respond to requests from the background/popup for the last selection.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_LAST_SELECTION") {
    sendResponse(lastSelection);
  }
  return true;
});
