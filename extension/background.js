chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "explain-word",
    title: 'Explain "%s" with Vocablurry',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "explain-word" || !tab?.id) return;

  const word = (info.selectionText || "").trim();
  if (!word) return;

  let context = "";
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_LAST_SELECTION" });
    if (response && response.word === word) {
      context = response.context;
    }
  } catch {
    // content script may not be loaded on this page (e.g. chrome:// pages)
  }

  await chrome.storage.local.set({
    pendingSelection: {
      word,
      context,
      sourceUrl: tab.url || "",
    },
  });

  chrome.action.openPopup().catch(() => {
    // openPopup() isn't available in every Chrome version/context;
    // the pendingSelection will still be picked up next time the user
    // opens the popup manually.
  });
});
