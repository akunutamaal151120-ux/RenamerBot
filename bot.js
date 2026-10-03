const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const editor = require('./editor');
const credit = require('./credit');
const db = require('./database');
const updater = require('./updater');
const deploy = require('./deploy');
const config = require('./config.json');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });
const sessions = new Map();

for (const d of [config.TMP_DIR, config.OUT_DIR, config.DATA_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ==== HELPERS ====
function isOwner(msg) { return msg.from.id === config.OWNER_ID; }
function isAdmin(msg) { return config.ADMIN_IDS.includes(msg.from.id); }

function send(chatId, text, opts = {}) {
  return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
}

function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, { step: 'idle' });
  return sessions.get(chatId);
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

// ==== KEYBOARDS ====
function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📦 Upload API Zip', callback_data: 'menu_upload' }],
        [
          { text: '✏️ Edit Function', callback_data: 'menu_edit' },
          { text: '🆕 Auto-Create Function', callback_data: 'menu_create' }
        ],
        [
          { text: '🌐 Deploy Web', callback_data: 'menu_deploy' },
          { text: '⚙️ Settings', callback_data: 'menu_settings' }
        ],
        [
          { text: '💳 Beli Credit', callback_data: 'menu_buy' },
          { text: '👤 Profil Saya', callback_data: 'menu_profile' }
        ],
        [{ text: '🔄 Cek Update Bot', callback_data: 'menu_update' }]
      ]
    }
  };
}

function backMenu() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '⬅️ Menu Utama', callback_data: 'menu_home' }]]
    }
  };
}

function buyMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `50 Credit — ${credit.formatRp(config.PRICE.credit_50)}`, callback_data: 'buy_credit_50' }],
        [{ text: `100 Credit — ${credit.formatRp(config.PRICE.credit_100)}`, callback_data: 'buy_credit_100' }],
        [{ text: `500 Credit — ${credit.formatRp(config.PRICE.credit_500)}`, callback_data: 'buy_credit_500' }],
        [{ text: `1000 Credit — ${credit.formatRp(config.PRICE.credit_1000)}`, callback_data: 'buy_credit_1000' }],
        [{ text: `♾️ Permanent (Unlimited) — ${credit.formatRp(config.PRICE.prem)}`, callback_data: 'buy_prem' }],
        [{ text: '⬅️ Menu Utama', callback_data: 'menu_home' }]
      ]
    }
  };
}

// ==== /start ====
async function showHome(chatId, user, editMsgId) {
  const u = db.getUser(user.id);
  const text = [
    `👋 *Halo, ${user.first_name || 'XOW'}!*`,
    '',
    'Bot Editor API APK v2',
    'Pilih menu di bawah ini.',
    '',
    `💳 Credit: *${u.prem ? '♾️ Unlimited (Prem)' : u.credit}*`,
    `🎯 Total Ops: *${u.totalOps || 0}*`
  ].join('\n');

  const opts = { ...mainMenu(), parse_mode: 'Markdown' };

  if (editMsgId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: editMsgId, ...opts });
      return;
    } catch {}
  }

  try {
    await bot.sendPhoto(chatId, config.WELCOME_PHOTO_URL, {
      caption: text,
      parse_mode: 'Markdown',
      ...mainMenu()
    });
  } catch {
    // fallback kalau foto gagal
    await bot.sendMessage(chatId, text, opts);
  }
}

bot.onText(/^\/start/, async (msg) => {
  const s = getSession(msg.chat.id);
  s.step = 'idle';
  db.getUser(msg.from.id);
  await showHome(msg.chat.id, msg.from);
});

bot.onText(/^\/cancel/, (msg) => {
  sessions.delete(msg.chat.id);
  send(msg.chat.id, '❌ Session dibatalin.', backMenu());
});

bot.onText(/^\/id/, (msg) => {
  send(msg.chat.id, `🆔 User ID: \`${msg.from.id}\`\nChat ID: \`${msg.chat.id}\``);
});

