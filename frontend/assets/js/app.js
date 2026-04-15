const API = '/api';
let token = localStorage.getItem('token');
let currentUser = null;
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
  const labels = { new: 'Novo', contacted: 'Contactado', qualified: 'Qualificado', converted: 'Convertido', lost: 'Perdido', disqualified: 'Desclassificado' };
  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
}

function stageLabel(stage) {
  return { awareness: 'Consciência', interest: 'Interesse', decision: 'Decisão', action: 'Ação' }[stage] || stage;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function applyUserRole(role) {
  if (role === 'admin') {
    document.querySelectorAll('.nav-admin').forEach(el => el.classList.remove('hidden'));
  } else {
    document.querySelectorAll('.nav-admin').forEach(el => el.classList.add('hidden'));
  }
}

function logout() {
  localStorage.removeItem('token');
  token = null;
  currentUser = null;
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
    currentUser = data.user;
    localStorage.setItem('token', token);
    el('user-name').textContent = data.user.name;
    applyUserRole(data.user.role);
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

  if (page === 'dashboard') { loadDashboard(); loadFunnel(); }
  if (page === 'leads') { loadClientFilter(); loadLeads(1); }
  if (page === 'clients') loadClients();
  if (page === 'whatsapp') loadWAStatus();
  if (page === 'users') loadUsers();
  if (page === 'meta-stats') loadMetaStats();
  if (page === 'conversions') loadConversions();
  if (page === 'conversations') loadConversations();
}

document.querySelectorAll('.nav-item').forEach((a) => {
  a.addEventListener('click', (e) => { e.preventDefault(); navigateTo(a.dataset.page); });
});

// ─── Funil + Leads Parados ────────────────────────────────────────────────────

async function loadFunnel(days) {
  const d = days || el('stuck-days-select')?.value || 3;
  try {
    const data = await apiFetch(`/dashboard/funnel?days=${d}`);

    // Funil visual
    const maxCount = Math.max(...data.funnel.map(f => f.count), 1);
    el('funnel-wrap').innerHTML = data.funnel.map((f, i) => {
      const pct = Math.max((f.count / maxCount) * 100, 8);
      return `
        <div class="funnel-step">
          <div class="funnel-bar" style="width:${pct}%">
            <span class="funnel-label">${f.label}</span>
            <span class="funnel-count">${f.count}</span>
          </div>
          ${f.dropRate !== null ? `<span class="funnel-drop">▼ ${f.dropRate}% saíram</span>` : ''}
        </div>`;
    }).join('');

    el('funnel-meta').innerHTML = `
      <span>⏱ Tempo médio de conversão: <strong>${data.avgConversionDays ? data.avgConversionDays + ' dias' : '—'}</strong></span>
      <span>✅ Convertidos: <strong>${data.byStatus.converted || 0}</strong></span>
      <span>❌ Perdidos: <strong>${data.byStatus.lost || 0}</strong></span>
    `;

    // Leads parados
    el('stuck-leads-list').innerHTML = data.stuckLeads.length
      ? data.stuckLeads.map(l => {
          const lastContact = l.interactions[0]?.createdAt
            ? fmtDate(l.interactions[0].createdAt)
            : 'Nunca';
          const statusLabels = { new: 'Novo', contacted: 'Contactado', qualified: 'Qualificado' };
          return `
            <div class="stuck-lead-item">
              <div class="stuck-lead-info">
                <strong>${l.name || l.phone}</strong>
                ${l.client ? `<span class="stuck-client">${l.client.name}</span>` : ''}
              </div>
              <div class="stuck-lead-meta">
                <span class="status-badge status-${l.status}">${statusLabels[l.status] || l.status}</span>
                <span style="color:var(--muted);font-size:.82rem">Último contato: ${lastContact}</span>
              </div>
              <button class="btn-sm btn-edit" onclick="openEditModal(${l.id})">Ver lead</button>
            </div>`;
        }).join('')
      : `<p style="color:var(--muted);padding:1rem 0">Nenhum lead parado há mais de ${d} dias. 🎉</p>`;

  } catch (err) { console.error(err); }
}

el('stuck-days-select')?.addEventListener('change', () => loadFunnel());

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
          <div class="interaction-meta">
            ${fmtDate(i.createdAt)}${i.user ? ` · ${i.user.name}` : ''}
            ${i.lead?.client ? `<span class="client-tag" style="margin-left:6px">${i.lead.client.name}</span>` : ''}
          </div>
        </div>
      </div>
    `).join('') || '<p style="color:var(--muted)">Nenhuma interação ainda.</p>';
  } catch (err) {
    console.error(err);
  }
}

// ─── Leads ────────────────────────────────────────────────────────────────────

async function loadClientFilter() {
  try {
    const clients = await apiFetch('/clients');
    const select = el('filter-client');
    const current = select.value;
    select.innerHTML = '<option value="">Todos os clientes</option>' +
      clients.map(c => `<option value="${c.id}" ${c.id == current ? 'selected' : ''}>${c.name}</option>`).join('');
  } catch (_) {}
}

async function loadLeads(page = 1) {
  currentPage = page;
  const search = el('search-input').value;
  const status = el('filter-status').value;
  const clientId = el('filter-client').value;
  const params = new URLSearchParams({ page, limit: 20, ...(search && { search }), ...(status && { status }), ...(clientId && { clientId }) });

  try {
    const data = await apiFetch(`/leads?${params}`);
    el('leads-tbody').innerHTML = data.leads.map((l) => `
      <tr>
        <td>${l.name || '<em style="color:var(--muted)">sem nome</em>'}</td>
        <td>${l.phone}</td>
        <td>${statusBadge(l.status)}</td>
        <td>${stageLabel(l.stage)}</td>
        <td>${l.source || '—'}</td>
        <td>${l.client ? `<span class="client-tag">${l.client.name}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
        <td>${fmtDate(l.createdAt)}</td>
        <td style="display:flex;gap:.4rem;">
          <button class="btn-sm btn-edit" onclick="openEditModal(${l.id})">Editar</button>
          <button class="btn-sm btn-del" onclick="deleteLead(${l.id})">Excluir</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:2rem">Nenhum lead encontrado.</td></tr>';

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
el('filter-client').addEventListener('change', () => loadLeads(1));

// ─── Lead Modal ───────────────────────────────────────────────────────────────

el('new-lead-btn').addEventListener('click', () => openModal());

el('export-leads-btn').addEventListener('click', async () => {
  const status = el('filter-status').value;
  const params = new URLSearchParams({ ...(status && { status }) });
  try {
    const res = await fetch(`/api/dashboard/export-leads?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) { alert('Erro ao exportar: ' + err.message); }
});
el('modal-cancel').addEventListener('click', closeModal);

