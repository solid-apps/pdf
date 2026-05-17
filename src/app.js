// PDF · Solid — minimal pod-backed PDF reader.
// Lists .pdf resources in an LDP container and renders the selected one
// with PDF.js. Auth via xlogin (window.xlogin.authFetch). No build step.

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const listEl  = $('list');
const bcEl    = $('bc');
const canvas  = $('canvas');
const ctx     = canvas.getContext('2d');
const prevBtn = $('prev');
const nextBtn = $('next');
const pageEl  = $('page');
const zoomIn  = $('zoomIn');
const zoomOut = $('zoomOut');
const zoomEl  = $('zoom');
const titleEl = $('title');

let currentDir = null;
let currentDoc = null;
let currentPdfUrl = null;
let pageNum = 1;
let scale = 1.0;

function authFetch(url, opts) {
  return (window.xlogin && window.xlogin.authFetch)
    ? window.xlogin.authFetch(url, opts)
    : fetch(url, opts);
}

async function discoverStorage() {
  const xl = window.xlogin;
  if (!xl || xl.type !== 'solid' || !xl.id) return null;
  try {
    const webid = xl.id;
    const r = await authFetch(webid.replace(/#.*$/, ''), { headers: { Accept: 'application/ld+json' } });
    if (!r.ok) return null;
    const doc = await r.json();
    const nodes = Array.isArray(doc['@graph']) ? doc['@graph'] : [doc];
    const subj = nodes.find(n => n['@id'] === webid) || nodes[0] || {};
    let storage = idOf(subj['pim:storage'] ?? subj['http://www.w3.org/ns/pim/space#storage'] ?? subj['storage']);
    if (!storage) storage = new URL(webid).origin + '/';
    if (!storage.endsWith('/')) storage += '/';
    if (!/^https?:/.test(storage)) storage = new URL(storage, webid).href;
    // Skip a shadowed root that returns HTML (e.g. jspod's index.html).
    return (await looksLikeRdfContainer(storage)) ? storage : storage + 'public/';
  } catch { return null; }
}

async function looksLikeRdfContainer(url) {
  try {
    const r = await authFetch(url, { headers: { Accept: 'application/ld+json' } });
    if (!r.ok) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('json') || ct.includes('turtle')) return true;
    const body = (await r.text()).trim();
    return body.startsWith('{') || body.startsWith('[');
  } catch { return false; }
}

async function loadContainer(url) {
  currentDir = url;
  drawBreadcrumb();
  listEl.innerHTML = `<li class="placeholder">Loading…</li>`;
  let doc;
  try {
    const r = await authFetch(url, { headers: { Accept: 'application/ld+json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    doc = await r.json();
  } catch (e) {
    listEl.innerHTML = `<li class="placeholder">Couldn't list: ${escape(e.message)}</li>`;
    return;
  }
  const items = parseContainer(doc, url);
  const pdfs = items.filter(i => i.type === 'resource' && /\.pdf$/i.test(i.url));
  const dirs = items.filter(i => i.type === 'container');
  if (!pdfs.length && !dirs.length) {
    listEl.innerHTML = `<li class="empty">No PDFs or subfolders here.</li>`;
    return;
  }
  const rows = [
    ...dirs.map(d => `<li data-url="${escape(d.url)}" data-type="container"><span class="icon">📁</span>${escape(nameOf(d.url))}/</li>`),
    ...pdfs.map(p => `<li data-url="${escape(p.url)}" data-type="pdf"><span class="icon">📕</span>${escape(nameOf(p.url))}</li>`)
  ].join('');
  listEl.innerHTML = rows;
  for (const li of listEl.querySelectorAll('[data-url]')) {
    li.addEventListener('click', () => {
      if (li.dataset.type === 'container') loadContainer(li.dataset.url);
      else openPdf(li.dataset.url, li);
    });
  }
}

async function openPdf(url, li) {
  for (const x of listEl.querySelectorAll('.active')) x.classList.remove('active');
  li?.classList.add('active');
  titleEl.textContent = nameOf(url);
  currentPdfUrl = url;
  try {
    const r = await authFetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ab = await r.arrayBuffer();
    currentDoc = await pdfjsLib.getDocument({ data: ab }).promise;
    pageNum = 1;
    scale = await fitPageScale(currentDoc);
    [prevBtn, nextBtn, zoomIn, zoomOut].forEach(b => b.disabled = false);
    renderPage();
  } catch (e) {
    titleEl.textContent = 'Error: ' + e.message;
    currentDoc = null;
  }
}

// Default scale: fit the first page entirely inside the viewer pane
// (both dimensions, no scrolling). Most PDF readers default to this.
async function fitPageScale(doc) {
  const page = await doc.getPage(1);
  const native = page.getViewport({ scale: 1 });
  const wrap = canvas.parentElement;
  // .canvas-wrap has 20px padding on every side; account for it.
  const w = Math.max(wrap.clientWidth - 40, 200);
  const h = Math.max(wrap.clientHeight - 40, 200);
  return Math.min(w / native.width, h / native.height);
}

async function renderPage() {
  if (!currentDoc) return;
  const page = await currentDoc.getPage(pageNum);
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = (viewport.width / dpr) + 'px';
  canvas.style.height = (viewport.height / dpr) + 'px';
  await page.render({ canvasContext: ctx, viewport }).promise;
  pageEl.textContent = `${pageNum} / ${currentDoc.numPages}`;
  zoomEl.textContent = Math.round(scale * 100) + '%';
  prevBtn.disabled = pageNum <= 1;
  nextBtn.disabled = pageNum >= currentDoc.numPages;
}

prevBtn.addEventListener('click', () => { if (pageNum > 1) { pageNum--; renderPage(); } });
nextBtn.addEventListener('click', () => { if (currentDoc && pageNum < currentDoc.numPages) { pageNum++; renderPage(); } });
zoomIn.addEventListener('click', () => { scale = Math.min(scale * 1.25, 4); renderPage(); });
zoomOut.addEventListener('click', () => { scale = Math.max(scale / 1.25, 0.25); renderPage(); });

document.addEventListener('keydown', (e) => {
  if (!currentDoc) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') nextBtn.click();
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevBtn.click();
});

function drawBreadcrumb() {
  if (!currentDir) { bcEl.textContent = ''; return; }
  try {
    const u = new URL(currentDir);
    const parts = u.pathname.split('/').filter(Boolean);
    let acc = u.origin + '/';
    const crumbs = [`<a data-path="${escape(acc)}">${escape(u.host)}</a>`];
    parts.forEach((p, i) => {
      acc += p + '/';
      crumbs.push(`<span class="sep">/</span>` + (i === parts.length - 1
        ? `<span>${escape(decodeURIComponent(p))}</span>`
        : `<a data-path="${escape(acc)}">${escape(decodeURIComponent(p))}</a>`));
    });
    bcEl.innerHTML = crumbs.join('');
    for (const a of bcEl.querySelectorAll('[data-path]')) {
      a.style.cursor = 'pointer';
      a.addEventListener('click', () => loadContainer(a.dataset.path));
    }
  } catch {
    bcEl.textContent = currentDir;
  }
}

// ---- helpers ----

function parseContainer(doc, baseUrl) {
  const nodes = Array.isArray(doc?.['@graph']) ? doc['@graph'] : [doc];
  const container = nodes.find(n =>
    n['@id'] === baseUrl ||
    (typeof n['@id'] === 'string' && resolveUrl(n['@id'], baseUrl) === baseUrl)
  ) || nodes[0];
  if (!container) return [];
  const raw = container['contains']
    ?? container['ldp:contains']
    ?? container['http://www.w3.org/ns/ldp#contains']
    ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(c => {
    if (typeof c === 'string') return { url: resolveUrl(c, baseUrl), type: c.endsWith('/') ? 'container' : 'resource' };
    const url = resolveUrl(c['@id'], baseUrl);
    const types = [].concat(c['@type'] || []);
    const isC = types.some(t => /(?:#|\/)(?:BasicContainer|Container)$/.test(t)) || url.endsWith('/');
    return { url, type: isC ? 'container' : 'resource' };
  }).filter(x => x.url && x.url !== baseUrl);
}
function nameOf(url) {
  return decodeURIComponent(url.replace(/\/$/, '').split('/').pop() || url);
}
function idOf(v) { if (!v) return null; if (typeof v === 'string') return v; if (typeof v === 'object' && v['@id']) return v['@id']; return null; }
function resolveUrl(href, base) { try { return new URL(href, base).href; } catch { return href; } }
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---- bootstrap ----

async function start() {
  const storage = await discoverStorage();
  if (storage) loadContainer(storage);
  else listEl.innerHTML = `<li class="placeholder">Sign in (top-right button) to browse your pod.</li>`;
}

// xlogin restores its session asynchronously and fires `xlogin` /
// `xlogout` CustomEvents on `document`. Run start() once now (in case
// the session is already restored), then again whenever auth changes.
document.addEventListener('xlogin', start);
document.addEventListener('xlogout', start);
start();
