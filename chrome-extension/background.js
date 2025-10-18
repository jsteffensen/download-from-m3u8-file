// Track M3U8 requests per tab URL
const m3u8Tracker = new Map();

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    
    // Check if URL ends with /0 or contains m3u8 patterns
    if (url.endsWith('/0') || url.includes('.m3u8')) {
      
      // Get the tab's current URL to use as tracking key
      chrome.tabs.get(details.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          return;
        }
        
        const pageUrl = tab.url;
        const pageTitle = tab.title || 'Untitled';
        const trackingKey = `${pageUrl}_${details.tabId}`;
        
        // Initialize tracker for this page if needed
        if (!m3u8Tracker.has(trackingKey)) {
          m3u8Tracker.set(trackingKey, []);
        }
        
        const tracker = m3u8Tracker.get(trackingKey);
        tracker.push({
          url: url,
          timestamp: Date.now(),
          tabId: details.tabId,
          pageUrl: pageUrl,
          pageTitle: pageTitle
        });
        
        console.log(`M3U8 Request #${tracker.length} for page ${pageUrl}:`, url);
        
        // Keep only last 5 requests per page
        if (tracker.length > 5) {
          tracker.shift();
        }
        
        // If this is the second request for this specific page, save it
        if (tracker.length === 2) {
          const secondUrl = tracker[1].url;
          console.log('🎯 SECOND M3U8 URL CAPTURED:', secondUrl);
          console.log('   From page:', pageUrl);
          console.log('   Page title:', pageTitle);
          
          // Save to storage
          chrome.storage.local.get(['capturedUrls'], (result) => {
            const urls = result.capturedUrls || [];
            urls.unshift({
              url: secondUrl,
              pageUrl: pageUrl,
              pageTitle: pageTitle,
              timestamp: new Date().toISOString(),
              tabId: details.tabId
            });
            
            // Keep only last 20 captures
            if (urls.length > 20) {
              urls.length = 20;
            }
            
            chrome.storage.local.set({ capturedUrls: urls });
          });
          
          // Show notification badge
          chrome.action.setBadgeText({ text: '!' });
          chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        }
      });
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// Clear tracker when navigation occurs
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) { // Main frame navigation
    // Clear all tracking for this tab
    const keysToDelete = [];
    for (const [key, tracker] of m3u8Tracker.entries()) {
      if (tracker.length > 0 && tracker[0].tabId === details.tabId) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => m3u8Tracker.delete(key));
    console.log(`Navigation detected in tab ${details.tabId}, cleared tracker`);
  }
});

// Clear tracker when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  const keysToDelete = [];
  for (const [key, tracker] of m3u8Tracker.entries()) {
    if (tracker.length > 0 && tracker[0].tabId === tabId) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => m3u8Tracker.delete(key));
});