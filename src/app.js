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
const fitBtn  = $('fit');
const fsBtn   = $('fullscreen');
const titleEl = $('title');
const viewer  = document.querySelector('.viewer');

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
    pageNum = await loadResumePage(url, currentDoc.numPages);
    scale = await fitPageScale(currentDoc);
    [prevBtn, nextBtn, zoomIn, zoomOut, fitBtn, fsBtn].forEach(b => b.disabled = false);
    renderPage();
  } catch (e) {
    titleEl.textContent = 'Error: ' + e.message;
    currentDoc = null;
  }
}

// Per-PDF resume: sibling `<pdfUrl>.state.jsonld` stores the last page.
// Owner-write, public-read by inheritance from /public/.acl; no ACL
// management needed.
async function loadResumePage(pdfUrl, numPages) {
  try {
    const r = await authFetch(perPdfStateUrl(pdfUrl), { cache: 'no-store' });
    if (!r.ok) return 1;
    const s = await r.json();
    const p = s['schema:additionalProperty']?.page;
    if (typeof p === 'number') return Math.max(1, Math.min(p, numPages));
  } catch {}
  return 1;
}

function perPdfStateUrl(pdfUrl) {
  return pdfUrl + '.state.jsonld';
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
  pushState();
}

// ---- Solid remote control: shared state on /public/pdf/state.jsonld ----
// The viewer writes {pdfUrl, page} on every page change and subscribes
// to the same doc via the legacy WebSocket protocol. Anything else that
// PUTs the doc (the bundled CLI, a phone, curl) drives this viewer.

const STATE_URL = `${window.location.origin}/public/pdf/state.jsonld`;
const STATE_ACL = STATE_URL + '.acl';
let pushTimer = null;
let lastPushed = null;

// Self-healing seed: probe doc + ACL on every call and PUT whichever
// is missing. No sticky cache — page load may run this before xlogin
// restored its session, in which case the PUTs 401 silently; the next
// `pushState()` retries with auth ready. Also recovers if state.jsonld
// or its ACL is deleted at runtime. Two HEADs per call is cheap and
// gated by pushState's 120ms debounce.
async function ensureStateDoc() {
  // Seed the doc if missing.
  let docOk = false;
  try {
    const r = await authFetch(STATE_URL, { method: 'HEAD' });
    docOk = r.ok;
  } catch {}
  if (!docOk) {
    try {
      const r = await authFetch(STATE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/ld+json' },
        body: JSON.stringify({
          '@context': { 'schema': 'https://schema.org/' },
          '@id': '#state',
          '@type': 'schema:ReadAction',
          'schema:object': null,
          'schema:additionalProperty': { page: 1 },
          'schema:dateModified': new Date().toISOString()
        })
      });
      if (!r.ok) console.warn(`state doc PUT failed: HTTP ${r.status}`);
    } catch (e) { console.warn('Could not seed state doc:', e.message); }
  }

  // Seed the ACL if missing. JSS rejects Turtle for ACL writes — must
  // be application/ld+json.
  let aclOk = false;
  try {
    const r = await authFetch(STATE_ACL, { method: 'HEAD' });
    aclOk = r.ok;
  } catch {}
  if (!aclOk) {
    try {
      const r = await authFetch(STATE_ACL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/ld+json' },
        body: JSON.stringify({
          '@context': {
            'acl': 'http://www.w3.org/ns/auth/acl#',
            'foaf': 'http://xmlns.com/foaf/0.1/'
          },
          '@graph': [
            {
              '@id': '#owner',
              '@type': 'acl:Authorization',
              'acl:agent': { '@id': '/profile/card.jsonld#me' },
              'acl:accessTo': { '@id': 'state.jsonld' },
              'acl:mode': [{ '@id': 'acl:Read' }, { '@id': 'acl:Write' }, { '@id': 'acl:Control' }]
            },
            {
              '@id': '#public',
              '@type': 'acl:Authorization',
              'acl:agentClass': { '@id': 'foaf:Agent' },
              'acl:accessTo': { '@id': 'state.jsonld' },
              'acl:mode': [{ '@id': 'acl:Read' }, { '@id': 'acl:Write' }]
            }
          ]
        })
      });
      if (!r.ok) console.warn(`state ACL PUT failed: HTTP ${r.status}`);
    } catch (e) { console.warn('Could not seed state ACL:', e.message); }
  }
}

