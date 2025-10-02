function displayUrls() {
  chrome.storage.local.get(['capturedUrls'], (result) => {
    const urls = result.capturedUrls || [];
    const urlList = document.getElementById('urlList');
    
    if (urls.length === 0) {
      urlList.innerHTML = '<p style="color: #999;">No URLs captured yet. Visit a streaming site.</p>';
      return;
    }
    
    urlList.innerHTML = urls.map((item, index) => `
      <div class="url-item">
        <div class="domain">Page: ${item.pageUrl}</div>
        <div class="url-text">${item.url}</div>
        <div class="timestamp">${item.timestamp}</div>
        <button class="copy-btn" data-url="${escapeHtml(item.url)}" data-index="${index}">Copy URL</button>
        <button class="download-btn" data-url="${escapeHtml(item.url)}" data-index="${index}">Download M3U8</button>
      </div>
    `).join('');
    
    // Attach event listeners to buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        copyUrl(this.getAttribute('data-url'));
      });
    });
    
    document.querySelectorAll('.download-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        downloadUrl(this.getAttribute('data-url'));
      });
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyUrl(url) {
  navigator.clipboard.writeText(url).then(() => {
    showStatus('Copied!');
  }).catch(err => {
    showStatus('Copy failed: ' + err.message);
  });
}

function downloadUrl(url) {
  // Try to fetch and download the M3U8 file
  fetch(url)
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.text();
    })
    .then(content => {
      const blob = new Blob([content], { type: 'application/vnd.apple.mpegurl' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `playlist_${Date.now()}.m3u8`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      showStatus('Downloaded!');
    })
    .catch(err => {
      showStatus('Error: ' + err.message);
    });
}

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

document.getElementById('clearBadge').addEventListener('click', () => {
  chrome.action.setBadgeText({ text: '' });
  showStatus('Badge cleared');
});

document.getElementById('clearAll').addEventListener('click', () => {
  chrome.storage.local.set({ capturedUrls: [] }, () => {
    displayUrls();
    showStatus('All URLs cleared');
  });
});

// Display URLs on load
displayUrls();

// Refresh every 2 seconds
setInterval(displayUrls, 2000);