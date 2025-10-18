const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const https = require('https');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const readline = require('readline');
const crypto = require('crypto');

let express;
try {
  express = require('express');
} catch (err) {
  console.error('\n❌ Error: Required dependencies not installed.');
  console.error('Please run: npm install\n');
  console.error('After this you can run: node download\n');
  process.exit(1);
}

const app = express();
const port = 3000;
const CONCURRENCY_LIMIT = 8;
const SEGMENTS_DIR = './segments/';
const LOCAL_M3U8_PATH = './segments/local.m3u8';

// state variables
let segmentURLs;
let fileNameInput;

// Helper functions
function getFileName(url) {
  return url.split('/').pop();
}

function normalizeFileName(fileName) {
  return fileName.replace('.html', '.ts').replace('.jpg', '.ts');
}

function getFilePath(fileName) {
  return path.join(SEGMENTS_DIR, normalizeFileName(fileName));
}

async function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function downloadToTemp(url) {
  const proto = url.startsWith('https') ? https : http;
  const tempPath = path.join(SEGMENTS_DIR, '.temp_compare');

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tempPath);

    const request = proto.get(url, response => {
      if (response.statusCode !== 200) {
        fs.unlink(tempPath, () => {
          reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
        });
        return;
      }

      response.pipe(file);
    });

    file.on('finish', () => {
      file.close();
      resolve(tempPath);
    });

    request.on('error', err => {
      fs.unlink(tempPath, () => reject(err));
    });

    file.on('error', err => {
      fs.unlink(tempPath, () => reject(err));
    });

    request.end();
  });
}

async function shouldClearSegments(firstUrl) {
  try {
    const fileName = getFileName(firstUrl);
    const existingFilePath = getFilePath(fileName);
    
    // If file doesn't exist in segments, we need to clear and start fresh
    if (!fs.existsSync(existingFilePath)) {
      console.log('First segment not found in segments/. Will clear and download fresh.');
      return true;
    }
    
    // Download first file to temp location
    console.log('Checking if existing segments match source...');
    const tempPath = await downloadToTemp(firstUrl);
    
    // Compare hashes
    const existingHash = await getFileHash(existingFilePath);
    const newHash = await getFileHash(tempPath);
    
    // Clean up temp file
    await fsp.unlink(tempPath);
    
    if (existingHash === newHash) {
      console.log('Existing segments match source. Skipping already downloaded files.');
      return false;
    } else {
      console.log('Existing segments differ from source. Will clear and download fresh.');
      return true;
    }
    
  } catch (error) {
    console.error('Error checking segments:', error.message);
    console.log('Will clear segments to be safe.');
    return true;
  }
}

async function findM3u8File() {
  try {
    const files = await fsp.readdir('./');
    const m3u8Files = files.filter(file => 
      file.endsWith('.m3u8') && !file.startsWith('local.')
    );
    
    if (m3u8Files.length === 0) {
      console.error('\nNo .m3u8 file found in the script directory.');
      console.error('Please download and save an .m3u8 file in the same location as this script, using the Chrome extension.\n');
      process.exit(1);
    }
    
    if (m3u8Files.length > 1) {
      console.error('\nMultiple .m3u8 files found:');
      m3u8Files.forEach(file => console.error(`  - ${file}`));
      console.error('\nPlease delete old files so only one .m3u8 file is present.\n');
      process.exit(1);
    }
    
    // Return filename without extension
    const fileName = m3u8Files[0].replace('.m3u8', '');
    console.log(`Using m3u8 file: ${m3u8Files[0]}\n`);
    return fileName;
    
  } catch (error) {
    console.error('Error reading directory:', error.message);
    process.exit(1);
  }
}

(async () => {

  if(!fsp) {
    console.error('\nfs.promises is undefined.\nUsing Node ' + process.version + ' which may not support fs.promises.\nExiting process.\n');
    process.exit(1);
  }
  
  // Find the m3u8 file to use
  fileNameInput = await findM3u8File();
  
  // Load URLs from m3u8 file first to check the first segment
  const tempSegmentURLs = await getSegmentURLs(fileNameInput, true); // true = skip appending to local.m3u8
  
  if (tempSegmentURLs.length === 0) {
    console.error('No segments found in m3u8 file.');
    process.exit(1);
  }
  
  // Automatically determine if we should clear segments
  const needsToClear = await shouldClearSegments(tempSegmentURLs[0]);
  
  if (needsToClear) {
    await clearSegments();
  }
  
  // Make empty file
  makeNewM3u8File();

  // Load URLs again and build local m3u8 file
  segmentURLs = await getSegmentURLs(fileNameInput);

  // Download
  await downloadSegmentsConcurrently(segmentURLs, CONCURRENCY_LIMIT);

  console.log('\nDownload complete. Starting assembly...\n');

  // Automatically proceed to assembly
  app.use(express.static('segments'));

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/segments/local.m3u8'));
  });

  app.listen(port, () => {
    console.log(`Media server listening on port ${port}`);

    // Assemble the segments
    assembleToMP4(fileNameInput);
  });

})();

