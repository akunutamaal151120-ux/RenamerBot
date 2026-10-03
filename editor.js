const fs = require('fs');
const path = require('path');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findIndexJs(dir) {
  const results = [];
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name === 'index.js') results.push(full);
    }
  }
  walk(dir);
  return results;
}

function findBlockEnd(src, openBraceIdx) {
  let depth = 0, inString = false, stringChar = '';
  let inLineComment = false, inBlockComment = false;
  let inTemplate = false, templateDepth = 0;

  for (let i = openBraceIdx; i < src.length; i++) {
    const c = src[i], next = src[i + 1];

    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inString) { if (c === '\\') { i++; continue; } if (c === stringChar) inString = false; continue; }
    if (inTemplate) {
      if (c === '\\') { i++; continue; }
      if (c === '`' && templateDepth === 0) { inTemplate = false; continue; }
      if (c === '$' && next === '{') { templateDepth++; i++; continue; }
      if (c === '}' && templateDepth > 0) { templateDepth--; continue; }
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'") { inString = true; stringChar = c; continue; }
    if (c === '`') { inTemplate = true; continue; }

    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function findLetBugWa(src) {
  const re = /^([ \t]*)let\s+bugWa\b.*$/m;
  const m = src.match(re);
  if (!m) return null;
  return { index: m.index, lineEnd: m.index + m[0].length, indent: m[1], line: m[0] };
}

function insertFunctionBelowLetBugWa(src, funcCode) {
  const info = findLetBugWa(src);
  if (!info) return null;
  const nlIdx = src.indexOf('\n', info.lineEnd);
  if (nlIdx === -1) return src + '\n\n' + funcCode.trim() + '\n';

  const before = src.slice(0, nlIdx + 1);
  const after = src.slice(nlIdx + 1);
  return before + '\n' + funcCode.trim() + '\n\n' + after;
}

function extractFunctionName(code) {
  const patterns = [
    /async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\(|\([^)]*\)\s*=>)/,
    /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\(|\([^)]*\)\s*=>)/,
    /([A-Za-z_$][\w$]*)\s*=\s*async\s*\(/
  ];
  for (const re of patterns) {
    const m = code.match(re);
    if (m) return m[1];
  }
  return null;
}

function findSwitchBugBlock(src) {
  const re = /switch\s*\(\s*bug\s*\)\s*\{/;
  const m = src.match(re);
  if (!m) return null;
  const openBrace = src.indexOf('{', m.index);
  const end = findBlockEnd(src, openBrace);
  if (end === -1) return null;
  return { start: m.index, openBrace, end };
}

function findCaseBlock(src, caseName) {
  const sw = findSwitchBugBlock(src);
  if (!sw) return null;
  const region = src.slice(sw.openBrace, sw.end + 1);
  const caseRe = new RegExp(`case\\s+["']${escapeRegex(caseName)}["']\\s*:`);
  const cm = region.match(caseRe);
  if (!cm) return null;
  const bodyStart = sw.openBrace + cm.index + cm[0].length;
  const rest = region.slice(cm.index + cm[0].length);
  const nextCase = rest.match(/case\s+["'][^"']+["']\s*:|case\s+[\w$]+\s*:|default\s*:/);
  const bodyEnd = nextCase ? bodyStart + nextCase.index : sw.end;
  return { bodyStart, bodyEnd };
}

function listCases(src) {
  const sw = findSwitchBugBlock(src);
  if (!sw) return [];
  const region = src.slice(sw.openBrace, sw.end + 1);
  const re = /case\s+["']([^"']+)["']\s*:/g;
  const names = [];
  let m;
  while ((m = re.exec(region)) !== null) names.push(m[1]);
  return names;
}

// ==== DETEKSI INDENT DARI AWAIT SEBELUMNYA (FIX) ====
function detectAwaitIndent(body, insertPos) {
  // Lihat baris-baris await di atas posisi insert, ambil indent yang paling sering
  const lines = body.slice(0, insertPos).split('\n').reverse();
  const indents = {};
  for (const ln of lines) {
    const m = ln.match(/^(\s*)await\s/);
    if (m) {
      const key = m[1];
      indents[key] = (indents[key] || 0) + 1;
    }
  }
  const entries = Object.entries(indents).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : '        ';
}

function replaceCallInCase(src, caseName, oldFunc, newFunc) {
  const cb = findCaseBlock(src, caseName);
  if (!cb) return { ok: false, msg: `Case "${caseName}" ga ketemu.` };

  const body = src.slice(cb.bodyStart, cb.bodyEnd);
  const re = new RegExp(`(\\s*)await\\s+${escapeRegex(oldFunc)}\\s*\\(([^)]*)\\)\\s*;`, 'g');
  let replaced = 0;
  const newBody = body.replace(re, (full, ws, args) => {
    replaced++;
    // Ganti nama fungsi doang, spasi/indent tetap sama
    return `${ws}await ${newFunc}(${args});`;
  });

  if (!replaced) return { ok: false, msg: `Panggilan await ${oldFunc}(...) ga ada di case "${caseName}".` };

  return { ok: true, src: src.slice(0, cb.bodyStart) + newBody + src.slice(cb.bodyEnd), replaced };
}

function addCallInCase(src, caseName, newFunc, args = 'sock, targetJid') {
  const cb = findCaseBlock(src, caseName);
  if (!cb) return { ok: false, msg: `Case "${caseName}" ga ketemu.` };

  const body = src.slice(cb.bodyStart, cb.bodyEnd);
  const sleepRe = /await\s+sleep\s*\([^)]*\)\s*;/;
  const sleepMatch = body.match(sleepRe);

  let insertPos, indent;

  if (sleepMatch) {
    insertPos = sleepMatch.index;
    indent = detectAwaitIndent(body, insertPos);
  } else {
    const awaitRe = /await\s+\w+\s*\([^)]*\)\s*;/g;
    let lastMatch = null, m;
    while ((m = awaitRe.exec(body)) !== null) lastMatch = m;
    if (!lastMatch) return { ok: false, msg: `Ga ada await apapun di case "${caseName}".` };
    insertPos = lastMatch.index + lastMatch[0].length;
    indent = detectAwaitIndent(body, insertPos);
  }

  const insertText = insertPos === sleepMatch?.index
    ? `${indent}await ${newFunc}(${args});\n`
    : `\n${indent}await ${newFunc}(${args});`;

  const newBody = body.slice(0, insertPos) + insertText + body.slice(insertPos);
  return { ok: true, src: src.slice(0, cb.bodyStart) + newBody + src.slice(cb.bodyEnd) };
}

