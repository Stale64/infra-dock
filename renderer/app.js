'use strict';

const api = window.infraDock;

const state = {
  services: [],
  filter: 'all',
  query: '',
  brewAvailable: true,
  busy: new Set(), // formula names currently performing an action
  modal: null, // { formula, path, readOnly }
};

const els = {
  grid: document.getElementById('grid'),
  filters: document.getElementById('filters'),
  summary: document.getElementById('summary'),
  search: document.getElementById('search'),
  empty: document.getElementById('empty'),
  banner: document.getElementById('banner'),
  sysinfo: document.getElementById('sysinfo'),
  refreshBtn: document.getElementById('refreshBtn'),
  toasts: document.getElementById('toasts'),
  // modal
  backdrop: document.getElementById('modalBackdrop'),
  modalTitle: document.getElementById('modalTitle'),
  modalPath: document.getElementById('modalPath'),
  editor: document.getElementById('editor'),
  modalStatus: document.getElementById('modalStatus'),
  saveBtn: document.getElementById('saveBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  modalClose: document.getElementById('modalClose'),
  revealBtn: document.getElementById('revealBtn'),
  openExternalBtn: document.getElementById('openExternalBtn'),
};

// ---- Helpers ------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(title, msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="toast-title">${esc(title)}</div>${
    msg ? `<div class="toast-msg">${esc(msg)}</div>` : ''
  }`;
  els.toasts.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' ? 6500 : 3500);
}

function statusMeta(svc) {
  if (!svc.installed) return { cls: 'status-notinstalled', label: 'Not installed' };
  switch (svc.status) {
    case 'started':
      return { cls: 'status-running', label: 'Running' };
    case 'error':
      return { cls: 'status-error', label: 'Error' };
    case 'scheduled':
      return { cls: 'status-running', label: 'Scheduled' };
    default:
      return { cls: 'status-stopped', label: 'Stopped' };
  }
}

// ---- Rendering ----------------------------------------------------------

function categories() {
  const cats = new Map();
  for (const s of state.services) {
    cats.set(s.category, (cats.get(s.category) || 0) + 1);
  }
  return [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderFilters() {
  const running = state.services.filter((s) => s.running).length;
  const installed = state.services.filter((s) => s.installed).length;
  const groups = [
    { id: 'all', label: 'All servers', count: state.services.length },
    { id: 'running', label: 'Running', count: running },
    { id: 'installed', label: 'Installed', count: installed },
  ];

  let html = '<div style="font-size:11px;color:var(--text-faint);padding:6px 12px 4px;letter-spacing:.4px;">OVERVIEW</div>';
  for (const g of groups) {
    html += filterRow(g.id, g.label, g.count);
  }
  html += '<div style="font-size:11px;color:var(--text-faint);padding:14px 12px 4px;letter-spacing:.4px;">CATEGORIES</div>';
  for (const [cat, count] of categories()) {
    html += filterRow(`cat:${cat}`, cat, count);
  }
  els.filters.innerHTML = html;

  els.filters.querySelectorAll('.filter').forEach((node) => {
    node.addEventListener('click', () => {
      state.filter = node.dataset.id;
      renderFilters();
      renderGrid();
    });
  });
}

function filterRow(id, label, count) {
  const active = state.filter === id ? ' active' : '';
  return `<div class="filter${active}" data-id="${esc(id)}">
    <span>${esc(label)}</span>
    <span class="count">${count}</span>
  </div>`;
}

function matchesFilter(s) {
  const f = state.filter;
  if (f === 'all') return true;
  if (f === 'running') return s.running;
  if (f === 'installed') return s.installed;
  if (f.startsWith('cat:')) return s.category === f.slice(4);
  return true;
}

function matchesQuery(s) {
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return (
    s.name.toLowerCase().includes(q) ||
    s.formula.toLowerCase().includes(q) ||
    s.category.toLowerCase().includes(q)
  );
}

function renderGrid() {
  const list = state.services.filter((s) => matchesFilter(s) && matchesQuery(s));

  const running = state.services.filter((s) => s.running).length;
  els.summary.textContent = state.brewAvailable
    ? `${state.services.length} servers · ${running} running`
    : 'Homebrew not detected';

  if (!list.length) {
    els.grid.innerHTML = '';
    els.empty.classList.remove('hidden');
    return;
  }
  els.empty.classList.add('hidden');

  els.grid.innerHTML = list.map(cardHTML).join('');
  list.forEach((s) => wireCard(s));
}

function cardHTML(s) {
  const st = statusMeta(s);
  const busy = state.busy.has(s.formula);
  const portRow = s.port ? `<span>Port <span class="mono">${s.port}</span></span>` : '';
  const formulaRow = `<span>Formula <span class="mono">${esc(s.formula)}</span></span>`;

  let actions = '';
  if (!s.installed) {
    actions = `<button class="primary-btn" data-act="install">${busy ? '<span class="spinner"></span> Installing…' : 'Install'}</button>`;
  } else if (s.running) {
    actions = `
      <button class="danger-btn" data-act="stop" ${busy ? 'disabled' : ''}>Stop</button>
      <button class="ghost-btn" data-act="restart" ${busy ? 'disabled' : ''}>Restart</button>`;
  } else {
    actions = `<button class="primary-btn" data-act="start" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : 'Start'}</button>`;
  }

  const configBtn = s.installed && s.configPath
    ? `<button class="ghost-btn" data-act="config">Configure</button>` : '';
  const logsBtn = s.installed && s.logsPath
    ? `<button class="ghost-btn" data-act="logs">Logs</button>` : '';

  return `
  <article class="card ${busy ? 'busy' : ''}" data-formula="${esc(s.formula)}">
    <div class="card-top">
      <div class="card-icon">${esc(s.icon)}</div>
      <div class="card-headings">
        <div class="card-title">${esc(s.name)}</div>
        <div class="card-cat">${esc(s.category)}</div>
      </div>
      <span class="status-pill ${st.cls}"><span class="dot"></span>${esc(st.label)}</span>
    </div>
    <div class="card-desc">${esc(s.description)}</div>
    <div class="card-meta">${portRow}${formulaRow}</div>
    <div class="card-actions">
      ${actions}
      <span class="spacer"></span>
      ${configBtn}
      ${logsBtn}
    </div>
  </article>`;
}

function wireCard(s) {
  const card = els.grid.querySelector(`.card[data-formula="${cssEscape(s.formula)}"]`);
  if (!card) return;
  card.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(s, btn.dataset.act));
  });
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// ---- Actions ------------------------------------------------------------

async function handleAction(s, act) {
  switch (act) {
    case 'start':
    case 'stop':
    case 'restart':
      return control(s, act);
    case 'install':
      return install(s);
    case 'config':
      return openConfig(s);
    case 'logs':
      return openLogs(s);
  }
}

async function control(s, action) {
  state.busy.add(s.formula);
  renderGrid();
  const res = await api.control(action, s.formula);
  state.busy.delete(s.formula);

  if (res.ok) {
    const verb = { start: 'started', stop: 'stopped', restart: 'restarted' }[action];
    toast(`${s.name} ${verb}`, res.data.output || '', 'success');
  } else {
    toast(`Failed to ${action} ${s.name}`, res.detail || res.error, 'error');
  }
  await refresh();
}

async function install(s) {
  toast(`Installing ${s.name}…`, 'This may take a few minutes. Watch progress here.');
  state.busy.add(s.formula);
  renderGrid();
  const res = await api.install(s.formula, s.tap);
  state.busy.delete(s.formula);

  if (res.ok) {
    toast(`${s.name} installed`, 'You can now start it.', 'success');
  } else {
    toast(`Failed to install ${s.name}`, res.detail || res.error, 'error');
  }
  await refresh();
}

// ---- Config / Logs modal -----------------------------------------------

async function openConfig(s) {
  const res = await api.readConfig(s.configPath);
  if (!res.ok) {
    toast(`Cannot open config for ${s.name}`, res.detail || res.error, 'error');
    return;
  }
  showModal({
    title: `${s.name} — Configuration`,
    path: res.data.path,
    content: res.data.content,
    readOnly: res.data.readOnly || res.data.isDirectory,
  });
}

async function openLogs(s) {
  const res = await api.readLogs(s.logsPath);
  if (!res.ok) {
    toast(`Cannot open logs for ${s.name}`, res.detail || res.error, 'error');
    return;
  }
  showModal({
    title: `${s.name} — Logs`,
    path: res.data.path,
    content: res.data.content,
    readOnly: true,
  });
}

function showModal({ title, path, content, readOnly }) {
  state.modal = { path, readOnly };
  els.modalTitle.textContent = title;
  els.modalPath.textContent = path;
  els.editor.value = content;
  els.editor.readOnly = !!readOnly;
  els.saveBtn.classList.toggle('hidden', !!readOnly);
  els.modalStatus.textContent = readOnly ? 'Read-only' : '';
  els.backdrop.classList.remove('hidden');
}

function closeModal() {
  els.backdrop.classList.add('hidden');
  state.modal = null;
}

async function saveModal() {
  if (!state.modal || state.modal.readOnly) return;
  els.modalStatus.textContent = 'Saving…';
  const res = await api.writeConfig(state.modal.path, els.editor.value);
  if (res.ok) {
    els.modalStatus.textContent = 'Saved · a .infradock-bak backup was created';
    toast('Configuration saved', 'Restart the server to apply changes.', 'success');
  } else {
    els.modalStatus.textContent = '';
    toast('Save failed', res.detail || res.error, 'error');
  }
}

// ---- Data ---------------------------------------------------------------

async function refresh() {
  els.refreshBtn.disabled = true;
  const res = await api.listServices();
  els.refreshBtn.disabled = false;

  if (!res.ok) {
    els.banner.classList.remove('hidden');
    els.banner.textContent = `Could not load services: ${res.detail || res.error}`;
    return;
  }
  state.services = res.data.services;
  state.brewAvailable = res.data.brewAvailable;

  els.banner.classList.toggle('hidden', state.brewAvailable);
  if (!state.brewAvailable) {
    els.banner.innerHTML =
      'Homebrew was not found. Infra Dock manages servers through Homebrew — install it from <span class="mono">https://brew.sh</span> and reopen.';
  }

  renderFilters();
  renderGrid();
}

async function loadSystemInfo() {
  const res = await api.systemInfo();
  if (!res.ok) return;
  const i = res.data;
  els.sysinfo.innerHTML = [
    i.brewVersion ? esc(i.brewVersion) : 'Homebrew: not found',
    i.brewPrefix ? `Prefix: <span class="mono">${esc(i.brewPrefix)}</span>` : '',
    `${esc(i.platform)} · ${esc(i.arch)}`,
  ]
    .filter(Boolean)
    .join('<br>');
}

// ---- Events -------------------------------------------------------------

els.refreshBtn.addEventListener('click', refresh);
els.search.addEventListener('input', (e) => {
  state.query = e.target.value;
  renderGrid();
});
els.cancelBtn.addEventListener('click', closeModal);
els.modalClose.addEventListener('click', closeModal);
els.saveBtn.addEventListener('click', saveModal);
els.revealBtn.addEventListener('click', () => state.modal && api.reveal(state.modal.path));
els.openExternalBtn.addEventListener('click', () => state.modal && api.openPath(state.modal.path));
els.backdrop.addEventListener('click', (e) => {
  if (e.target === els.backdrop) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
    e.preventDefault();
    refresh();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && state.modal) {
    e.preventDefault();
    saveModal();
  }
});

// ---- Boot ---------------------------------------------------------------

refresh();
loadSystemInfo();