function makeNewM3u8File() {
  fs.closeSync(fs.openSync(LOCAL_M3U8_PATH, 'w'));
}

async function clearSegments() {
  try {
    const files = await fsp.readdir(SEGMENTS_DIR);

    for (const file of files) {
      if (!file.endsWith('.js')) {
        const filePath = path.join(SEGMENTS_DIR, file);
        await fsp.unlink(filePath);
      }
    }

    console.log('segments/ cleared');
  } catch (error) {
    console.error(`Error while deleting files: ${error.message}`);
  }
}

async function getSegmentURLs(fileNameInput, skipAppend = false) {
  let m3u8TextString = await fsp.readFile('./' + fileNameInput + '.m3u8', 'utf8');
  
  m3u8TextString = m3u8TextString.trim();
  
  let segmentURLs = [];
  let linesArray = m3u8TextString.split(/\r?\n/);
  
  for (let i = 0; i < linesArray.length; i++) {
    const line = linesArray[i].trim();
    
    if(!line) {
      continue;
    }

    // Write local m3u8 file (unless we're just checking URLs)
    if (!skipAppend) {
      await appendM3u8Line(line);
    }

    if (line.startsWith('http')) {
      segmentURLs.push(line);
    }
  }

  console.log(segmentURLs.length + ' segments.');
  return segmentURLs;
}

async function appendM3u8Line(data) {
  let modifiedData = data;

  if (data.startsWith('http')) {
    const fileName = getFileName(data);
    modifiedData = 'http://localhost:3000/' + normalizeFileName(fileName);
  } else if(data.startsWith('//cdn')) {
    const fileName = getFileName(data);
    modifiedData = 'http://localhost:3000/' + normalizeFileName(fileName);
  }

  try {
    await fsp.appendFile(LOCAL_M3U8_PATH, modifiedData + '\n');
  } catch (err) {
    console.error('Error appending to m3u8:', err);
  }
}

async function download(url, percent) {
  const proto = url.startsWith('https') ? https : http;

  const fileName = getFileName(url);
  const filePath = getFilePath(fileName);
  
  // Check if the file already exists
  if (fs.existsSync(filePath)) {
    console.log(`File ${fileName} already exists. Skipping download.`);
    return Promise.resolve({ message: 'File already exists', filePath });
  }

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    let fileInfo = null;

    const request = proto.get(url, response => {
      if (response.statusCode !== 200) {
        fs.unlink(filePath, () => {
          reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
        });
        return;
      }

      fileInfo = {
        mime: response.headers['content-type'],
        size: parseInt(response.headers['content-length'], 10),
      };

      response.pipe(file);
    });

    file.on('finish', () => {
      console.log(url + ' ' + percent);
      resolve(fileInfo);
    });

    request.on('error', err => {
      fs.unlink(filePath, () => reject(err));
    });

    file.on('error', err => {
      fs.unlink(filePath, () => reject(err));
    });

    request.end();
  });
}

async function downloadSegmentsConcurrently(urls, limit) {
  let downloadPromises = [];
  
  for (let i = 0; i < urls.length; i++) {
    const progress = Math.floor((i / urls.length) * 100) + '%';
    downloadPromises.push(download(urls[i], progress));

    if (downloadPromises.length >= limit) {
      await Promise.all(downloadPromises);
      downloadPromises = [];
    }
  }

  // Wait for any remaining downloads to finish
  if (downloadPromises.length > 0) {
    await Promise.all(downloadPromises);
  }
}

async function assembleToMP4(fileNameInput) {
  try {
    const { stdout, stderr } = await exec('ffmpeg -i http://localhost:3000 -c copy -bsf:a aac_adtstoasc ' + fileNameInput + '.mp4');
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
    
    process.exit(0);
    
  } catch (e) {
    console.error(e);
  }
}