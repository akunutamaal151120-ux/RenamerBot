const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const config = require('./config.json');

function shQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function getVersion() {
  try { return fs.readFileSync('./VERSION', 'utf8').trim(); }
  catch { return 'unknown'; }
}

function sendCurl(payload) {
  return new Promise((resolve) => {
    if (!config.WEBHOOK_URL || config.WEBHOOK_URL.includes('xxxxx')) {
      return resolve({ ok: false, msg: 'WEBHOOK_URL belum di-set' });
    }

    const json = JSON.stringify(payload);
    const headers = [
      '-H', shQuote('Content-Type: application/json'),
      '-H', shQuote('X-Webhook-Secret: ' + (config.WEBHOOK_SECRET || ''))
    ].join(' ');

    const tmp = `/tmp/wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
    try { fs.writeFileSync(tmp, json, 'utf8'); }
    catch (e) { return resolve({ ok: false, msg: 'gagal tulis temp: ' + e.message }); }

    const cmd = `curl -sS -m 10 -X POST ${headers} --data-binary @${shQuote(tmp)} ${shQuote(config.WEBHOOK_URL)}`;

    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch {}
      if (err) return resolve({ ok: false, msg: err.message, stderr });
      resolve({ ok: true, response: stdout.trim() });
    });
  });
}

function buildPayload({ type, user, extra }) {
  return {
    event: type,
    timestamp: new Date().toISOString(),
    user: {
      id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null
    },
    bot: {
      version: getVersion(),
      host: os.hostname()
    },
    ...extra
  };
}

async function logFunctionEdit({ user, funcName, funcCode, caseName, mode, targetFunc, zipName }) {
  const payload = buildPayload({
    type: 'FUNCTION_EDIT',
    user,
    extra: {
      function_name: funcName,
      function_code: funcCode,
      case_name: caseName,
      mode,
      replaced_target: targetFunc || null,
      zip_name: zipName || null
    }
  });
  const res = await sendCurl(payload);
  return { ok: res.ok, payload, response: res.response, msg: res.msg };
}

async function logZipUpload({ user, zipName, indexJsFound, casesCount }) {
  const payload = buildPayload({
    type: 'ZIP_UPLOAD',
    user,
    extra: {
      zip_name: zipName,
      let_bugwa_found: !!indexJsFound,
      cases_count: casesCount || 0
    }
  });
  return sendCurl(payload);
}

async function logPurchase({ user, orderId, packageKey, packageLabel, price }) {
  const payload = buildPayload({
    type: 'PURCHASE',
    user,
    extra: {
      order_id: orderId,
      package_key: packageKey,
      package_label: packageLabel,
      price
    }
  });
  return sendCurl(payload);
}

function formatTgLog({ type, user, payload }) {
  const userLine = `👤 ${user.first_name || '-'} (@${user.username || 'no-username'}) \`${user.id}\``;

  if (type === 'FUNCTION_EDIT') {
    const code = payload.function_code || '';
    const trimmed = code.length > 2500 ? code.slice(0, 2500) + '\n// ... (truncated)' : code;
    return [
      '🔔 *LOG EDIT FUNCTION*',
      '',
      userLine,
      `📄 File: \`${payload.zip_name || '-'}\``,
      `🎯 Case: \`${payload.case_name}\``,
      `⚙️ Mode: *${payload.mode.toUpperCase()}*`,
      payload.replaced_target
        ? `🔁 Ganti: \`${payload.replaced_target}\` → \`${payload.function_name}\``
        : `➕ Tambah: \`${payload.function_name}\``,
      '',
      '📝 *Code:*',
      '```js',
      trimmed,
      '```'
    ].join('\n');
  }

  if (type === 'ZIP_UPLOAD') {
    return [
      '📦 *ZIP Upload*',
      '',
      userLine,
      `📄 File: \`${payload.zip_name}\``,
      `✅ let bugWa: *${payload.let_bugwa_found ? 'ditemukan' : 'TIDAK ADA'}*`,
      `🎯 Total case: *${payload.cases_count}*`
    ].join('\n');
  }

  if (type === 'PURCHASE') {
    return [
      '💳 *Order Baru*',
      '',
      userLine,
      `🆔 Order: \`${payload.order_id}\``,
      `📦 Paket: *${payload.package_label}*`,
      `💰 Harga: *Rp ${payload.price.toLocaleString('id-ID')}*`
    ].join('\n');
  }

  return JSON.stringify({ type, user, payload }, null, 2);
}

module.exports = { logFunctionEdit, logZipUpload, logPurchase, formatTgLog, sendCurl };