// ==== AUTO-CREATE FUNCTION (SCAFFOLD) ====
// Generate template function dari deskripsi singkat
function generateFunctionScaffold(name, description, opts = {}) {
  const args = opts.args || 'sock, targetJid';
  const argList = args.split(',').map(s => s.trim());
  const [sockVar, targetVar] = argList;

  const desc = (description || '').trim();
  const descLines = desc ? [`  // TODO: ${desc}`] : [];

  return `async function ${name}(${args}) {
  try {
    if (!${sockVar} || !${targetVar}) return;
${descLines.join('\n')}
    // ==== AUTO-GENERATED TEMPLATE ====
    // Modif bagian ini sesuai kebutuhan:
    //
    // await ${sockVar}.sendMessage(${targetVar}, { text: "hello" });
    // await ${sockVar}.relayMessage(${targetVar}, msg, {});
    // await ${sockVar}.presenceSubscribe(${targetVar});
    // await ${sockVar}.sendPresenceUpdate('composing', ${targetVar});
    // await ${sockVar}.groupParticipantsUpdate(${targetVar}, [${targetVar}], 'add');
    //
    // =================================
  } catch (e) {
    console.error('[${name}]', e.message);
  }
}`;
}

module.exports = {
  findIndexJs, findBlockEnd,
  findLetBugWa, insertFunctionBelowLetBugWa,
  extractFunctionName,
  findSwitchBugBlock, findCaseBlock, listCases,
  replaceCallInCase, addCallInCase,
  generateFunctionScaffold
};