// ==== CALLBACK QUERY ====
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;
  const user = q.from;
  const s = getSession(chatId);

  await bot.answerCallbackQuery(q.id).catch(() => {});

  // ---- Navigation ----
  if (data === 'menu_home') {
    s.step = 'idle';
    return showHome(chatId, user, msgId);
  }

  if (data === 'menu_profile') {
    const u = db.getUser(user.id);
    const txt = [
      `👤 *Profil — ${user.first_name || '-'}*`,
      '',
      `🆔 ID: \`${user.id}\``,
      `💳 Credit: *${u.prem ? '♾️ Unlimited' : u.credit}*`,
      `⭐ Prem: *${u.prem ? 'YA' : 'TIDAK'}*`,
      `🎯 Total Ops: *${u.totalOps || 0}*`,
      `📅 Joined: ${new Date(u.joined).toLocaleString('id-ID')}`,
      `🕒 Last Daily: ${u.lastDaily ? new Date(u.lastDaily).toLocaleString('id-ID') : '-'}`
    ].join('\n');
    return bot.editMessageText(txt, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
      ...backMenu()
    });
  }

  if (data === 'menu_buy') {
    const txt = [
      '💳 *Beli Credit*',
      '',
      'Pilih paket. Setelah pilih, lo bakal dapat ID order — kirim ID itu ke owner buat bayar.',
      'Owner bakal konfirmasi, credit masuk otomatis.',
      '',
      `📞 Kontak owner: ${config.OWNER_CONTACT}`
    ].join('\n');
    return bot.editMessageText(txt, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
      ...buyMenu()
    });
  }

  // ---- Buy ----
  if (data.startsWith('buy_')) {
    const key = data.slice(4);
    const pkg = credit.parsePackage(key);
    if (!pkg) return;

    const order = db.newPending(user.id, pkg.type, pkg.amount);
    const txt = [
      '✅ *Order Dibuat*',
      '',
      `📦 Paket: *${pkg.label}*`,
      `💰 Harga: *${credit.formatRp(pkg.price)}*`,
      `🆔 Order ID: \`${order.id}\``,
      '',
      `Kirim order ID ke owner: ${config.OWNER_CONTACT}`,
      'Setelah bayar & owner konfirmasi, credit otomatis masuk.'
    ].join('\n');
    await bot.editMessageText(txt, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
      ...backMenu()
    });

    // Notify owner
    const ownerMsg = [
      '🔔 *ORDER BARU*',
      '',
      `👤 User: ${user.first_name || '-'} (\`${user.id}\`)`,
      `📦 Paket: *${pkg.label}*`,
      `💰 Harga: *${credit.formatRp(pkg.price)}*`,
      `🆔 Order ID: \`${order.id}\``
    ].join('\n');

    bot.sendMessage(config.OWNER_ID, ownerMsg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: `approve_${order.id}` },
          { text: '❌ Reject', callback_data: `reject_${order.id}` }
        ]]
      }
    }).catch(() => {});
    return;
  }

  // ---- Approve / Reject (owner only) ----
  if (data.startsWith('approve_')) {
    if (user.id !== config.OWNER_ID) return;
    const orderId = data.slice(8);
    const order = db.getPending(orderId);
    if (!order) return send(chatId, '❌ Order ga ketemu.');
    if (order.status !== 'pending') return send(chatId, '⚠️ Order udah diproses.');

    db.updatePending(orderId, { status: 'approved', approvedAt: Date.now() });
    if (order.type === 'prem') {
      credit.setPrem(order.userId, true);
    } else {
      credit.addCredit(order.userId, order.amount);
    }

    bot.sendMessage(order.userId, [
      '✅ *Order Disetujui!*',
      `🆔 Order: \`${orderId}\``,
      order.type === 'prem'
        ? '⭐ Status: *Permanent (Unlimited)*'
        : `💳 Credit ditambah: *${order.amount}*`
    ].join('\n'), { parse_mode: 'Markdown' }).catch(() => {});

    return bot.editMessageText(
      q.message.text + '\n\n✅ *APPROVED*',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  if (data.startsWith('reject_')) {
    if (user.id !== config.OWNER_ID) return;
    const orderId = data.slice(7);
    const order = db.getPending(orderId);
    if (!order || order.status !== 'pending') return;
    db.updatePending(orderId, { status: 'rejected', rejectedAt: Date.now() });

    bot.sendMessage(order.userId, `❌ Order \`${orderId}\` ditolak.`, { parse_mode: 'Markdown' }).catch(() => {});
    return bot.editMessageText(
      q.message.text + '\n\n❌ *REJECTED*',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  // ---- Menu actions ----
  if (data === 'menu_upload') {
    s.step = 'await_zip';
    return bot.editMessageText(
      '📦 Kirim file `api.zip` sebagai document sekarang.',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...backMenu() }
    );
  }

  if (data === 'menu_edit') {
    if (!s.indexJsPath) {
      return bot.editMessageText(
        '⚠️ Belum ada file aktif. Upload `api.zip` dulu.',
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...backMenu() }
      );
    }
    s.step = 'await_func';
    return bot.editMessageText(
      '📝 Kirim kode function baru.',
      { chat_id: chatId, message_id: msgId, ...backMenu() }
    );
  }

  if (data === 'menu_create') {
    s.step = 'create_name';
    return bot.editMessageText(
      [
        '🆕 *Auto-Create Function*',
        '',
        'Ketik nama function (contoh: `spamPesan`).',
        'Bot bakal generate template, lo tinggal modif.'
      ].join('\n'),
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...backMenu() }
    );
  }

  if (data === 'menu_deploy') {
    const st = await deploy.startServer().catch(e => ({ ok: false, msg: e.message }));
    const files = deploy.listWeb();
    const txt = [
      '🌐 *Deploy Web*',
      '',
      st.ok ? `✅ Server aktif di port *${st.port}*` : `❌ ${st.msg || 'Gagal start server'}`,
      `📁 Files: ${files.length}`,
      files.length ? files.slice(0, 15).map(f => `• \`${f}\``).join('\n') : '',
      '',
      'Kirim `web.zip` buat deploy konten baru.'
    ].filter(Boolean).join('\n');
    s.step = 'await_web_zip';
    return bot.editMessageText(txt, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: '⬆️ Upload web.zip', callback_data: 'menu_deploy' }],
        [{ text: '⬅️ Menu Utama', callback_data: 'menu_home' }]
      ] }
    });
  }

  if (data === 'menu_settings') {
    const u = db.getUser(user.id);
    const txt = [
      '⚙️ *Settings*',
      '',
      `💳 Credit: *${u.prem ? '♾️ Unlimited' : u.credit}*`,
      `⭐ Prem: *${u.prem ? 'YA' : 'TIDAK'}*`,
      `📞 Owner: ${config.OWNER_CONTACT}`
    ].join('\n');
    return bot.editMessageText(txt, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: '💳 Beli Credit', callback_data: 'menu_buy' }],
        [{ text: '👤 Profil', callback_data: 'menu_profile' }],
        [{ text: '⬅️ Menu Utama', callback_data: 'menu_home' }]
      ] }
    });
  }

  if (data === 'menu_update') {
    const res = await updater.checkUpdate();
    let txt;
    if (!res.ok) txt = `❌ Gagal cek update: ${res.msg}`;
    else if (res.upToDate) txt = `✅ Bot sudah versi terbaru (\`${res.local}\`)`;
    else txt = `🔄 Update tersedia!\nLocal: \`${res.local}\`\nRemote: \`${res.remote}\``;
    return bot.editMessageText(txt, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        ...(res.ok && !res.upToDate ? [[{ text: '⬇️ Update Sekarang', callback_data: 'do_update' }]] : []),
        [{ text: '⬅️ Menu Utama', callback_data: 'menu_home' }]
      ] }
    });
  }

  if (data === 'do_update') {
    if (!isAdmin({ from: user })) return;
    await bot.editMessageText('⏳ Sedang update...', { chat_id: chatId, message_id: msgId });
    const results = await updater.performUpdate();
    const ok = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok);
    const txt = [
      `✅ *Update selesai*`,
      `📦 Sukses: ${ok}/${results.length}`,
      ...(fail.length ? ['', '❌ Gagal:', ...fail.map(f => `• ${f.file}: ${f.msg}`)] : []),
      '',
      '⚠️ Restart bot dari panel buat apply.'
    ].join('\n');
    return bot.editMessageText(txt, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...backMenu() });
  }

  // ---- Case selection buttons ----
  if (data.startsWith('case_')) {
    const caseName = data.slice(5);
    if (!s.indexJsPath) return;
    s.caseName = caseName;
    s.step = 'select_mode';
    return bot.editMessageText(
      `🎯 Case: \`${caseName}\`\n\nPilih aksi:`,
      {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '➕ Tambah', callback_data: 'mode_add' }],
          [{ text: '🔁 Replace', callback_data: 'mode_replace' }],
          [{ text: '⬅️ Menu Utama', callback_data: 'menu_home' }]
        ] }
      }
    );
  }

  if (data === 'mode_add') {
    const c = credit.canUse(user.id);
    if (!c.ok) return send(chatId, `⚠️ ${c.reason}`);
    const src = fs.readFileSync(s.indexJsPath, 'utf8');
    const res = editor.addCallInCase(src, s.caseName, s.funcName, 'sock, targetJid');
    if (!res.ok) return send(chatId, `❌ ${res.msg}`);
    fs.writeFileSync(s.indexJsPath, res.src, 'utf8');
    credit.deduct(user.id);
    return finalize(chatId, s);
  }

  if (data === 'mode_replace') {
    s.step = 'await_target';
    return bot.editMessageText(
      '🔁 Ketik nama function yang mau *diganti* di case ini.',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', ...backMenu() }
    );
  }

  if (data === 'mode_skip') {
    return finalize(chatId, s);
  }
});

