const API = '/api';
let token = localStorage.getItem('token');
let currentPage = 1;
let waStatusInterval = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options,
  });
  if (res.status === 401) { logout(); return; }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Erro na requisição'); }
  if (res.status === 204) return null;
  return res.json();
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function el(id) { return document.getElementById(id); }

function statusBadge(status) {
  const labels = { new: 'Novo', contacted: 'Contactado', qualified: 'Qualificado', converted: 'Convertido', lost: 'Perdido' };
  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
}

function stageLabel(stage) {
  return { awareness: 'Consciência', interest: 'Interesse', decision: 'Decisão', action: 'Ação' }[stage] || stage;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function logout() {
  localStorage.removeItem('token');
  token = null;
  clearInterval(waStatusInterval);
  hide('app-screen');
  show('login-screen');
}

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('login-error').classList.add('hidden');
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: el('email').value, password: el('password').value }),
    });
    token = data.token;
    localStorage.setItem('token', token);
    el('user-name').textContent = data.user.name;
    hide('login-screen');
    show('app-screen');
    navigateTo('dashboard');
    startWAStatusPolling();
  } catch (err) {
    el('login-error').textContent = err.message;
    el('login-error').classList.remove('hidden');
  }
});

el('logout-btn').addEventListener('click', logout);

// ─── Navigation ───────────────────────────────────────────────────────────────

function navigateTo(page) {
  document.querySelectorAll('.page').forEach((p) => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.remove('active'));
  show(`page-${page}`);
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'leads') loadLeads(1);
  if (page === 'whatsapp') loadWAStatus();
}

document.querySelectorAll('.nav-item').forEach((a) => {
  a.addEventListener('click', (e) => { e.preventDefault(); navigateTo(a.dataset.page); });
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const data = await apiFetch('/dashboard/stats');
    el('stat-total').textContent = data.totalLeads;
    el('stat-today').textContent = data.newLeadsToday;
    el('stat-converted').textContent = data.byStatus.converted || 0;
    el('stat-whatsapp').textContent = data.bySource.whatsapp || 0;

    el('recent-interactions').innerHTML = data.recentInteractions.map((i) => `
      <div class="interaction-item">
        <span class="interaction-badge badge-${i.type}">${i.type}</span>
        <div class="interaction-content">
          <strong>${i.lead?.name || i.lead?.phone || '—'}</strong> — ${i.content}
          <div class="interaction-meta">${fmtDate(i.createdAt)}${i.user ? ` · ${i.user.name}` : ''}</div>
        </div>
      </div>
    `).join('') || '<p style="color:var(--muted)">Nenhuma interação ainda.</p>';
  } catch (err) {
    console.error(err);
  }
}

// ─── Leads ────────────────────────────────────────────────────────────────────

async function loadLeads(page = 1) {
  currentPage = page;
  const search = el('search-input').value;
  const status = el('filter-status').value;
  const params = new URLSearchParams({ page, limit: 20, ...(search && { search }), ...(status && { status }) });

  try {
    const data = await apiFetch(`/leads?${params}`);
    el('leads-tbody').innerHTML = data.leads.map((l) => `
      <tr>
        <td>${l.name || '<em style="color:var(--muted)">sem nome</em>'}</td>
        <td>${l.phone}</td>
        <td>${statusBadge(l.status)}</td>
        <td>${stageLabel(l.stage)}</td>
        <td>${l.source || '—'}</td>
        <td>${fmtDate(l.createdAt)}</td>
        <td style="display:flex;gap:.4rem;">
          <button class="btn-sm btn-edit" onclick="openEditModal(${l.id})">Editar</button>
          <button class="btn-sm btn-del" onclick="deleteLead(${l.id})">Excluir</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:2rem">Nenhum lead encontrado.</td></tr>';

    renderPagination(data.pages, page);
  } catch (err) {
    console.error(err);
  }
}

function renderPagination(pages, current) {
  el('pagination').innerHTML = Array.from({ length: pages }, (_, i) => i + 1)
    .map((p) => `<button class="${p === current ? 'active' : ''}" onclick="loadLeads(${p})">${p}</button>`)
    .join('');
}

el('search-input').addEventListener('input', () => loadLeads(1));
el('filter-status').addEventListener('change', () => loadLeads(1));

// ─── Lead Modal ───────────────────────────────────────────────────────────────

el('new-lead-btn').addEventListener('click', () => openModal());
el('modal-cancel').addEventListener('click', closeModal);

function openModal(lead = null) {
  el('modal-title').textContent = lead ? 'Editar Lead' : 'Novo Lead';
  el('lead-id').value = lead?.id || '';
  el('lead-name').value = lead?.name || '';
  el('lead-phone').value = lead?.phone || '';
  el('lead-email').value = lead?.email || '';
  el('lead-status').value = lead?.status || 'new';
  el('lead-stage').value = lead?.stage || 'awareness';
  el('lead-notes').value = lead?.notes || '';
  show('lead-modal');
}

function closeModal() { hide('lead-modal'); }

el('lead-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = el('lead-id').value;
  const body = {
    name: el('lead-name').value,
    phone: el('lead-phone').value,
    email: el('lead-email').value,
    status: el('lead-status').value,
    stage: el('lead-stage').value,
    notes: el('lead-notes').value,
  };
  try {
    if (id) {
      await apiFetch(`/leads/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await apiFetch('/leads', { method: 'POST', body: JSON.stringify(body) });
    }
    closeModal();
    loadLeads(currentPage);
  } catch (err) {
    alert(err.message);
  }
});

async function openEditModal(id) {
  try {
    const lead = await apiFetch(`/leads/${id}`);
    openModal(lead);
  } catch (err) { alert(err.message); }
}

async function deleteLead(id) {
  if (!confirm('Excluir este lead?')) return;
  try {
    await apiFetch(`/leads/${id}`, { method: 'DELETE' });
    loadLeads(currentPage);
  } catch (err) { alert(err.message); }
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

async function loadWAStatus() {
  try {
    const data = await apiFetch('/whatsapp/status');
    applyWAStatus(data);
  } catch (err) { console.error(err); }
}

function applyWAStatus({ status, qrCode }) {
  const labels = { connected: 'Conectado', connecting: 'Conectando...', disconnected: 'Desconectado' };
  el('wa-status-text').textContent = labels[status] || status;

  const dot = el('wa-indicator');
  dot.className = `wa-dot ${status === 'connected' ? 'connected' : 'disconnected'}`;

  if (qrCode) {
    el('qr-image').src = qrCode;
    show('qr-container');
  } else {
    hide('qr-container');
  }

  if (status === 'connected') { hide('btn-connect'); show('btn-disconnect'); }
  else { show('btn-connect'); hide('btn-disconnect'); }
}

el('btn-connect').addEventListener('click', async () => {
  try { await apiFetch('/whatsapp/connect', { method: 'POST' }); loadWAStatus(); }
  catch (err) { alert(err.message); }
});

el('btn-disconnect').addEventListener('click', async () => {
  try { await apiFetch('/whatsapp/disconnect', { method: 'POST' }); loadWAStatus(); }
  catch (err) { alert(err.message); }
});

function startWAStatusPolling() {
  clearInterval(waStatusInterval);
  waStatusInterval = setInterval(async () => {
    try {
      const data = await apiFetch('/whatsapp/status');
      applyWAStatus(data);
    } catch {}
  }, 5000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

if (token) {
  apiFetch('/auth/me').then((user) => {
    if (!user) return;
    el('user-name').textContent = user.name;
    hide('login-screen');
    show('app-screen');
    navigateTo('dashboard');
    startWAStatusPolling();
  }).catch(logout);
}
