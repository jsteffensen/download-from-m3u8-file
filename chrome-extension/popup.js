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
        <button class="download-btn" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(item.pageTitle || 'Untitled')}" data-index="${index}">Download M3U8</button>
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
        downloadUrl(this.getAttribute('data-url'), this.getAttribute('data-title'));
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

function sanitizeFilename(title) {
  // Trim whitespace at the beginning
  title = title.trim();
  
  // Remove everything from "PMP Exam Prep" onwards
  const pmpIndex = title.indexOf('PMP Exam Prep');
  if (pmpIndex !== -1) {
    title = title.substring(0, pmpIndex);
  }
  
  // Remove colons and other invalid filename characters
  // Invalid characters: < > : " / \ | ? *
  let sanitized = title.replace(/[<>:"/\\|?*]/g, '');
  
  // Trim whitespace and limit length
  sanitized = sanitized.trim();
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }
  
  // If empty after sanitization, use default
  if (sanitized.length === 0) {
    sanitized = 'playlist';
  }
  
  return sanitized;
}

function downloadUrl(url, pageTitle) {
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
      
      // Use sanitized page title as filename
      const filename = sanitizeFilename(pageTitle || 'playlist');
      a.download = `${filename}.m3u8`;
      
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