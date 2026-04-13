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
  if (page === 'clients') loadClients();
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

// ─── Clientes ────────────────────────────────────────────────────────────────

async function loadClients() {
  try {
    const clients = await apiFetch('/clients');
    const grid = el('clients-grid');
    if (!clients.length) {
      grid.innerHTML = '<p style="color:var(--muted)">Nenhum cliente cadastrado ainda.</p>';
      return;
    }
    grid.innerHTML = clients.map((c) => `
      <div class="client-card" onclick="openClientDetail(${c.id}, '${c.name.replace(/'/g, "\\'")}')" style="cursor:pointer">
        <div class="client-card-header">
          <strong>${c.name}</strong>
          <span class="wa-dot disconnected" id="dot-${c.id}" title="Verificando..."></span>
        </div>
        <div class="client-card-info">
          ${c.phone ? `<span>${c.phone}</span>` : ''}
          ${c.email ? `<span>${c.email}</span>` : ''}
          <span>${c._count?.leads || 0} leads</span>
        </div>
        <div class="client-card-actions" onclick="event.stopPropagation()">
          <button class="btn-sm btn-primary" onclick="openClientQR(${c.id}, '${c.name.replace(/'/g, "\\'")}')">WhatsApp</button>
          <button class="btn-sm btn-edit" onclick="openEditClient(${c.id})">Editar</button>
          <button class="btn-sm btn-del" onclick="deleteClient(${c.id})">Excluir</button>
        </div>
      </div>
    `).join('');

    // Carrega status de cada cliente em paralelo
    clients.forEach(async (c) => {
      try {
        const { status } = await apiFetch(`/clients/${c.id}/whatsapp`);
        const dot = el(`dot-${c.id}`);
        if (dot) dot.className = `wa-dot ${status === 'connected' ? 'connected' : 'disconnected'}`;
      } catch (_) {}
    });
  } catch (err) { console.error(err); }
}

async function openClientDetail(id, name) {
  el('client-detail-name').textContent = name;
  el('client-leads-tbody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Carregando...</td></tr>';
  hide('clients-list-view');
  show('client-detail-view');

  try {
    const leads = await apiFetch(`/clients/${id}/leads`);
    el('client-leads-tbody').innerHTML = leads.length
      ? leads.map((l) => `
        <tr style="cursor:pointer" onclick="openLeadChat(${l.id}, '${(l.name||'').replace(/'/g,"\\'")}', '${l.phone}')">
          <td>${l.name || '<em style="color:var(--muted)">sem nome</em>'}</td>
          <td>${l.phone}</td>
          <td>${statusBadge(l.status)}</td>
          <td>${l._count?.interactions || 0}</td>
          <td>${fmtDate(l.createdAt)}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">Nenhum lead ainda.</td></tr>';
  } catch (err) { console.error(err); }
}

el('btn-back-clients').addEventListener('click', () => {
  hide('client-detail-view');
  show('clients-list-view');
});

el('btn-back-lead').addEventListener('click', () => {
  hide('lead-chat-view');
  show('client-detail-view');
});

let currentChatLead = null;

async function openLeadChat(leadId, leadName, leadPhone) {
  currentChatLead = { id: leadId, phone: leadPhone };
  el('chat-lead-name').textContent = leadName || leadPhone;
  el('chat-lead-phone').textContent = leadPhone;
  el('chat-messages').innerHTML = '<p style="text-align:center;color:var(--muted)">Carregando...</p>';
  hide('client-detail-view');
  show('lead-chat-view');
  await loadChatMessages(leadId);
}

async function loadChatMessages(leadId) {
  try {
    const interactions = await apiFetch(`/interactions/leads/${leadId}/interactions`);
    const msgs = [...interactions].reverse();
    el('chat-messages').innerHTML = msgs.length
      ? msgs.map((m) => `
        <div class="chat-bubble ${m.direction === 'outbound' ? 'outbound' : 'inbound'}">
          <div class="bubble-content">${m.content}</div>
          <div class="bubble-meta">${fmtDate(m.createdAt)}${m.user ? ' · ' + m.user.name : ''}</div>
        </div>`).join('')
      : '<p style="text-align:center;color:var(--muted)">Nenhuma mensagem ainda.</p>';
    // scroll para o fim
    const box = el('chat-messages');
    box.scrollTop = box.scrollHeight;
  } catch (err) { console.error(err); }
}

el('chat-send-btn').addEventListener('click', sendChatMessage);
el('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

async function sendChatMessage() {
  const text = el('chat-input').value.trim();
  if (!text || !currentChatLead) return;
  el('chat-input').value = '';
  try {
    await apiFetch(`/interactions/leads/${currentChatLead.id}/interactions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'message', direction: 'outbound', content: text }),
    });
    // Envia via WhatsApp também
    try {
      await apiFetch('/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({ phone: currentChatLead.phone, message: text }),
      });
    } catch (_) {}
    await loadChatMessages(currentChatLead.id);
  } catch (err) { alert(err.message); }
}