// ==== DOCUMENT (zip upload) ====
bot.on('document', async (msg) => {
  if (!isAdmin(msg)) return;
  const s = getSession(msg.chat.id);
  const doc = msg.document;
  const fname = doc.file_name || '';

  // Web zip deploy
  if (s.step === 'await_web_zip' && fname.endsWith('.zip')) {
    try {
      const dir = path.join(config.TMP_DIR, `web_${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      const fp = await bot.downloadFile(doc.file_id, dir);
      deploy.deployZip(fp);
      deploy.startServer();
      const files = deploy.listWeb();
      send(msg.chat.id, `✅ Web deployed. ${files.length} files aktif.`, backMenu());
      s.step = 'idle';
    } catch (e) { send(msg.chat.id, `❌ ${e.message}`); }
    return;
  }

  // API zip
  if (s.step !== 'await_zip' && s.step !== 'idle') {
    return send(msg.chat.id, '⚠️ Lagi di tengah alur. /cancel dulu kalau mau reset.');
  }
  if (!fname.endsWith('.zip')) return send(msg.chat.id, '❌ File harus `.zip`.');

  send(msg.chat.id, '📥 Download & extract...');
  try {
    const chatDir = path.join(config.TMP_DIR, `chat_${msg.chat.id}_${Date.now()}`);
    fs.mkdirSync(chatDir, { recursive: true });
    const fp = await bot.downloadFile(doc.file_id, chatDir);
    const extractDir = path.join(chatDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    new AdmZip(fp).extractAllTo(extractDir, true);

    const found = editor.findIndexJs(extractDir);
    let indexJsPath = null;
    for (const p of found) {
      if (editor.findLetBugWa(fs.readFileSync(p, 'utf8'))) { indexJsPath = p; break; }
    }
    if (!indexJsPath) {
      s.step = 'await_zip';
      return send(msg.chat.id, '❌ `let bugWa` ga ketemu di index.js.');
    }

    s.step = 'await_func';
    s.workDir = chatDir;
    s.extractDir = extractDir;
    s.indexJsPath = indexJsPath;
    s.zipName = fname;

    send(msg.chat.id, [
      '✅ `let bugWa` ditemukan!',
      `📄 File: \`${path.relative(extractDir, indexJsPath)}\``,
      '',
      '📝 Kirim kode function baru.'
    ].join('\n'), backMenu());
  } catch (e) {
    s.step = 'await_zip';
    send(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ==== TEXT STATE MACHINE ====
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (!isAdmin(msg)) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const s = getSession(chatId);
  const text = msg.text;

  // ---- Await function code ----
  if (s.step === 'await_func') {
    let code = text;
    const m = code.match(/```(?:js|javascript)?\n([\s\S]*?)```/);
    if (m) code = m[1];

    const funcName = editor.extractFunctionName(code);
    if (!funcName) return send(chatId, '⚠️ Ga bisa baca nama function. Format: `async function namaFn(...)` atau `const namaFn = ...`.');

    const src = fs.readFileSync(s.indexJsPath, 'utf8');
    const updated = editor.insertFunctionBelowLetBugWa(src, code);
    if (!updated) return send(chatId, '❌ Gagal insert.');

    fs.writeFileSync(s.indexJsPath, updated, 'utf8');
    s.funcName = funcName;
    s.funcCode = code;
    s.step = 'select_case';

    const cases = editor.listCases(updated);
    if (!cases.length) return send(chatId, '⚠️ Ga ada case di `switch(bug)`.');

    // Bikin grid button case
    const buttons = [];
    for (let i = 0; i < cases.length; i += 2) {
      const row = [{ text: cases[i], callback_data: `case_${cases[i]}` }];
      if (cases[i + 1]) row.push({ text: cases[i + 1], callback_data: `case_${cases[i + 1]}` });
      buttons.push(row);
    }
    buttons.push([{ text: '⏭️ Skip (jangan pasang ke case)', callback_data: 'mode_skip' }]);

    return send(chatId, [
      `✅ Function \`${funcName}\` ditempel di bawah \`let bugWa\`.`,
      '',
      '🎯 Pilih case:'
    ].join('\n'), { reply_markup: { inline_keyboard: buttons } });
  }

  // ---- Await target for replace ----
  if (s.step === 'await_target') {
    const target = text.trim();
    const src = fs.readFileSync(s.indexJsPath, 'utf8');
    const res = editor.replaceCallInCase(src, s.caseName, target, s.funcName);
    if (!res.ok) return send(chatId, `❌ ${res.msg}`);
    fs.writeFileSync(s.indexJsPath, res.src, 'utf8');
    credit.deduct(userId);
    return finalize(chatId, s);
  }

  // ---- Auto-create function: nama ----
  if (s.step === 'create_name') {
    const name = text.trim().replace(/[^\w$]/g, '');
    if (!name) return send(chatId, '⚠️ Nama harus alfanumerik.');
    s.newFuncName = name;
    s.step = 'create_desc';
    return send(chatId, `📝 Nama: \`${name}\`\n\nKetik deskripsi singkat (buat TODO comment):`);
  }

  if (s.step === 'create_desc') {
    const desc = text.trim();
    const code = editor.generateFunctionScaffold(s.newFuncName, desc, { args: 'sock, targetJid' });
    s.step = 'idle';
    return send(chatId, [
      '✅ *Template Function*',
      '',
      '```js',
      code,
      '```',
      '',
      `Function \`${s.newFuncName}\` siap. Kirim ke flow edit kalau mau dipasang ke case.`
    ].join('\n'), backMenu());
  }

  send(chatId, '💤 /start buat menu.');
});

// ==== FINALIZE ====
async function finalize(chatId, s) {
  send(chatId, '📦 Repack zip...');
  try {
    const outZipPath = path.join(config.OUT_DIR, `${path.parse(s.zipName).name}_edited_${shortId()}.zip`);
    const zip = new AdmZip();
    zip.addLocalFolder(s.extractDir);
    zip.writeZip(outZipPath);

    await bot.sendDocument(chatId, outZipPath, {}, {
      filename: path.basename(outZipPath),
      contentType: 'application/zip'
    });
    send(chatId, '✅ Selesai! Zip diedit ada di atas.', backMenu());

    const u = db.getUser(s.userId || 0);
    s.step = 'idle';
    s.funcCode = s.funcName = s.caseName = null;
  } catch (e) {
    send(chatId, `❌ Gagal repack: ${e.message}`);
  }
}

// ==== ERROR HANDLER ====
bot.on('polling_error', (err) => console.error('[polling]', err.message));

// ==== STARTUP ====
(async () => {
  await deploy.startServer().catch(() => {});
  console.log('[Parker] Bot v2 live. 1010.');
})();