function openModal(lead = null) {
  el('modal-title').textContent = lead ? 'Editar Lead' : 'Novo Lead';
  el('lead-id').value = lead?.id || '';
  el('lead-name').value = lead?.name || '';
  el('lead-phone').value = lead?.phone || '';
  el('lead-email').value = lead?.email || '';
  el('lead-status').value = lead?.status || 'new';
  el('lead-stage').value = lead?.stage || 'awareness';
  el('lead-value').value = lead?.value ?? '';
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
    value: el('lead-value').value,
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
          ${c.metaPhoneNumberId ? '<span class="meta-badge">Meta</span>' : ''}
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
el('client-ai-enabled').addEventListener('change', function() {
  el('client-ai-fields').style.display = this.checked ? 'block' : 'none';
  el('client-ai-enabled-label').textContent = this.checked ? 'IA ativada ✅' : 'IA desativada';
});
el('qr-modal-close').addEventListener('click', () => { clearInterval(qrPollTimer); hide('qr-modal'); });

function openClientModal(client = null) {
  el('client-modal-title').textContent = client ? 'Editar Cliente' : 'Novo Cliente';
  el('client-id').value = client?.id || '';
  el('client-name').value = client?.name || '';
  el('client-phone').value = client?.phone || '';
  el('client-email').value = client?.email || '';
  el('client-notes').value = client?.notes || '';
  el('client-meta-phone-id').value = client?.metaPhoneNumberId || '';
  el('client-mp-token').value = client?.mpAccessToken || '';
  const mpUrl = client?.id
    ? `https://rastreamento-leads-production.up.railway.app/api/mp/webhook/${client.id}`
    : 'Salve o cliente para ver a URL';
  el('client-mp-webhook-url').textContent = mpUrl;
  // Campos IA
  const aiEnabled = Boolean(client?.aiEnabled);
  el('client-ai-enabled').checked = aiEnabled;
  el('client-ai-enabled-label').textContent = aiEnabled ? 'IA ativada ✅' : 'IA desativada';
  el('client-ai-fields').style.display = aiEnabled ? 'block' : 'none';
  el('client-payment-link').value = client?.paymentLink || '';
  el('client-ai-script').value = client?.aiScript || '';
  // Campos Pixel
  el('client-website').value = client?.website || '';
  el('client-pixel-id').value = client?.pixelId || '';
  el('client-meta-conversions-token').value = client?.metaConversionsToken || '';
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
    metaPhoneNumberId: el('client-meta-phone-id').value || null,
    mpAccessToken: el('client-mp-token').value || null,
    aiEnabled: el('client-ai-enabled').checked,
    aiScript: el('client-ai-script').value || null,
    paymentLink: el('client-payment-link').value || null,
    website: el('client-website').value || null,
    pixelId: el('client-pixel-id').value || null,
    metaConversionsToken: el('client-meta-conversions-token').value || null,
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
      // Primeira chamada usa o endpoint de conexão, demais usam status
      const endpoint = ticks === 1 ? `/clients/${id}/whatsapp/connect` : `/clients/${id}/whatsapp`;
      const method = ticks === 1 ? 'POST' : 'GET';
      const { status, qrCode } = await apiFetch(endpoint, { method });
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

// ─── Filtro de cliente reutilizável ───────────────────────────────────────────

let activeClientFilters = {}; // { barId: clientId }

async function renderClientFilterBar(barId, onSelect) {
  try {
    const clients = await apiFetch('/clients');
    const bar = el(barId);
    if (!bar) return;
    bar.innerHTML =
      `<button class="page-client-btn active" data-cid="" onclick="selectClientFilter('${barId}',this,'')"  >Todos</button>` +
      clients.map(c => `<button class="page-client-btn" data-cid="${c.id}" onclick="selectClientFilter('${barId}',this,'${c.id}')">${c.name}</button>`).join('');
    activeClientFilters[barId] = '';
    bar._onSelect = onSelect;
  } catch (_) {}
}

function selectClientFilter(barId, btn, clientId) {
  const bar = el(barId);
  bar.querySelectorAll('.page-client-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeClientFilters[barId] = clientId;
  if (bar._onSelect) bar._onSelect(clientId);
}

// ─── Conversões ───────────────────────────────────────────────────────────────

let convData = null;
let activeConvTab = 'monthly';

function fmtBRL(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function loadConversions(clientId = '') {
  // Inicializa barra só na primeira vez
  if (!el('conv-client-filter')?._onSelect) {
    renderClientFilterBar('conv-client-filter', (cid) => loadConversions(cid));
  }
  try {
    const qs = clientId ? `?clientId=${clientId}` : '';
    convData = await apiFetch(`/dashboard/conversion-values${qs}`);

    // Cards resumo
    const s = convData.summary;
    el('conv-today-val').textContent  = s.today.formatted;
    el('conv-today-count').textContent  = `${s.today.count} conversão(ões)`;
    el('conv-week-val').textContent   = s.week.formatted;
    el('conv-week-count').textContent   = `${s.week.count} conversão(ões)`;
    el('conv-month-val').textContent  = s.month.formatted;
    el('conv-month-count').textContent  = `${s.month.count} conversão(ões)`;
    el('conv-alltime-val').textContent = s.allTime.formatted;
    el('conv-alltime-count').textContent = `${s.allTime.count} total`;

    renderConvTab(activeConvTab);
  } catch (err) { console.error(err); }
}

function renderConvTab(tab) {
  activeConvTab = tab;
  document.querySelectorAll('.conv-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  const rows = tab === 'daily' ? convData.daily
             : tab === 'weekly' ? convData.weekly
             : convData.monthly;

  const labelKey = tab === 'daily' ? 'date' : tab === 'weekly' ? 'week' : 'month';
  el('conv-col-period').textContent = tab === 'daily' ? 'Dia' : tab === 'weekly' ? 'Semana' : 'Mês';

  // Gráfico de barras
  const maxVal = Math.max(...rows.map(r => r.value), 1);
  el('conv-bar-chart').innerHTML = rows.map(r => `
    <div class="bar-item">
      <div class="bar-fill bar-fill-blue" style="height:${Math.max((r.value / maxVal) * 100, r.value > 0 ? 4 : 0)}%">
        ${r.value > 0 ? `<span class="bar-value" style="font-size:.6rem">${r.count}</span>` : ''}
      </div>
      <div class="bar-label">${r[labelKey]}</div>
    </div>
  `).join('');

  // Tabela
  el('conv-tbody').innerHTML = rows.map(r => {
    const ticket = r.count > 0 ? fmtBRL(r.value / r.count) : '—';
    return `<tr>
      <td>${r[labelKey]}</td>
      <td><strong>${r.count}</strong></td>
      <td style="color:#22c55e;font-weight:700">${fmtBRL(r.value)}</td>
      <td>${ticket}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:2rem">Nenhuma conversão com valor registrado ainda.</td></tr>';
}

document.querySelectorAll('.conv-tab').forEach(b => {
  b.addEventListener('click', () => { if (convData) renderConvTab(b.dataset.tab); });
});

// ─── Meta Stats ───────────────────────────────────────────────────────────────

async function loadMetaStats(clientId = '') {
  // Inicializa barra só na primeira vez
  if (!el('meta-client-filter')?._onSelect) {
    renderClientFilterBar('meta-client-filter', (cid) => loadMetaStats(cid));
  }
  try {
    const qs = clientId ? `?clientId=${clientId}` : '';
    const [data, spendRows] = await Promise.all([
      apiFetch(`/dashboard/meta-stats${qs}`),
      apiFetch('/meta/spend'),
    ]);
    // Monta mapa de gastos por adKey
    const spendMap = {};
    spendRows.forEach(r => { spendMap[r.adKey] = (spendMap[r.adKey] || 0) + Number(r.amount); });

    // Cards de resumo
    el('meta-stat-total').textContent = data.total;
    el('meta-stat-converted').textContent = data.converted;
    el('meta-stat-rate').textContent = data.conversionRate + '%';
    el('meta-stat-new').textContent = data.byStatus.new || 0;

    // Gráfico de barras últimos 7 dias
    const maxDay = Math.max(...data.byDay.map(d => d.count), 1);
    el('meta-bar-chart').innerHTML = data.byDay.map(d => `
      <div class="bar-item">
        <div class="bar-fill" style="height:${Math.max((d.count / maxDay) * 100, 2)}%">
          <span class="bar-value">${d.count}</span>
        </div>
        <div class="bar-label">${d.date}</div>
      </div>
    `).join('');

    // Tabela de origens
    const sourceLabels = {
      whatsapp_meta: '📱 Meta Ads (Click-to-WhatsApp)',
      whatsapp: '📱 WhatsApp QR Code',
      manual: '✍️ Manual',
      null: '❓ Desconhecido',
    };
    const total = Object.values(data.allSources).reduce((a, b) => a + b, 0) || 1;
    el('meta-sources-table').innerHTML = `
      <div class="sources-grid">
        ${Object.entries(data.allSources).map(([src, count]) => `
          <div class="source-item">
            <div class="source-label">${sourceLabels[src] || src}</div>
            <div class="source-bar-wrap">
              <div class="source-bar-fill" style="width:${(count / total * 100).toFixed(0)}%"></div>
            </div>
            <div class="source-count"><strong>${count}</strong> <span style="color:var(--muted);font-size:.8rem">(${(count/total*100).toFixed(0)}%)</span></div>
          </div>
        `).join('')}
      </div>
    `;

    // Tabela por anúncio
    el('meta-ads-tbody').innerHTML = data.byAd.length
      ? data.byAd.map(ad => {
          const spent   = spendMap[ad.name] || 0;
          const revenue = ad.revenue || 0;
          const roi     = spent > 0 ? ((revenue - spent) / spent * 100).toFixed(0) : null;
          const roiClass = roi === null ? '' : roi >= 100 ? 'rate-good' : roi >= 0 ? 'rate-mid' : 'rate-low';
          return `
          <tr>
            <td>
              <strong>${ad.name}</strong>
              ${ad.adId ? `<div style="font-size:.75rem;color:var(--muted)">ID: ${ad.adId}</div>` : ''}
            </td>
            <td>
              ${ad.clients && ad.clients.length
                ? ad.clients.map(c => `<span class="client-tag">${c}</span>`).join(' ')
                : '<span style="color:var(--muted);font-size:.8rem">—</span>'}
            </td>
            <td><strong>${ad.total}</strong></td>
            <td>${ad.new}</td>
            <td>${ad.qualified}</td>
            <td style="color:#22c55e"><strong>${ad.converted}</strong></td>
            <td style="color:#e74c3c">${ad.lost}</td>
            <td>
              <span class="conv-rate ${parseFloat(ad.conversionRate) >= 10 ? 'rate-good' : parseFloat(ad.conversionRate) >= 5 ? 'rate-mid' : 'rate-low'}">
                ${ad.conversionRate}%
              </span>
            </td>
            <td>
              <input class="spend-input" type="number" min="0" step="0.01" placeholder="0,00"
                value="${spent > 0 ? spent : ''}"
                onblur="saveAdSpend('${ad.name.replace(/'/g,"\\'")}', this.value)"
                style="width:90px;padding:.3rem .5rem;border:1px solid var(--border);border-radius:6px;font-size:.85rem" />
            </td>
            <td style="color:#22c55e;font-weight:600">${revenue > 0 ? fmtBRL(revenue) : '—'}</td>
            <td>${roi !== null ? `<span class="conv-rate ${roiClass}">${roi}%</span>` : '<span style="color:var(--muted)">—</span>'}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:2rem">Nenhum lead do Meta ainda. Configure os anúncios Click-to-WhatsApp.</td></tr>';

  } catch (err) { console.error(err); }
}

// ─── Conversas ────────────────────────────────────────────────────────────────

let convPollTimer = null;
let convActiveLeadId = null;
let convActiveClientId = '';

async function loadConversations() {
  try {
    // Carrega clientes para a barra
    const clients = await apiFetch('/clients');
    const bar = el('conv-client-bar');
    bar.innerHTML = `<button class="conv-client-btn active" data-client-id="" onclick="selectConvClient('', this)">Todos</button>` +
      clients.map(c => `<button class="conv-client-btn" data-client-id="${c.id}" onclick="selectConvClient('${c.id}', this)">${c.name}</button>`).join('');

    await loadConvAds();
  } catch (err) { console.error(err); }
}

async function selectConvClient(clientId, btn) {
  document.querySelectorAll('.conv-client-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  convActiveClientId = clientId;
  el('conv-ads-items').innerHTML = '<p class="conv-empty">Carregando...</p>';
  el('conv-leads-list').innerHTML = '<p class="conv-empty">← Selecione uma pasta</p>';
  el('conv-messages').innerHTML = '<p class="conv-empty" style="margin-top:3rem">← Selecione um lead</p>';
  el('conv-leads-header').textContent = 'Selecione uma pasta';
  el('conv-chat-header').textContent = 'Conversa';
  el('conv-chat-info').classList.add('hidden');
  convActiveLeadId = null;
  await loadConvAds();
}

async function loadConvAds() {
  try {
    const qs = convActiveClientId ? `?clientId=${convActiveClientId}` : '';
    const groups = await apiFetch(`/conversations/ads${qs}`);
    const container = el('conv-ads-items');
    if (!groups.length) {
      container.innerHTML = '<p class="conv-empty">Nenhuma conversa ainda.</p>';
      return;
    }
    const sourceIcon = (src) => src === 'whatsapp_meta' ? '📢' : src === 'manual' ? '✍️' : '📱';
    container.innerHTML = groups.map(g => `
      <div class="conv-ad-item" onclick="selectConvAd('${encodeURIComponent(g.key)}', this, '${g.key.replace(/'/g, "\\'")}')">
        <div class="conv-ad-title">${sourceIcon(g.source)} ${g.key}</div>
        <div class="conv-ad-meta">${g.total} leads · ${g.converted} convertidos</div>
      </div>
    `).join('');
  } catch (err) { console.error(err); }
}

function isMobile() { return window.innerWidth <= 768; }

function convMobileShow(panel) {
  // panel: 'ads' | 'leads' | 'chat'
  const ads = el('conv-ads-list');
  const leads = el('conv-leads-col');
  const chat = el('conv-chat-col');
  ads.classList.remove('mob-hidden'); leads.classList.remove('mob-active'); chat.classList.remove('mob-active');
  if (panel === 'leads') { ads.classList.add('mob-hidden'); leads.classList.add('mob-active'); }
  if (panel === 'chat')  { ads.classList.add('mob-hidden'); chat.classList.add('mob-active'); }
}

function convMobileBack(to) {
  if (!isMobile()) return;
  if (to === 'ads')   convMobileShow('ads');
  if (to === 'leads') convMobileShow('leads');
}

async function selectConvAd(encodedKey, el_clicked, label) {
  document.querySelectorAll('.conv-ad-item').forEach(i => i.classList.remove('active'));
  el_clicked.classList.add('active');
  el('conv-leads-header-text').textContent = label;
  el('conv-leads-list').innerHTML = '<p class="conv-empty">Carregando...</p>';
  el('conv-messages').innerHTML = '<p class="conv-empty" style="margin-top:3rem">← Selecione um lead</p>';
  el('conv-chat-header-text').textContent = 'Conversa';
  el('conv-chat-info').classList.add('hidden');
  convActiveLeadId = null;
  if (isMobile()) convMobileShow('leads');

  try {
    const clientParam = convActiveClientId ? `&clientId=${convActiveClientId}` : '';
    const leads = await apiFetch(`/conversations/leads?adKey=${encodedKey}${clientParam}`);
    if (!leads.length) {
      el('conv-leads-list').innerHTML = '<p class="conv-empty">Nenhum lead nesta pasta.</p>';
      return;
    }
    el('conv-leads-list').innerHTML = leads.map(l => {
      const lastMsg = l.interactions?.[0];
      const preview = lastMsg ? lastMsg.content.replace('[mídia]', '📷 Mídia') : 'Sem mensagens';
      const time = lastMsg ? fmtDate(lastMsg.createdAt) : fmtDate(l.createdAt);
      return `
        <div class="conv-lead-item" onclick="selectConvLead(${l.id}, this)">
          <div class="conv-lead-name">${l.name || l.phone}</div>
          <div class="conv-lead-preview">${preview}</div>
          <div class="conv-lead-meta">
            ${statusBadge(l.status)}
            ${l.client ? `<span class="client-tag">${l.client.name}</span>` : ''}
            <span>${time}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) { console.error(err); }
}

async function selectConvLead(id, el_clicked) {
  document.querySelectorAll('.conv-lead-item').forEach(i => i.classList.remove('active'));
  el_clicked.classList.add('active');
  convActiveLeadId = id;
  el('conv-messages').innerHTML = '<p class="conv-empty" style="margin-top:3rem">Carregando...</p>';
  if (isMobile()) convMobileShow('chat');

  if (convPollTimer) clearInterval(convPollTimer);
  await renderConvChat(id);
  convPollTimer = setInterval(() => { if (convActiveLeadId === id) renderConvChat(id); }, 5000);
}

async function renderConvChat(id) {
  try {
    const lead = await apiFetch(`/conversations/lead/${id}`);

    // Info do lead
    el('conv-chat-header-text').textContent = lead.name || lead.phone;
    const info = el('conv-chat-info');
    info.classList.remove('hidden');
    info.innerHTML = `
      <div class="conv-chat-info-item">📞 <strong>${lead.phone}</strong></div>
      ${lead.client ? `<div class="conv-chat-info-item">🏢 <strong>${lead.client.name}</strong></div>` : ''}
      <div class="conv-chat-info-item">${statusBadge(lead.status)}</div>
      ${lead.assignedTo ? `<div class="conv-chat-info-item">👤 <strong>${lead.assignedTo.name}</strong></div>` : ''}
      <div class="conv-chat-info-item" style="margin-left:auto">
        <button class="btn-sm btn-primary" onclick="navigateTo('leads');setTimeout(()=>openLeadModal(${lead.id}),300)">Editar Lead</button>
      </div>
    `;

    // Mensagens
    if (!lead.interactions.length) {
      el('conv-messages').innerHTML = '<p class="conv-empty" style="margin-top:3rem;text-align:center">Nenhuma mensagem ainda.</p>';
      return;
    }

    el('conv-messages').innerHTML = lead.interactions.map(i => {
      const dir = i.direction === 'outbound' ? 'outbound' : i.type === 'note' ? 'system' : 'inbound';
      let content = i.content;
      const time = new Date(i.createdAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      const isConversion = content.includes('Comprovante de pagamento recebido') || content.includes('Pagamento aprovado');

      // Detecta comprovante de pagamento
      const isReceipt = content.toLowerCase().includes('comprovante') && i.direction === 'inbound';
      const isImage = !isReceipt && (content === '[mídia]' || content === '[imagem]' || content.includes('[imagem]'));

      let bubble = '';
      if (isReceipt) {
        bubble = `
          <a href="/comprovante-teste.html" target="_blank" class="conv-receipt-card">
            <div class="conv-receipt-preview">
              <div class="conv-receipt-icon">🧾</div>
              <div class="conv-receipt-info">
                <div class="conv-receipt-title">Comprovante de Pagamento</div>
                <div class="conv-receipt-sub">PIX • R$ 150,00 • Toque para ver</div>
              </div>
            </div>
          </a>`;
      } else if (content === '[mídia]' || content === '[imagem]') {
        bubble = '📷 Mídia recebida';
      } else {
        bubble = content;
      }

      return `
        <div class="conv-msg ${dir} ${isConversion ? 'conv-msg-converted' : ''}">
          ${dir === 'system' ? `<em>${content}</em>` : `
            ${dir === 'outbound' ? '<div class="conv-msg-sender">Agente IA</div>' : ''}
            ${bubble}
          `}
          <div class="conv-msg-time">${time}</div>
        </div>
      `;
    }).join('');

    // Rola para o final
    const msgs = el('conv-messages');
    msgs.scrollTop = msgs.scrollHeight;
  } catch (err) { console.error(err); }
}

async function saveAdSpend(adKey, value) {
  try {
    const clientId = activeClientFilters['meta-client-filter'] || null;
    await apiFetch('/meta/spend', {
      method: 'PUT',
      body: JSON.stringify({ adKey, clientId: clientId || null, amount: parseFloat(value) || 0 }),
    });
  } catch (err) { console.error('Erro ao salvar investimento:', err); }
}

// ─── Perfil ───────────────────────────────────────────────────────────────────

el('profile-btn').addEventListener('click', () => {
  el('profile-name').value = currentUser?.name || '';
  el('profile-email').value = currentUser?.email || '';
  el('profile-new-password').value = '';
  el('profile-current-password').value = '';
  el('profile-error').classList.add('hidden');
  el('profile-success').classList.add('hidden');
  show('profile-modal');
});

el('profile-modal-cancel').addEventListener('click', () => hide('profile-modal'));

el('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('profile-error').classList.add('hidden');
  el('profile-success').classList.add('hidden');

  const body = {
    name: el('profile-name').value,
    email: el('profile-email').value,
    currentPassword: el('profile-current-password').value,
  };
  const newPwd = el('profile-new-password').value;
  if (newPwd) body.password = newPwd;

  try {
    const updated = await apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify(body) });
    currentUser = { ...currentUser, ...updated };
    el('user-name').textContent = updated.name;
    el('profile-success').textContent = 'Perfil atualizado com sucesso!';
    el('profile-success').classList.remove('hidden');
    el('profile-current-password').value = '';
    el('profile-new-password').value = '';
  } catch (err) {
    el('profile-error').textContent = err.message;
    el('profile-error').classList.remove('hidden');
  }
});

// ─── Usuários ─────────────────────────────────────────────────────────────────

async function loadUsers() {
  try {
    const users = await apiFetch('/users');
    const roleLabel = { admin: 'Administrador', agent: 'Agente' };
    el('users-tbody').innerHTML = users.map((u) => `
      <tr>
        <td>${u.name}</td>
        <td>${u.email}</td>
        <td><span class="status-badge status-${u.role === 'admin' ? 'qualified' : 'contacted'}">${roleLabel[u.role] || u.role}</span></td>
        <td><span class="status-badge status-${u.active ? 'converted' : 'lost'}">${u.active ? 'Ativo' : 'Inativo'}</span></td>
        <td>${fmtDate(u.createdAt)}</td>
        <td style="display:flex;gap:.4rem;">
          <button class="btn-sm btn-edit" onclick="openEditUser(${u.id})">Editar</button>
          ${u.id !== currentUser?.id ? `<button class="btn-sm btn-del" onclick="deleteUser(${u.id})">Excluir</button>` : ''}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:2rem">Nenhum usuário.</td></tr>';
  } catch (err) { console.error(err); }
}

el('new-user-btn').addEventListener('click', () => openUserModal());
el('user-modal-cancel').addEventListener('click', () => hide('user-modal'));

function openUserModal(user = null) {
  el('user-modal-title').textContent = user ? 'Editar Usuário' : 'Novo Usuário';
  el('user-id').value = user?.id || '';
  el('user-name-input').value = user?.name || '';
  el('user-email-input').value = user?.email || '';
  el('user-password-input').value = '';
  el('user-role-input').value = user?.role || 'agent';
  el('user-password-hint').textContent = user ? '(deixe em branco para manter)' : '(obrigatória no cadastro)';
  if (!user) el('user-password-input').setAttribute('required', '');
  else el('user-password-input').removeAttribute('required');
  show('user-modal');
}

el('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = el('user-id').value;
  const body = {
    name: el('user-name-input').value,
    email: el('user-email-input').value,
    role: el('user-role-input').value,
  };
  const pwd = el('user-password-input').value;
  if (pwd) body.password = pwd;

  try {
    if (id) {
      await apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await apiFetch('/users', { method: 'POST', body: JSON.stringify(body) });
    }
    hide('user-modal');
    loadUsers();
  } catch (err) { alert(err.message); }
});

async function openEditUser(id) {
  try {
    const users = await apiFetch('/users');
    const user = users.find(u => u.id === id);
    if (user) openUserModal(user);
  } catch (err) { alert(err.message); }
}

async function deleteUser(id) {
  if (!confirm('Excluir este usuário?')) return;
  try {
    await apiFetch(`/users/${id}`, { method: 'DELETE' });
    loadUsers();
  } catch (err) { alert(err.message); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

if (token) {
  apiFetch('/auth/me').then((user) => {
    if (!user) return;
    currentUser = user;
    el('user-name').textContent = user.name;
    applyUserRole(user.role);
    hide('login-screen');
    show('app-screen');
    navigateTo('dashboard');
    startWAStatusPolling();
  }).catch(logout);
}
