const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./config.json');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function checkUpdate() {
  try {
    const remote = (await fetchText(config.UPDATE_URL)).trim();
    const localPath = path.join(__dirname, 'VERSION');
    const local = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8').trim() : '0.0.0';
    if (remote === local) return { ok: true, upToDate: true, local, remote };
    return { ok: true, upToDate: false, local, remote };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

async function performUpdate(files = ['bot.js', 'editor.js', 'credit.js', 'database.js', 'updater.js', 'package.json', 'VERSION']) {
  const results = [];
  for (const f of files) {
    try {
      const content = await fetchText(config.UPDATE_BASE + f);
      fs.writeFileSync(path.join(__dirname, f), content, 'utf8');
      results.push({ file: f, ok: true });
    } catch (e) {
      results.push({ file: f, ok: false, msg: e.message });
    }
  }
  return results;
}

module.exports = { checkUpdate, performUpdate, fetchText };