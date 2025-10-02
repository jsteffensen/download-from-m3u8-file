const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const https = require('https');
const express = require('express');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const readline = require('readline');

const app = express();
const port = 3000;
const CONCURRENCY_LIMIT = 8;
const fileNameInput = process.argv[2];

// state variables
let segmentURLs;

// Function to prompt the user
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.toLowerCase());
  }));
}

(async () => {

  if(!fsp) {
	console.error('\nfs.promises is undefined.\nUsing Node ' + process.version + ' which may not support fs.promises.\nExiting process.\n');
	process.exit(1);
  }
  
  const answerClear = await askQuestion('Do you want to clear segments? (y/n): ');
  
  if (answerClear === 'y') {
    await clearSegments();
  } else {
    console.log('Skipping segment clearing.');
  }
  
  // make empty file
  makeNewM3u8File();

  // load URLs from m3u8 file
  segmentURLs = await getSegmentURLs(fileNameInput);

  // download
  await downloadSegmentsConcurrently(segmentURLs, CONCURRENCY_LIMIT);

  const answerAssemble = await askQuestion('Do you want to assemble segments? (y/n): ');

  // finished download - now serve for VLC stream  
  if (answerAssemble === 'y') {

	  app.use(express.static('segments'));

	  app.get('/', (req, res) => {
		res.sendFile(path.join(__dirname, '/segments/local.m3u8'));
	  });

	  app.listen(port, () => {
		console.log(`media server listening on port ${port}`)

		// assemble the segments
		assembleToMP4(fileNameInput);
	  });
	
	
  } else {
    console.log('Skipping segment assembly.\n\nIf you are have downloaded from 037HDMovie run stripBinaryStart script next.');
  }


})();

function makeNewM3u8File() {
  const filePath = './segments/local.m3u8'
  fs.closeSync(fs.openSync(filePath, 'w'))
}

async function clearSegments() {
  try {
    // Read the directory
    const files = await fsp.readdir('./segments/');

    // Loop through all files and delete them
    for (const file of files) {
      if (file.indexOf('.js') < 0) {
        const filePath = path.join('./segments/', file);
        await fsp.unlink(filePath);
      }
    }

    console.log('segments/ cleared');
  } catch (error) {
    console.error(`Error while deleting files: ${error.message}`);
  }
}

async function getSegmentURLs(fileNameInput) {
  let m3u8TextString = await fsp.readFile('./' + fileNameInput + '.m3u8', 'utf8');
  
  m3u8TextString = m3u8TextString.trim();
  
  let segmentURLs = [];
  let linesArray = m3u8TextString.split(/\r?\n/);

  let hasWarnedAboutUrlSeed = false;
  
  for (let i = 0; i < linesArray.length; i++) {

    const line = linesArray[i].trim();
    
    if(!line) {
		continue;
	}

    // write local m3u8 file
    await appendM3u8Line(line);

    if (line.indexOf('http') == 0) {
      segmentURLs.push(line);
    }
  }

  console.log(segmentURLs.length + ' segments.');
  return segmentURLs;
}

async function appendM3u8Line(data) {

  if (data.indexOf('http') == 0) {
    let fileName = data.split('/')[(data.split('/').length - 1)];
    data = 'http://localhost:3000/' + fileName;
	data = data.replace('.html', '.ts');
  } else if(data.indexOf('//cdn') == 0) {
	let fileName = data.split('/')[(data.split('/').length - 1)];
	fileName = fileName.replace('.jpg', '.ts');
    data = 'http://localhost:3000/' + fileName;  
  }

  await fsp.appendFile('./segments/local.m3u8', data + '\n', function (err) {
    if (err) {
      console.log(err);
    }
  });
}

async function download(url, percent) {
  const proto = !url.charAt(4).localeCompare('s') ? https : http;

  let fileName = url.split('/')[(url.split('/').length - 1)];
  fileName = fileName.replace('.html', '.ts');
  let filePath = './segments/' + fileName;
  
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

    // The destination stream is ended by the time it's called
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
  const downloadPromises = [];
  for (let i = 0; i < urls.length; i++) {
    let progress = Math.floor((i / urls.length) * 100) + '%';
    downloadPromises.push(download(urls[i], progress));

    if (downloadPromises.length >= limit) {
      await Promise.all(downloadPromises);
      downloadPromises.length = 0; // Clear the array to allow new concurrent downloads
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