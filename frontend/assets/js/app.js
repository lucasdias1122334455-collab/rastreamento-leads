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

  if (page === 'dashboard') loadDashboard();
  if (page === 'leads') loadLeads(1);
  if (page === 'clients') loadClients();
  if (page === 'whatsapp') loadWAStatus();
  if (page === 'users') loadUsers();
  if (page === 'meta-stats') loadMetaStats();
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

// ─── Meta Stats ───────────────────────────────────────────────────────────────

async function loadMetaStats() {
  try {
    const data = await apiFetch('/dashboard/meta-stats');

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
      ? data.byAd.map(ad => `
        <tr>
          <td>
            <strong>${ad.name}</strong>
            ${ad.adId ? `<div style="font-size:.75rem;color:var(--muted)">ID: ${ad.adId}</div>` : ''}
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
        </tr>
      `).join('')
      : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:2rem">Nenhum lead do Meta ainda. Configure os anúncios Click-to-WhatsApp.</td></tr>';

  } catch (err) { console.error(err); }
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