function pushState() {
  if (!currentPdfUrl) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    // Dedupe on content (ignore timestamp) — prevents echo loop when
    // receiving our own WS update and re-rendering.
    const key = `${currentPdfUrl}#${pageNum}`;
    if (key === lastPushed) return;
    lastPushed = key;
    await ensureStateDoc();
    const body = JSON.stringify({
      '@context': { 'schema': 'https://schema.org/' },
      '@id': '#state',
      '@type': 'schema:ReadAction',
      'schema:object': currentPdfUrl,
      'schema:additionalProperty': { page: pageNum },
      'schema:dateModified': new Date().toISOString()
    });
    try {
      await authFetch(STATE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/ld+json' },
        body
      });
    } catch (e) { /* best-effort; CLI/peer still works on next change */ }
    // Resume info: per-PDF doc, owner-auth, public-read inherited.
    try {
      await authFetch(perPdfStateUrl(currentPdfUrl), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/ld+json' },
        body
      });
    } catch (e) { /* best-effort */ }
  }, 120);
}

async function subscribeState() {
  await ensureStateDoc();
  let r;
  try { r = await fetch(STATE_URL); } catch { return; }
  const wsUrl = r.headers.get('updates-via');
  if (!wsUrl) { console.warn('No updates-via header — remote control offline'); return; }

  let backoff = 500;
  const connect = () => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => { backoff = 500; ws.send(`sub ${STATE_URL}`); };
    ws.onmessage = async (e) => {
      if (typeof e.data !== 'string' || !e.data.startsWith('pub ')) return;
      try {
        const sr = await fetch(STATE_URL, { cache: 'no-store' });
        if (!sr.ok) return;
        const s = await sr.json();
        const newPage = s['schema:additionalProperty']?.page;
        if (typeof newPage === 'number' && newPage !== pageNum && currentDoc) {
          pageNum = Math.max(1, Math.min(newPage, currentDoc.numPages));
          renderPage();
        }
      } catch { /* ignore parse blips */ }
    };
    ws.onclose = () => setTimeout(connect, backoff = Math.min(backoff * 2, 10000));
    ws.onerror = () => ws.close();
  };
  connect();
}

subscribeState();

prevBtn.addEventListener('click', () => { if (pageNum > 1) { pageNum--; renderPage(); } });
nextBtn.addEventListener('click', () => { if (currentDoc && pageNum < currentDoc.numPages) { pageNum++; renderPage(); } });
zoomIn.addEventListener('click', () => { scale = Math.min(scale * 1.25, 4); renderPage(); });
zoomOut.addEventListener('click', () => { scale = Math.max(scale / 1.25, 0.25); renderPage(); });
fitBtn.addEventListener('click', async () => {
  if (!currentDoc) return;
  scale = await fitPageScale(currentDoc);
  renderPage();
});
fsBtn.addEventListener('click', toggleFullscreen);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else viewer.requestFullscreen?.();
}

// Refit after fullscreen enter/exit (or any resize) so the page tracks
// the new pane dimensions.
document.addEventListener('fullscreenchange', refit);
window.addEventListener('resize', refit);
let refitTimer = null;
async function refit() {
  if (!currentDoc) return;
  // Debounce: rapid resizes during transitions
  clearTimeout(refitTimer);
  refitTimer = setTimeout(async () => {
    scale = await fitPageScale(currentDoc);
    renderPage();
  }, 80);
}

document.addEventListener('keydown', (e) => {
  if (!currentDoc) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') nextBtn.click();
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevBtn.click();
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
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