el('new-client-btn').addEventListener('click', () => openClientModal());
el('client-modal-cancel').addEventListener('click', () => hide('client-modal'));
el('qr-modal-close').addEventListener('click', () => { clearInterval(qrPollTimer); hide('qr-modal'); });

function openClientModal(client = null) {
  el('client-modal-title').textContent = client ? 'Editar Cliente' : 'Novo Cliente';
  el('client-id').value = client?.id || '';
  el('client-name').value = client?.name || '';
  el('client-phone').value = client?.phone || '';
  el('client-email').value = client?.email || '';
  el('client-notes').value = client?.notes || '';
  show('client-modal');
}

el('client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = el('client-id').value;
  const body = {
    name: el('client-name').value,
    phone: el('client-phone').value,
    email: el('client-email').value,
    notes: el('client-notes').value,
  };
  try {
    if (id) {
      await apiFetch(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await apiFetch('/clients', { method: 'POST', body: JSON.stringify(body) });
    }
    hide('client-modal');
    loadClients();
  } catch (err) { alert(err.message); }
});

async function openEditClient(id) {
  try {
    const client = await apiFetch(`/clients/${id}`);
    openClientModal(client);
  } catch (err) { alert(err.message); }
}

async function deleteClient(id) {
  if (!confirm('Excluir este cliente e todas as instâncias WhatsApp?')) return;
  try {
    await apiFetch(`/clients/${id}`, { method: 'DELETE' });
    loadClients();
  } catch (err) { alert(err.message); }
}

let qrPollTimer = null;

async function openClientQR(id, name) {
  el('qr-modal-title').textContent = `WhatsApp — ${name}`;
  el('qr-modal-status').textContent = 'Verificando conexão...';
  el('qr-modal-img-wrap').innerHTML = '';
  show('qr-modal');

  clearInterval(qrPollTimer);
  let ticks = 0;

  async function checkQR() {
    ticks++;
    try {
      const { status, qrCode } = await apiFetch(`/clients/${id}/whatsapp`);
      const labels = { connected: 'Conectado', connecting: 'Conectando...', disconnected: 'Desconectado' };
      el('qr-modal-status').textContent = `Status: ${labels[status] || status}`;

      if (status === 'connected') {
        el('qr-modal-img-wrap').innerHTML = '<p style="color:#22c55e;font-size:1.2rem">✓ Conectado!</p>';
        clearInterval(qrPollTimer);
        loadClients();
      } else if (qrCode) {
        el('qr-modal-img-wrap').innerHTML = `<img src="${qrCode}" style="width:220px;border-radius:8px" alt="QR Code"/>`;
      } else {
        el('qr-modal-img-wrap').innerHTML = '<p style="color:var(--muted)">Aguardando QR Code...</p>';
      }

      if (ticks >= 40) clearInterval(qrPollTimer);
    } catch (_) {}
  }

  await checkQR();
  qrPollTimer = setInterval(checkQR, 2000);
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
    hide('qr-loading');
    show('qr-container');
  } else if (status === 'connecting') {
    hide('qr-container');
    show('qr-loading');
  } else {
    hide('qr-container');
    hide('qr-loading');
  }

  if (status === 'connected') { hide('btn-connect'); show('btn-disconnect'); }
  else { show('btn-connect'); hide('btn-disconnect'); }
}

let fastPollTimer = null;

function startFastPoll() {
  if (fastPollTimer) return;
  let ticks = 0;
  fastPollTimer = setInterval(async () => {
    ticks++;
    try {
      const data = await apiFetch('/whatsapp/status');
      if (data) applyWAStatus(data);
      if (data?.qrCode || data?.status === 'connected' || ticks >= 20) {
        clearInterval(fastPollTimer);
        fastPollTimer = null;
      }
    } catch {
      clearInterval(fastPollTimer);
      fastPollTimer = null;
    }
  }, 1500);
}

el('btn-connect').addEventListener('click', async () => {
  try {
    await apiFetch('/whatsapp/connect', { method: 'POST' });
    loadWAStatus();
    startFastPoll();
  } catch (err) { alert(err.message); }
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
