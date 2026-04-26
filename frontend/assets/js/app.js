const API = '/api';
let token = localStorage.getItem('token');
let currentUser = null;
let currentPage = 1;
let waStatusInterval = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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

function showToast(msg, duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;pointer-events:none';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.style.cssText = 'background:#1e2235;color:#e2e8f0;padding:.65rem 1.1rem;border-radius:10px;font-size:.84rem;border:1px solid rgba(255,255,255,.1);box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:320px;pointer-events:auto';
  container.appendChild(t);
  setTimeout(() => { t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, duration);
}

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
  if (page === 'conversions') { loadConversions(); loadSalesList(); }
  if (page === 'conversations') loadConversations();
  if (page === 'reports')   initReportsPage();
  if (page === 'tracking')  loadTrackingLinks();
  if (page === 'crm') { initCRM(); }
  // Stop CRM polling when leaving the page
  if (page !== 'crm' && crmPollTimer) { clearInterval(crmPollTimer); crmPollTimer = null; }
  if (page !== 'crm' && crmApptNotifTimer) { clearInterval(crmApptNotifTimer); crmApptNotifTimer = null; }
}

document.querySelectorAll('.nav-item').forEach((a) => {
  a.addEventListener('click', (e) => {
    if (a.getAttribute('href') && a.getAttribute('href') !== '#') return;
    e.preventDefault();
    navigateTo(a.dataset.page);
  });
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
      <span>Tempo médio de conversão: <strong>${data.avgConversionDays ? data.avgConversionDays + ' dias' : '—'}</strong></span>
      <span>Convertidos: <strong>${data.byStatus.converted || 0}</strong></span>
      <span>Perdidos: <strong>${data.byStatus.lost || 0}</strong></span>
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
  const origin = el('filter-origin')?.value || '';
  const params = new URLSearchParams({ page, limit: 20, ...(search && { search }), ...(status && { status }), ...(clientId && { clientId }), ...(origin && { origin }) });

  try {
    const data = await apiFetch(`/leads?${params}`);
    el('leads-tbody').innerHTML = data.leads.map((l) => {
      // Formata o telefone exibido
      let phoneDisplay = l.phone || '—';
      if (l.phone?.startsWith('ig_'))      phoneDisplay = `📸 Instagram DM`;
      else if (l.phone?.startsWith('brendi_')) phoneDisplay = `🛒 Brendi`;
      else if (l.phone?.startsWith('grp_'))    phoneDisplay = `👥 Grupo`;
      else if (l.phone?.endsWith('@lid'))   phoneDisplay = l.phone.replace('@lid','').replace(/(\d{2})(\d{5})(\d{4})/,'($1) $2-$3');
      return `<tr>
        <td class="td-name">${l.name || '<em style="color:var(--muted);font-weight:400">sem nome</em>'}</td>
        <td class="td-phone" title="${l.phone}">${phoneDisplay}</td>
        <td>${statusBadge(l.status)}</td>
        <td style="color:var(--muted);font-size:.82rem">${stageLabel(l.stage)}</td>
        <td style="color:var(--muted);font-size:.8rem">${l.source === 'whatsapp_meta' ? '📢 Anúncio' : l.fromAd ? '🔗 Link Rastreado' : l.source || '—'}</td>
        <td>${l.client ? `<span class="client-tag">${l.client.name}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="color:var(--muted);font-size:.8rem">${fmtDate(l.createdAt)}</td>
        <td style="display:flex;gap:.35rem;white-space:nowrap">
          <button class="btn-sm btn-edit" onclick="openEditModal(${l.id})">Editar</button>
          <button class="btn-sm btn-del" onclick="deleteLead(${l.id})">Excluir</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:2rem">Nenhum lead encontrado.</td></tr>';

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
el('filter-origin').addEventListener('change', () => loadLeads(1));

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
el('client-modal-cancel-x')?.addEventListener('click', () => hide('client-modal'));

function copyWebhookUrl(el) {
  const text = el.textContent?.trim();
  if (!text || text === 'Salve o cliente para ver a URL') return;
  navigator.clipboard?.writeText(text).then(() => showToast('URL copiada!')).catch(() => {});
}
el('client-ai-enabled').addEventListener('change', function() {
  el('client-ai-fields').style.display = this.checked ? 'block' : 'none';
  if (el('client-ai-enabled-label')) el('client-ai-enabled-label').textContent = this.checked ? 'IA ativada' : 'IA desativada';
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
  if (el('client-ai-enabled-label')) el('client-ai-enabled-label').textContent = aiEnabled ? 'IA ativada' : 'IA desativada';
  el('client-ai-fields').style.display = aiEnabled ? 'block' : 'none';
  el('client-voice-enabled').checked = Boolean(client?.voiceEnabled);
  el('client-payment-link').value = client?.paymentLink || '';
  el('client-ai-script').value = client?.aiScript || '';
  // Campos Pixel
  el('client-website').value = client?.website || '';
  el('client-pixel-id').value = client?.pixelId || '';
  el('client-meta-conversions-token').value = client?.metaConversionsToken || '';
  el('client-brendi-client-id').value = client?.brendiClientId || '';
  el('client-brendi-secret').value = client?.brendiSecret || '';
  // Campos Instagram DM
  el('client-instagram-token').value = client?.instagramToken || '';
  el('client-instagram-account-id').value = client?.instagramAccountId || '';
  // Set webhook URL
  const baseUrl = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://' + window.location.hostname;
  el('client-instagram-webhook-url').value = `${baseUrl}/api/instagram/webhook`;
  // URL webhook do site
  const saleUrl = client?.id
    ? `https://rastreamento-leads-production.up.railway.app/api/sale/webhook/${client.id}`
    : 'Salve o cliente para ver a URL';
  el('client-sale-webhook-url').textContent = saleUrl;
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
    voiceEnabled: el('client-voice-enabled').checked,
    aiScript: el('client-ai-script').value || null,
    paymentLink: el('client-payment-link').value || null,
    website: el('client-website').value || null,
    pixelId: el('client-pixel-id').value || null,
    metaConversionsToken: el('client-meta-conversions-token').value || null,
    brendiClientId: el('client-brendi-client-id').value || null,
    brendiSecret: el('client-brendi-secret').value || null,
    instagramToken: el('client-instagram-token').value || null,
    instagramAccountId: el('client-instagram-account-id').value || null,
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
        el('qr-modal-img-wrap').innerHTML = '<p style="color:#22c55e;font-size:1.2rem">Conectado!</p>';
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

  // Mostra/oculta seletor de período
  const rangeEl = el('conv-date-range');
  if (rangeEl) rangeEl.classList.toggle('hidden', tab !== 'range');

  if (tab === 'range') return; // aguarda usuário clicar em Buscar

  const rows = tab === 'daily' ? convData.daily
             : tab === 'weekly' ? convData.weekly
             : convData.monthly;

  const labelKey = tab === 'daily' ? 'date' : tab === 'weekly' ? 'week' : 'month';
  el('conv-col-period').textContent = tab === 'daily' ? 'Dia' : tab === 'weekly' ? 'Semana' : 'Período';

  renderConvRows(rows, labelKey);
}

function renderConvRows(rows, labelKey) {
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

async function applyConvDateRange() {
  const from = el('conv-date-from')?.value;
  const to   = el('conv-date-to')?.value;
  if (!from || !to) { alert('Selecione as duas datas.'); return; }
  if (from > to)    { alert('A data inicial deve ser anterior à final.'); return; }

  try {
    const clientId = el('conv-client-filter')?._activeId || '';
    const qs = new URLSearchParams({ startDate: from, endDate: to });
    if (clientId) qs.set('clientId', clientId);

    const data = await apiFetch(`/dashboard/conversion-values?${qs}`);

    el('conv-col-period').textContent = 'Dia';

    // Usa o daily do range retornado
    renderConvRows(data.daily || [], 'date');

    // Atualiza cards de sumário
    if (data.summary) {
      if (el('conv-today-val'))    el('conv-today-val').textContent    = data.summary.today.formatted;
      if (el('conv-today-count'))  el('conv-today-count').textContent  = `${data.summary.today.count} conversão(ões)`;
      if (el('conv-week-val'))     el('conv-week-val').textContent     = data.summary.week.formatted;
      if (el('conv-week-count'))   el('conv-week-count').textContent   = `${data.summary.week.count} conversão(ões)`;
      if (el('conv-month-val'))    el('conv-month-val').textContent    = data.summary.month.formatted;
      if (el('conv-month-count'))  el('conv-month-count').textContent  = `${data.summary.month.count} conversão(ões)`;
      if (el('conv-alltime-val'))  el('conv-alltime-val').textContent  = data.summary.allTime.formatted;
      if (el('conv-alltime-count'))el('conv-alltime-count').textContent= `${data.summary.allTime.count} total`;
    }
  } catch(e) {
    console.error('Erro ao buscar período:', e);
  }
}

document.querySelectorAll('.conv-tab').forEach(b => {
  b.addEventListener('click', () => { if (convData || b.dataset.tab === 'range') renderConvTab(b.dataset.tab); });
});

async function loadSalesList() {
  const tbody = document.getElementById('sales-list-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:rgba(255,255,255,0.3);padding:2rem">Carregando...</td></tr>';

  try {
    const from = document.getElementById('sales-from')?.value;
    const to   = document.getElementById('sales-to')?.value;
    const cid  = el('conv-client-filter')?._activeId || '';
    const qs   = new URLSearchParams();
    if (from) qs.set('startDate', from);
    if (to)   qs.set('endDate', to);
    if (cid)  qs.set('clientId', cid);
    qs.set('limit', '200');

    const rows = await apiFetch(`/dashboard/sales-list?${qs}`);

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:rgba(255,255,255,0.3);padding:2rem">Nenhuma venda encontrada</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const icon  = '';
      const valor = r.valor != null ? fmtBRL(r.valor) : '<span style="color:rgba(255,255,255,0.3)">—</span>';
      const data  = r.convertedAt ? new Date(r.convertedAt).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
      const tel   = r.telefone !== '—' ? `<a href="https://wa.me/${r.telefone}" target="_blank" style="color:#00d4aa;text-decoration:none">${r.telefone}</a>` : '—';
      const ad    = r.anuncio ? `<span style="font-size:11px;color:rgba(255,255,255,0.45)" title="${r.anuncio}">${r.anuncio.substring(0,25)}${r.anuncio.length>25?'…':''}</span>` : '—';
      return `<tr>
        <td><strong>${r.nome}</strong>${r.email && r.email !== '—' ? `<br><span style="font-size:11px;color:rgba(255,255,255,0.35)">${r.email}</span>` : ''}</td>
        <td>${tel}</td>
        <td>${icon} ${r.canal}</td>
        <td>${ad}</td>
        <td style="color:#00d4aa;font-weight:600">${valor}</td>
        <td style="font-size:12px;color:rgba(255,255,255,0.5)">${data}</td>
        <td><button class="btn-sm btn-primary" onclick="navigateTo('leads');setTimeout(()=>openLeadModal(${r.id}),300)">Ver</button></td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:2rem">Erro: ${err.message}</td></tr>`;
  }
}

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
    const sourceIcon = (src) => src === 'whatsapp_meta' ? '📢' : src === 'manual' ? '✍️' : src === 'instagram' ? '📸' : src === 'website' ? '🛒' : src === 'whatsapp_group' ? '👥' : '📱';
    container.innerHTML = groups.map(g => {
      if (g.isAbandoned) {
        return `
          <div class="conv-ad-item conv-ad-abandoned" onclick="selectConvAd('${encodeURIComponent('__abandoned__')}', this, '🛒 Carrinho Abandonado')">
            <div class="conv-ad-title">🛒 Carrinho Abandonado</div>
            <div class="conv-ad-meta">${g.total} leads · recuperar agora</div>
          </div>`;
      }
      if (g.isGroups) {
        return `
          <div class="conv-ad-item conv-ad-groups" onclick="selectConvAd('${encodeURIComponent('__groups__')}', this, '👥 Grupos WhatsApp')">
            <div class="conv-ad-title">👥 Grupos WhatsApp</div>
            <div class="conv-ad-meta">${g.total} grupo${g.total !== 1 ? 's' : ''} · ${g.new} com mensagens novas</div>
          </div>`;
      }
      return `
        <div class="conv-ad-item" onclick="selectConvAd('${encodeURIComponent(g.key)}', this, '${g.key.replace(/'/g, "\\'")}')">
          <div class="conv-ad-title">${sourceIcon(g.source)} ${g.key}</div>
          <div class="conv-ad-meta">${g.total} leads · ${g.converted} convertidos</div>
        </div>`;
    }).join('');
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
  if (el_clicked) el_clicked.classList.add('active');
  if (el('conv-leads-header-text')) el('conv-leads-header-text').textContent = label;
  if (el('conv-leads-list')) el('conv-leads-list').innerHTML = '<p class="conv-empty">Carregando...</p>';
  if (el('conv-messages')) el('conv-messages').innerHTML = '<p class="conv-empty" style="margin-top:3rem">← Selecione um lead</p>';
  if (el('conv-chat-header-text')) el('conv-chat-header-text').textContent = 'Conversa';
  if (el('conv-chat-info')) el('conv-chat-info').classList.add('hidden');
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
      const isGrp = l.phone?.startsWith('grp_');
      return `
        <div class="conv-lead-item${isGrp ? ' conv-lead-group' : ''}" onclick="selectConvLead(${l.id}, this)">
          <div class="conv-lead-name">${isGrp ? '👥 ' : ''}${l.name || l.phone}</div>
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
  if (el('conv-messages')) el('conv-messages').innerHTML = '<p class="conv-empty" style="margin-top:3rem">Carregando...</p>';
  if (isMobile()) convMobileShow('chat');

  if (convPollTimer) clearInterval(convPollTimer);
  await renderConvChat(id);
  convPollTimer = setInterval(() => { if (convActiveLeadId === id) renderConvChat(id); }, 5000);
}

async function renderConvChat(id) {
  try {
    const lead = await apiFetch(`/conversations/lead/${id}`);

    const isGroupLead = lead.phone?.startsWith('grp_');

    // Info do lead
    if (el('conv-chat-header-text')) el('conv-chat-header-text').textContent = lead.name || lead.phone;
    const info = el('conv-chat-info');
    if (!info) return;
    info.classList.remove('hidden');

    let phoneDisplay = lead.phone || '—';
    if (lead.phone?.startsWith('ig_'))    phoneDisplay = '📸 Instagram DM';
    else if (lead.phone?.startsWith('brendi_')) phoneDisplay = '🛒 Brendi';
    else if (lead.phone?.startsWith('grp_'))    phoneDisplay = '👥 Grupo WhatsApp';

    info.innerHTML = `
      <div class="conv-chat-info-item">📞 <strong>${phoneDisplay}</strong></div>
      ${lead.client ? `<div class="conv-chat-info-item">🏢 <strong>${lead.client.name}</strong></div>` : ''}
      <div class="conv-chat-info-item">${statusBadge(lead.status)}</div>
      ${!isGroupLead ? `<div class="conv-chat-info-item" style="gap:4px">
        💰 <input type="number" id="conv-lead-value" value="${lead.value || ''}" placeholder="R$ valor" step="0.01" min="0"
          style="width:90px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:var(--text);padding:3px 7px;font-size:12px;outline:none"
          onkeydown="if(event.key==='Enter')saveConvLeadValue(${lead.id})">
        <button class="btn-sm" style="background:rgba(62,207,207,0.2);border:1px solid rgba(62,207,207,0.4);color:#3ecfcf;padding:3px 8px;border-radius:6px;font-size:11px;cursor:pointer" onclick="saveConvLeadValue(${lead.id})">✓</button>
      </div>` : ''}
      <div class="conv-chat-info-item" style="margin-left:auto">
        <button class="btn-sm btn-primary" onclick="navigateTo('leads');setTimeout(()=>openLeadModal(${lead.id}),300)">Ver Lead</button>
      </div>
    `;

    // Mensagens
    const convMsgs = el('conv-messages');
    if (!convMsgs) return;
    if (!lead.interactions.length) {
      convMsgs.innerHTML = '<p class="conv-empty" style="margin-top:3rem;text-align:center">Nenhuma mensagem ainda.</p>';
      return;
    }

    convMsgs.innerHTML = lead.interactions.map(i => {
      const dir = i.direction === 'outbound' ? 'outbound' : i.type === 'note' ? 'system' : 'inbound';
      let content = i.content;
      const time = new Date(i.createdAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      const isConversion = content.includes('Comprovante de pagamento recebido') || content.includes('Pagamento aprovado');

      // Extrai metadados de grupo
      let groupSenderName = null;
      if (isGroupLead && dir === 'inbound') {
        try {
          const meta = JSON.parse(i.metadata || '{}');
          groupSenderName = meta.participantName || meta.participant || null;
        } catch (_) {}
      }

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
            ${groupSenderName ? `<div class="conv-msg-group-sender">${groupSenderName}</div>` : dir === 'outbound' ? '<div class="conv-msg-sender">Agente IA</div>' : ''}
            ${bubble}
          `}
          <div class="conv-msg-time">${time}</div>
        </div>
      `;
    }).join('');

    // Rola para o final
    const msgs = el('conv-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch (err) { console.error(err); }
}

async function saveConvLeadValue(leadId) {
  const input = el('conv-lead-value');
  if (!input) return;
  const value = parseFloat(input.value);
  if (isNaN(value) || value < 0) { showToast('Valor inválido'); return; }
  try {
    await apiFetch(`/leads/${leadId}`, {
      method: 'PUT',
      body: JSON.stringify({ value, status: 'converted' }),
    });
    showToast('Valor salvo!');
    input.style.borderColor = 'rgba(62,207,207,0.6)';
    setTimeout(() => { if (el('conv-lead-value')) el('conv-lead-value').style.borderColor = 'rgba(255,255,255,0.15)'; }, 2000);
  } catch (err) {
    showToast('Erro ao salvar valor');
  }
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

// ===================== AI ANALYST PAGE =====================
let analystPageHistory = [];
let analystPageStarted = false;
let analystPendingImage = null; // { base64, mediaType, preview }

function analystQuickSend(text) {
  const input = el('analyst-page-input');
  input.value = text;
  analystPageSend();
}

function analystPageKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    analystPageSend();
  }
}

function analystAttachImage() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result.split(',')[1];
      const mediaType = file.type;
      analystPendingImage = { base64, mediaType, preview: ev.target.result };
      // Show preview
      const preview = el('analyst-image-preview');
      if (preview) {
        preview.innerHTML = `<div style="position:relative;display:inline-block"><img src="${ev.target.result}" style="max-height:80px;border-radius:8px;border:1px solid rgba(108,99,255,0.4)"><button onclick="analystClearImage()" style="position:absolute;top:-6px;right:-6px;background:#ff4444;border:none;border-radius:50%;width:18px;height:18px;color:white;font-size:11px;cursor:pointer;line-height:1">×</button></div>`;
        preview.classList.remove('hidden');
      }
    };
    reader.readAsDataURL(file);
  };
  fileInput.click();
}

function analystClearImage() {
  analystPendingImage = null;
  const preview = el('analyst-image-preview');
  if (preview) { preview.innerHTML = ''; preview.classList.add('hidden'); }
}

async function analystPageSend() {
  const input = el('analyst-page-input');
  const message = input.value.trim();
  if (!message && !analystPendingImage) return;
  const sendText = message || '(imagem enviada)';
  input.value = '';
  input.style.height = 'auto';

  const imageToSend = analystPendingImage;
  analystClearImage();

  // First message — hide header/suggestions, show messages
  if (!analystPageStarted) {
    analystPageStarted = true;
    el('analyst-page-header').classList.add('compact');
    el('analyst-page-suggestions').classList.add('hidden');
    el('analyst-page-messages').classList.remove('hidden');
  }

  const msgs = el('analyst-page-messages');

  // User message
  const imgHtml = imageToSend ? `<img src="${imageToSend.preview}" style="max-width:200px;border-radius:8px;display:block;margin-bottom:6px">` : '';
  msgs.innerHTML += `
    <div class="analyst-page-msg analyst-page-msg-user">
      <div class="analyst-page-avatar">EU</div>
      <div class="analyst-page-bubble">${imgHtml}${sendText.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>
    </div>`;

  // Typing indicator
  const typingId = 'analyst-typing-' + Date.now();
  msgs.innerHTML += `
    <div class="analyst-page-msg analyst-page-msg-ai" id="${typingId}">
      <div class="analyst-page-avatar">IA</div>
      <div class="analyst-page-bubble analyst-typing-dots">Analisando${imageToSend ? ' imagem' : ' dados'}...</div>
    </div>`;
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const clientId = window.convActiveClientId || null;
    // Use raw fetch to avoid header override issue in apiFetch
    const token = localStorage.getItem('token');
    const res = await fetch('/api/analyst/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: sendText,
        clientId,
        history: analystPageHistory,
        image: imageToSend ? { base64: imageToSend.base64, mediaType: imageToSend.mediaType } : null,
      }),
    });

    document.getElementById(typingId)?.remove();

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(`Erro ${res.status}: ${errData.error || ''} ${JSON.stringify(errData.detail || '')}`);
    }
    const data = await res.json();

    const reply = data.reply || 'Erro ao processar resposta.';
    analystPageHistory.push({ role: 'user', content: sendText });
    analystPageHistory.push({ role: 'assistant', content: reply });
    if (analystPageHistory.length > 20) analystPageHistory = analystPageHistory.slice(-20);

    const formatted = reply
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:4px">$1</code>')
      .replace(/\n/g, '<br>');

    msgs.innerHTML += `
      <div class="analyst-page-msg analyst-page-msg-ai">
        <div class="analyst-page-avatar">IA</div>
        <div class="analyst-page-bubble">${formatted}</div>
      </div>`;
    msgs.scrollTop = msgs.scrollHeight;
  } catch (err) {
    document.getElementById(typingId)?.remove();
    msgs.innerHTML += `
      <div class="analyst-page-msg analyst-page-msg-ai">
        <div class="analyst-page-avatar">IA</div>
        <div class="analyst-page-bubble" style="color:#ff6b6b">Erro ao conectar. Tente novamente.<br><small>${err.message}</small></div>
      </div>`;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

// ─── LINKS DE RASTREAMENTO ────────────────────────────────────────────────────

const BASE_URL = window.location.origin;

async function loadTrackingLinks() {
  const tbody = document.getElementById('tracking-links-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:rgba(255,255,255,0.3);padding:2rem">Carregando...</td></tr>';
  try {
    const rows = await apiFetch('/tracking/api/links');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:rgba(255,255,255,0.3);padding:2rem">Nenhum link criado ainda. Clique em "+ Novo Link" para começar.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const link = `${BASE_URL}/rastrear/${r.slug}`;
      const convs = Number(r.conversions) || 0;
      const revenue = Number(r.revenue) || 0;
      const cvr = r.clicks > 0 ? ((convs / r.clicks) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td><strong>${r.campaign}</strong></td>
        <td>
          <div style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:12px;color:#a89fff;word-break:break-all">${link}</span>
            <button onclick="copyLink('${link}')" title="Copiar" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);color:#ccc;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px;flex-shrink:0">Copiar</button>
          </div>
        </td>
        <td style="font-size:12px;color:rgba(255,255,255,0.5);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.destination}">${r.destination}</td>
        <td style="color:#00d4aa;font-weight:600">${r.clicks}</td>
        <td style="color:#a78bfa;font-weight:600">${convs} <span style="font-size:10px;color:rgba(255,255,255,0.3)">(${cvr}%)</span></td>
        <td style="color:#f59e0b;font-weight:600">${revenue > 0 ? 'R$ ' + revenue.toLocaleString('pt-BR', {minimumFractionDigits:2}) : '—'}</td>
        <td style="font-size:12px;color:rgba(255,255,255,0.4)">${r.clientName || '—'}</td>
        <td style="display:flex;gap:.4rem">
          <button onclick="editTrackingLink(${r.id},'${r.campaign.replace(/'/g,"\\'")}','${r.destination.replace(/'/g,"\\'")}',${r.clientId||'null'})" style="background:rgba(108,99,255,0.12);border:1px solid rgba(108,99,255,0.25);color:#a89fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px">Editar</button>
          <button onclick="deleteTrackingLink(${r.id})" style="background:rgba(255,100,100,0.1);border:1px solid rgba(255,100,100,0.2);color:#ff6b6b;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px">Excluir</button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#ff6b6b;padding:2rem">Erro: ${err.message}</td></tr>`;
  }
}

function copyLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = 'Copiado';
    btn.style.color = '#00d4aa';
    setTimeout(() => { btn.textContent = orig; btn.style.color = '#ccc'; }, 2000);
  });
}

let _editingLinkId = null;

async function editTrackingLink(id, campaign, destination, clientId) {
  _editingLinkId = id;
  await openTrackingModal();
  document.getElementById('tl-campaign').value = campaign;
  document.getElementById('tl-destination').value = destination;
  document.getElementById('tl-slug').value = '';
  document.getElementById('tl-slug').disabled = true;
  document.getElementById('tl-slug').placeholder = 'Slug não pode ser alterado';
  document.getElementById('tl-preview').style.display = 'none';
  if (clientId) document.getElementById('tl-client').value = clientId;
  document.querySelector('#tracking-form button[type=submit]').textContent = 'Salvar';
  document.querySelector('#tracking-modal h3').textContent = 'Editar Link';
}

async function openTrackingModal() {
  _editingLinkId = null;
  document.getElementById('tl-campaign').value = '';
  document.getElementById('tl-slug').value = '';
  document.getElementById('tl-slug').disabled = false;
  document.getElementById('tl-slug').placeholder = 'Ex: promo-verao-2025';
  document.getElementById('tl-destination').value = '';
  document.getElementById('tl-preview').style.display = 'none';
  document.querySelector('#tracking-form button[type=submit]').textContent = 'Criar Link';
  document.querySelector('#tracking-modal h3').textContent = 'Novo Link de Rastreamento';

  // Popula clientes
  const sel = document.getElementById('tl-client');
  sel.innerHTML = '<option value="">Sem cliente específico</option>';
  try {
    const clients = await apiFetch('/clients');
    if (Array.isArray(clients)) {
      clients.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name;
        sel.appendChild(o);
      });
    }
  } catch (_) {}

  document.getElementById('tracking-modal').classList.remove('hidden');

  // Preview ao digitar slug
  const slugEl = document.getElementById('tl-slug');
  const preview = document.getElementById('tl-preview');
  const previewUrl = document.getElementById('tl-preview-url');
  slugEl.oninput = () => {
    const s = slugEl.value.trim();
    if (s) { previewUrl.textContent = `${BASE_URL}/rastrear/${s}`; preview.style.display = 'block'; }
    else   { preview.style.display = 'none'; }
  };

  // Auto-gera slug ao digitar campanha
  document.getElementById('tl-campaign').oninput = (e) => {
    if (!slugEl.value) {
      slugEl.value = e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 40);
      slugEl.dispatchEvent(new Event('input'));
    }
  };
}

function closeTrackingModal() {
  document.getElementById('tracking-modal').classList.add('hidden');
}

async function saveTrackingLink(e) {
  e.preventDefault();
  const body = {
    campaign:    document.getElementById('tl-campaign').value.trim(),
    slug:        document.getElementById('tl-slug').value.trim(),
    destination: document.getElementById('tl-destination').value.trim(),
    clientId:    document.getElementById('tl-client').value || null,
  };
  try {
    if (_editingLinkId) {
      await apiFetch(`/tracking/api/links/${_editingLinkId}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await apiFetch('/tracking/api/links', { method: 'POST', body: JSON.stringify(body) });
    }
    closeTrackingModal();
    loadTrackingLinks();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function deleteTrackingLink(id) {
  if (!confirm('Excluir este link?')) return;
  try {
    await apiFetch(`/tracking/api/links/${id}`, { method: 'DELETE' });
    loadTrackingLinks();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// ─── RELATÓRIOS ──────────────────────────────────────────────────────────────

let _chartDaily = null;
let _chartDonut = null;

function reportsQueryParams() {
  const start  = document.getElementById('report-start')?.value || '';
  const end    = document.getElementById('report-end')?.value || '';
  const client = document.getElementById('report-client')?.value || '';
  const p = new URLSearchParams();
  if (start)  p.set('startDate', start);
  if (end)    p.set('endDate', end);
  if (client) p.set('clientId', client);
  return p.toString() ? '?' + p.toString() : '';
}

async function loadReports() {
  const q = reportsQueryParams();
  const token = localStorage.getItem('token');
  const headers = { 'Authorization': `Bearer ${token}` };

  try {
    const [sumRes, dailyRes, adsRes, funnelRes, chanRes] = await Promise.all([
      fetch('/api/reports/summary'  + q, { headers }),
      fetch('/api/reports/daily'    + q, { headers }),
      fetch('/api/reports/ads'      + q, { headers }),
      fetch('/api/reports/funnel'   + q, { headers }),
      fetch('/api/reports/channels' + q, { headers }),
    ]);

    const summary  = await sumRes.json();
    const daily    = await dailyRes.json();
    const ads      = await adsRes.json();
    const funnel   = await funnelRes.json();
    const channels = await chanRes.json();

    if (Array.isArray(summary) && summary[0]) renderSummary(summary[0]);
    if (Array.isArray(daily))    renderDailyChart(daily);
    if (Array.isArray(ads))      { renderAdsDonut(ads); renderAdsTable(ads); }
    if (Array.isArray(funnel))   renderFunnel(funnel);
    if (Array.isArray(channels)) renderChannelsTable(channels);
  } catch (err) {
    console.error('[Reports]', err);
  }
}

function renderSummary(s) {
  const fmt = v => v == null ? '—' : v;
  const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('rpt-total-leads').textContent = fmt(s.total_leads);
  document.getElementById('rpt-converted').textContent   = fmt(s.convertidos);
  document.getElementById('rpt-receita').textContent     = brl(s.receita_brl);
  document.getElementById('rpt-cvr').textContent         = s.cvr != null ? s.cvr + '%' : '—';
  document.getElementById('rpt-roas').textContent        = s.roas != null ? s.roas + 'x' : '—';
  document.getElementById('rpt-ticket').textContent      = brl(s.ticket_medio);
}

function renderDailyChart(rows) {
  const labels = rows.map(r => r.data ? r.data.slice(5) : '');
  const leads  = rows.map(r => r.novos_leads || 0);
  const convs  = rows.map(r => r.conversoes || 0);

  if (_chartDaily) _chartDaily.destroy();
  const ctx = document.getElementById('chart-daily');
  if (!ctx) return;
  _chartDaily = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Novos Leads',
          data: leads,
          borderColor: '#6c63ff',
          backgroundColor: 'rgba(108,99,255,0.12)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
        {
          label: 'Conversões',
          data: convs,
          borderColor: '#00d4aa',
          backgroundColor: 'rgba(0,212,170,0.10)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

function renderAdsDonut(rows) {
  const top = rows.slice(0, 8);
  const labels = top.map(r => r.anuncio?.substring(0, 28) || '—');
  const data   = top.map(r => r.leads || 0);
  const colors = ['#6c63ff','#00d4aa','#ff6b6b','#ffd93d','#4ecdc4','#ff8b94','#a8e6cf','#dda0dd'];

  if (_chartDonut) _chartDonut.destroy();
  const ctx = document.getElementById('chart-ads-donut');
  if (!ctx) return;
  _chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: 'rgba(255,255,255,0.55)', font: { size: 10 }, boxWidth: 10, padding: 8 } },
      },
    },
  });
}

function renderAdsTable(rows) {
  const tbody = document.getElementById('report-ads-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:rgba(255,255,255,0.3);padding:2rem">Nenhum dado encontrado</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const roas = r.roas > 0 ? `<span style="color:#00d4aa;font-weight:600">${r.roas}x</span>` : '<span style="color:rgba(255,255,255,0.3)">—</span>';
    const cvr  = `<span style="color:${r.cvr >= 10 ? '#00d4aa' : r.cvr >= 5 ? '#ffd93d' : '#ff6b6b'}">${r.cvr}%</span>`;
    return `<tr>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.anuncio}">${r.anuncio || '—'}</td>
      <td>${r.leads}</td>
      <td style="color:#00d4aa;font-weight:600">${r.convertidos}</td>
      <td style="color:#ff6b6b">${r.perdidos}</td>
      <td>${cvr}</td>
      <td>R$ ${Number(r.receita_brl || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
      <td>${r.investimento_brl > 0 ? 'R$ ' + Number(r.investimento_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
      <td>${roas}</td>
    </tr>`;
  }).join('');
}

function renderFunnel(rows) {
  const el = document.getElementById('report-funnel');
  if (!el) return;
  const colors = { 'Novos Leads':'#6c63ff','Contactados':'#4ecdc4','Qualificados':'#ffd93d','Convertidos':'#00d4aa','Perdidos':'#ff6b6b','Receita Total (R$)':'#a8e6cf' };
  el.innerHTML = rows.map(r => `
    <div style="flex:1;min-width:120px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:1rem;text-align:center">
      <div style="font-size:11px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.4rem">${r.etapa}</div>
      <div style="font-size:22px;font-weight:700;color:${colors[r.etapa] || '#fff'}">${r.etapa.includes('R$') ? 'R$ ' + Number(r.quantidade || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : r.quantidade}</div>
      ${r.pct_do_total !== '-' ? `<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:.25rem">${r.pct_do_total}</div>` : ''}
    </div>`).join('');
}

async function exportReportsCSV() {
  const q = reportsQueryParams();
  const sep = q ? '&' : '?';
  window.open('/api/reports/ads' + q + sep + 'format=csv&apiKey=' + (window._reportsApiKey || ''), '_blank');
}

function printReports() {
  // Marca a data de impressão no elemento para aparecer no rodapé via CSS attr()
  const section = document.getElementById('page-reports');
  if (section) {
    const now = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    section.setAttribute('data-print-date', now);
  }
  window.print();
}

function renderChannelsTable(rows) {
  const tbody = document.getElementById('report-channels-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:rgba(255,255,255,0.3);padding:1.5rem">Nenhum dado</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const cvr  = `<span style="color:${r.cvr >= 10 ? '#00d4aa' : r.cvr >= 5 ? '#ffd93d' : '#ff6b6b'}">${r.cvr}%</span>`;
    const brl  = v => v > 0 ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—';
    return `<tr>
      <td><strong>${r.canal}</strong></td>
      <td>${r.leads}</td>
      <td style="color:#00d4aa;font-weight:600">${r.convertidos}</td>
      <td style="color:#ff6b6b">${r.perdidos}</td>
      <td>${cvr}</td>
      <td>${brl(r.receita_brl)}</td>
      <td>${brl(r.ticket_medio)}</td>
    </tr>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════════
   CRM
════════════════════════════════════════════════════════════════════ */

let crmTickets = [];
let crmActiveTicket = null;
let crmPollTimer = null;
let crmAllQuickReplies = [];
let crmCurrentClientId = '';
let crmTasksCache = [];
const crmPicCache = {}; // leadId → url | null

function crmToken() { return localStorage.getItem('token'); }

async function initCRM() {
  // Populate client filter
  try {
    const res = await fetch('/api/clients', { headers: { Authorization: `Bearer ${crmToken()}` } });
    const clients = await res.json();
    const sel = document.getElementById('crm-client-filter');
    sel.innerHTML = '<option value="">Todos os clientes</option>';
    if (Array.isArray(clients)) {
      clients.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name;
        sel.appendChild(o);
      });
    }
  } catch (_) {}
  await crmLoadStats();
  await crmLoadTickets();
  await loadCrmQuickReplies();
  crmStartPolling();
  crmStartApptNotifPolling();
}

async function crmLoadStats() {
  try {
    const qs = crmCurrentClientId ? `?clientId=${crmCurrentClientId}` : '';
    const res = await fetch(`/api/crm/stats${qs}`, { headers: { Authorization: `Bearer ${crmToken()}` } });
    const s = await res.json();
    document.getElementById('crm-stat-new').textContent      = s.novo      ?? 0;
    document.getElementById('crm-stat-waiting').textContent  = s.aguardando ?? 0;
    document.getElementById('crm-stat-attending').textContent = s.atendendo  ?? 0;
    document.getElementById('crm-stat-resolved').textContent = s.resolvido  ?? 0;
  } catch (_) {}
}

async function crmLoadTickets() {
  try {
    const params = new URLSearchParams();
    if (crmCurrentClientId) params.set('clientId', crmCurrentClientId);
    const statusFilter = document.getElementById('crm-status-filter')?.value;
    if (statusFilter) params.set('crmStatus', statusFilter);
    const search = document.getElementById('crm-search')?.value;
    if (search) params.set('search', search);

    const res = await fetch(`/api/crm/tickets?${params}`, { headers: { Authorization: `Bearer ${crmToken()}` } });
    crmTickets = await res.json();
    crmRenderTickets();
    if (crmActiveTicket) crmLoadMessages(crmActiveTicket.id);
    crmRenderKanban();
  } catch (_) {}
}

function crmApplyFilter() {
  crmCurrentClientId = document.getElementById('crm-client-filter')?.value || '';
  crmLoadStats();
  crmLoadTickets();
}

function crmStartPolling() {
  if (crmPollTimer) clearInterval(crmPollTimer);
  crmPollTimer = setInterval(() => {
    const page = document.querySelector('.page:not(.hidden)');
    if (page && page.id === 'page-crm') {
      crmLoadStats();
      crmLoadTickets();
    }
  }, 5000);
}

function crmRenderTickets() {
  const container = document.getElementById('crm-tickets');
  if (!container) return;
  if (!crmTickets.length) {
    container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem">Nenhum atendimento encontrado</div>';
    return;
  }
  const avatarColors = ['#00d4b8','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#10b981'];
  container.innerHTML = crmTickets.map((t, i) => {
    const name = t.name || t.phone || '—';
    const initials = name.replace(/[^a-zA-ZÀ-ÿ]/g, '').slice(0, 2).toUpperCase() || '??';
    const color = avatarColors[i % avatarColors.length];
    const preview = t.lastMessage ? t.lastMessage.slice(0, 55) : 'Sem mensagens';
    const ts = t.lastMessageAt || t.createdAt;
    const timeStr = ts ? crmFormatTime(ts) : '';
    const status = t.crmStatus || 'new';
    const unread = t.unread > 0 ? `<span class="crm-ticket-unread">${t.unread}</span>` : '';
    const isActive = crmActiveTicket?.id === t.id ? 'active' : '';
    const silence = crmSilenceTag(t.lastMessageAt, t.lastDirection);

    // Avatar: use cached pic if available, else colored initials
    const picUrl = crmPicCache[t.id];
    const avatarHtml = picUrl
      ? `<img src="${picUrl}" class="crm-ticket-avatar crm-ticket-avatar-img" alt="" onerror="this.parentElement.innerHTML='<div class=&quot;crm-ticket-avatar&quot; style=&quot;background:${color}22;color:${color};border:1.5px solid ${color}44&quot;>${initials}</div>'" />`
      : `<div class="crm-ticket-avatar" style="background:${color}22;color:${color};border:1.5px solid ${color}44" data-lead-id="${t.id}">${initials}</div>`;

    return `<div class="crm-ticket-item ${isActive}" onclick="crmSelectTicket(${t.id})">
      ${avatarHtml}
      <div class="crm-ticket-body">
        <div class="crm-ticket-row1">
          <span class="crm-ticket-name">
            <span class="crm-status-dot ${status}" style="margin-right:4px"></span>${escapeHtml(name)}
          </span>
          <span class="crm-ticket-time">${timeStr}</span>
        </div>
        <div class="crm-ticket-row2">
          <span class="crm-ticket-preview">${escapeHtml(preview)}</span>
          <span class="crm-ticket-badges">${unread}${silence}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  // Lazy-load profile pictures for tickets not yet cached
  crmLazyLoadPics();
}

async function crmLazyLoadPics() {
  const pending = crmTickets.filter(t => !(t.id in crmPicCache));
  if (!pending.length) return;

  // Fetch in small batches to avoid hammering the server
  const batch = pending.slice(0, 10);
  await Promise.all(batch.map(async t => {
    try {
      const res = await fetch(`/api/crm/profile-pic/${t.id}`, {
        headers: { Authorization: `Bearer ${crmToken()}` }
      });
      const { url } = await res.json();
      crmPicCache[t.id] = url || null;

      // Update just this avatar in the DOM without re-rendering the whole list
      if (url) {
        const avatarEl = document.querySelector(`[data-lead-id="${t.id}"]`);
        if (avatarEl) {
          const img = document.createElement('img');
          img.src = url;
          img.className = 'crm-ticket-avatar crm-ticket-avatar-img';
          img.alt = '';
          img.onerror = () => { /* keep initials on error */ };
          avatarEl.replaceWith(img);
        }
        // Also update chat header avatar if this is the active ticket
        if (crmActiveTicket?.id === t.id) {
          const chatAv = document.getElementById('crm-active-avatar');
          if (chatAv) {
            chatAv.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" onerror="this.remove()" />`;
          }
        }
      }
    } catch (_) {
      crmPicCache[t.id] = null;
    }
  }));
}

function crmSilenceTag(lastAt, lastDir) {
  if (!lastAt || lastDir !== 'inbound') return '';
  const diff = Date.now() - new Date(lastAt).getTime();
  const hours = diff / 3600000;
  if (hours < 2) return '';
  const label = hours < 24 ? `${Math.round(hours)}h sem resposta` : `${Math.floor(hours/24)}d sem resposta`;
  const cls = hours < 24 ? 'warn' : 'danger';
  return `<span class="crm-silence-badge ${cls}">${label}</span>`;
}

function crmFormatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

async function crmSelectTicket(id) {
  const ticket = crmTickets.find(t => t.id === id);
  if (!ticket) return;
  crmActiveTicket = ticket;

  // Mark as read
  fetch(`/api/crm/tickets/${id}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${crmToken()}` } }).catch(() => {});

  // Update UI
  document.getElementById('crm-chat-empty').classList.add('hidden');
  document.getElementById('crm-chat-active').classList.remove('hidden');

  const name = ticket.name || ticket.phone || '—';
  const initials = name.replace(/[^a-zA-ZÀ-ÿ]/g, '').slice(0, 2).toUpperCase() || '??';
  document.getElementById('crm-active-avatar').textContent = initials;
  document.getElementById('crm-active-name').textContent = name;
  document.getElementById('crm-active-phone').textContent = ticket.phone || '';
  document.getElementById('crm-active-status').value = ticket.crmStatus || 'new';

  // Mobile: show chat panel
  document.getElementById('crm-ticket-list').classList.add('hidden-mobile');
  document.getElementById('crm-chat-area').classList.add('active-mobile');

  // Re-render ticket list to show active
  crmRenderTickets();

  // Load messages
  await crmLoadMessages(id);

  // Populate contact panel
  crmPopulateContact(ticket);
  loadCpTasks(id);
}

async function crmLoadMessages(leadId) {
  try {
    const res = await fetch(`/api/crm/messages/${leadId}`, { headers: { Authorization: `Bearer ${crmToken()}` } });
    const msgs = await res.json();
    const container = document.getElementById('crm-messages');
    if (!container) return;
    container.innerHTML = msgs.map(m => `
      <div class="crm-msg ${m.direction}">
        <div class="crm-msg-bubble">${escapeHtml(m.content)}</div>
        <div class="crm-msg-time">${new Date(m.createdAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</div>
      </div>`).join('');
    container.scrollTop = container.scrollHeight;
  } catch (_) {}
}

function crmPopulateContact(t) {
  const sourceLabels = {
    whatsapp: 'WhatsApp', whatsapp_meta: 'Meta Ads → WhatsApp',
    whatsapp_group: 'Grupo WhatsApp', instagram: 'Instagram',
    website: 'Site', mercadopago: 'Mercado Pago', manual: 'Manual',
  };
  document.getElementById('cp-name').textContent   = t.name || '—';
  document.getElementById('cp-phone').textContent  = t.phone || '—';
  document.getElementById('cp-source').textContent = sourceLabels[t.source] || t.source || '—';
  document.getElementById('cp-client').textContent = t.clientName || '—';
  const statusLabels = { new: 'Novo', waiting: 'Aguardando', attending: 'Atendendo', resolved: 'Resolvido' };
  document.getElementById('cp-status').textContent = statusLabels[t.crmStatus] || '—';
  const lastAt = t.lastMessageAt || t.updatedAt;
  document.getElementById('cp-last').textContent = lastAt ? new Date(lastAt).toLocaleString('pt-BR') : '—';

  // Silence
  const sil = document.getElementById('cp-silence');
  if (t.lastMessageAt && t.lastDirection === 'inbound') {
    const h = (Date.now() - new Date(t.lastMessageAt).getTime()) / 3600000;
    if (h > 1) {
      sil.textContent = h < 24 ? `${Math.round(h)}h` : `${Math.floor(h/24)}d ${Math.round(h%24)}h`;
    } else {
      sil.textContent = 'Recente';
    }
  } else {
    sil.textContent = '—';
  }
}

async function loadCpTasks(leadId) {
  try {
    const res = await fetch(`/api/crm/tasks?leadId=${leadId}`, { headers: { Authorization: `Bearer ${crmToken()}` } });
    const tasks = await res.json();
    const container = document.getElementById('cp-tasks');
    if (!tasks.length) { container.innerHTML = '<div style="font-size:.78rem;color:var(--muted)">Sem tarefas</div>'; return; }
    container.innerHTML = tasks.map(t => `
      <div style="font-size:.8rem;padding:.3rem 0;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:.4rem">
        <span style="color:${t.completed ? 'var(--muted2)' : 'var(--cyan)'}">●</span>
        <span style="${t.completed ? 'text-decoration:line-through;color:var(--muted)' : ''}">${escapeHtml(t.title)}</span>
        ${t.dueAt ? `<span style="color:var(--muted2);margin-left:auto">${new Date(t.dueAt).toLocaleDateString('pt-BR')}</span>` : ''}
      </div>`).join('');
  } catch (_) {}
}

async function crmUpdateStatus(status) {
  if (!crmActiveTicket) return;
  try {
    await fetch(`/api/crm/tickets/${crmActiveTicket.id}/status`, {
      method: 'PUT', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ crmStatus: status })
    });
    crmActiveTicket.crmStatus = status;
    crmLoadStats();
    crmLoadTickets();
  } catch (_) {}
}

function crmCheckQuickReply(el) {
  const val = el.value;
  const suggestions = document.getElementById('crm-qr-suggestions');
  // Auto-resize textarea
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';

  if (val.startsWith('/') && val.length > 1) {
    const query = val.slice(1).toLowerCase();
    const matches = crmAllQuickReplies.filter(q => q.shortcut.toLowerCase().startsWith(query));
    if (matches.length) {
      suggestions.classList.remove('hidden');
      suggestions.innerHTML = matches.map(q =>
        `<span class="crm-qr-chip" onclick="crmInsertQuickReply('${escapeHtml(q.content).replace(/'/g,"&#39;")}')">
          <span class="crm-qr-chip-shortcut">/${escapeHtml(q.shortcut)}</span>
          <span style="color:var(--muted);font-size:.76rem">— ${escapeHtml(q.content.slice(0,30))}${q.content.length>30?'…':''}</span>
        </span>`
      ).join('');
      return;
    }
  }
  suggestions.classList.add('hidden');
  suggestions.innerHTML = '';
}

function crmInsertQuickReply(content) {
  const input = document.getElementById('crm-msg-input');
  input.value = content;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  document.getElementById('crm-qr-suggestions').classList.add('hidden');
  input.focus();
}

function crmMsgKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    crmSendMessage();
  }
}

async function crmSendMessage() {
  if (!crmActiveTicket) return;
  const input = document.getElementById('crm-msg-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  input.style.height = 'auto';

  // Mostra imediatamente no chat (otimista)
  const container = document.getElementById('crm-messages');
  if (container) {
    const now = new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    container.innerHTML += `
      <div class="crm-msg outbound crm-msg-sending">
        <div class="crm-msg-bubble">${escapeHtml(msg)}</div>
        <div class="crm-msg-time">${now}</div>
      </div>`;
    container.scrollTop = container.scrollHeight;
  }

  try {
    await fetch('/api/crm/send', {
      method: 'POST', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: crmActiveTicket.id, message: msg })
    });
    // Recarrega do servidor para confirmar e pegar timestamp real
    crmLoadMessages(crmActiveTicket.id);
    crmLoadTickets();
  } catch (e) {
    showToast('Erro ao enviar mensagem');
    // Remove o otimista em caso de erro
    const sending = container?.querySelector('.crm-msg-sending');
    if (sending) sending.remove();
  }
}

function crmToggleContact() {
  const panel = document.getElementById('crm-contact-panel');
  panel.classList.toggle('hidden');
  panel.classList.toggle('active-mobile');
}

function crmBackToList() {
  document.getElementById('crm-ticket-list').classList.remove('hidden-mobile');
  document.getElementById('crm-chat-area').classList.remove('active-mobile');
  document.getElementById('crm-contact-panel').classList.add('hidden');
  document.getElementById('crm-contact-panel').classList.remove('active-mobile');
}

// ── KANBAN ──
let _kanbanDragId = null;

function crmRenderKanban() {
  const cols = { new: [], waiting: [], attending: [], resolved: [] };
  crmTickets.forEach(t => {
    const s = t.crmStatus || 'new';
    if (cols[s]) cols[s].push(t);
  });
  ['new', 'waiting', 'attending', 'resolved'].forEach(s => {
    const col = document.getElementById(`k-col-${s}`);
    const count = document.getElementById(`k-count-${s}`);
    if (!col) return;
    count.textContent = cols[s].length;

    // Drag-and-drop handlers on the column drop zone
    col.ondragover = e => { e.preventDefault(); col.classList.add('kanban-drag-over'); };
    col.ondragleave = () => col.classList.remove('kanban-drag-over');
    col.ondrop = async e => {
      e.preventDefault();
      col.classList.remove('kanban-drag-over');
      const id = Number(_kanbanDragId);
      if (!id) return;
      // Optimistic: update local state immediately
      const ticket = crmTickets.find(t => t.id === id);
      if (ticket && ticket.crmStatus !== s) {
        ticket.crmStatus = s;
        crmRenderKanban();
        try {
          await fetch(`/api/crm/tickets/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${crmToken()}` },
            body: JSON.stringify({ crmStatus: s }),
          });
        } catch (_) {
          showToast('Erro ao mover card');
          crmLoadTickets();
        }
      }
    };

    col.innerHTML = cols[s].map(t => {
      const name = t.name || t.phone || '—';
      const preview = t.lastMessage ? t.lastMessage.slice(0, 40) : '';
      const ts = t.lastMessageAt || t.createdAt;
      return `<div class="crm-kanban-card" draggable="true"
        data-id="${t.id}"
        ondragstart="_kanbanDragId='${t.id}';this.classList.add('kanban-dragging')"
        ondragend="this.classList.remove('kanban-dragging')"
        onclick="crmSelectTicket(${t.id});switchCrmTab('chats',document.querySelector('[data-tab=chats]'))">
        <div class="crm-kanban-card-name">${escapeHtml(name)}</div>
        ${preview ? `<div class="crm-kanban-card-preview">${escapeHtml(preview)}</div>` : ''}
        <div class="crm-kanban-card-time">${ts ? crmFormatTime(ts) : ''}</div>
      </div>`;
    }).join('') || '<div class="crm-kanban-empty">Vazio</div>';
  });
}

// ── TAB SWITCHER ──
function switchCrmTab(tab, btn) {
  document.querySelectorAll('.crm-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.crm-tab-content').forEach(c => c.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById(`crm-tab-${tab}`).classList.remove('hidden');

  if (tab === 'tasks')        loadCrmTasks();
  if (tab === 'appointments') {
    loadCrmAppointments();
    // Limpa badge de notificação ao abrir a aba
    const badge = document.getElementById('crm-appt-tab-badge');
    if (badge) badge.classList.add('hidden');
  }
  if (tab === 'quick-replies') loadCrmQuickReplies();
}

// ── TASKS ──
async function loadCrmTasks() {
  try {
    const showCompleted = document.getElementById('crm-tasks-show-completed')?.checked;
    const params = new URLSearchParams();
    if (crmCurrentClientId) params.set('clientId', crmCurrentClientId);
    if (!showCompleted) params.set('completed', 'false');
    const res = await fetch(`/api/crm/tasks?${params}`, { headers: { Authorization: `Bearer ${crmToken()}` } });
    const tasks = await res.json();
    crmTasksCache = tasks;
    const container = document.getElementById('crm-tasks-list');
    if (!tasks.length) { container.innerHTML = '<div style="color:var(--muted);font-size:.85rem;padding:1rem">Nenhuma tarefa</div>'; return; }
    container.innerHTML = tasks.map(t => {
      const due = t.dueAt ? new Date(t.dueAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : null;
      const overdue = t.dueAt && !t.completed && new Date(t.dueAt) < new Date();
      return `<div class="crm-task-item ${t.completed ? 'done' : ''}">
        <input type="checkbox" class="crm-task-check" ${t.completed ? 'checked' : ''} onchange="crmToggleTask(${t.id},this.checked)" />
        <div class="crm-task-body">
          <div class="crm-task-title">${escapeHtml(t.title)}</div>
          <div class="crm-task-meta">
            ${t.leadName ? `${escapeHtml(t.leadName)}` : ''}
            ${due ? `<span style="color:${overdue ? 'var(--danger)' : 'var(--muted)'}">${due}${overdue ? ' (atrasado)' : ''}</span>` : ''}
            ${t.description ? `<span style="margin-left:.5rem">— ${escapeHtml(t.description.slice(0,60))}</span>` : ''}
          </div>
        </div>
        <div class="crm-task-actions">
          <button class="btn-sm btn-edit" onclick="openCrmTaskModal(${t.id})">Editar</button>
          <button class="btn-sm" style="color:var(--danger)" onclick="deleteCrmTask(${t.id})">Excluir</button>
        </div>
      </div>`;
    }).join('');
  } catch (_) {}
}

async function crmToggleTask(id, completed) {
  const task = crmTasksCache.find(t => t.id === id);
  if (!task) { loadCrmTasks(); return; }
  await fetch(`/api/crm/tasks/${id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: task.title, description: task.description, dueAt: task.dueAt, completed })
  });
  loadCrmTasks();
}

async function deleteCrmTask(id) {
  if (!confirm('Excluir tarefa?')) return;
  await fetch(`/api/crm/tasks/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${crmToken()}` } });
  loadCrmTasks();
}

let _crmEditTaskId = null;
async function openCrmTaskModal(taskId) {
  _crmEditTaskId = taskId || null;
  const modal = document.getElementById('crm-task-modal');
  document.getElementById('crm-task-modal-title').textContent = taskId ? 'Editar Tarefa' : 'Nova Tarefa';
  // Populate lead dropdown
  const sel = document.getElementById('crm-task-lead');
  sel.innerHTML = '<option value="">— Nenhum —</option>';
  crmTickets.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = (t.name || t.phone || `#${t.id}`);
    sel.appendChild(o);
  });
  if (crmActiveTicket) sel.value = crmActiveTicket.id;

  if (taskId) {
    const task = crmTasksCache.find(t => t.id === taskId);
    if (task) {
      document.getElementById('crm-task-title').value = task.title || '';
      document.getElementById('crm-task-desc').value  = task.description || '';
      document.getElementById('crm-task-due').value   = task.dueAt ? task.dueAt.slice(0,16) : '';
      if (task.leadId) sel.value = task.leadId;
    }
  } else {
    document.getElementById('crm-task-form').reset();
    if (crmActiveTicket) sel.value = crmActiveTicket.id;
  }
  modal.classList.remove('hidden');
}
function closeCrmTaskModal() { document.getElementById('crm-task-modal').classList.add('hidden'); }
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('crm-task-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const title = document.getElementById('crm-task-title').value.trim();
    const description = document.getElementById('crm-task-desc').value.trim();
    const dueAt = document.getElementById('crm-task-due').value;
    const leadId = document.getElementById('crm-task-lead').value;
    const body = { title, description, dueAt, leadId, clientId: crmCurrentClientId };
    if (_crmEditTaskId) {
      await fetch(`/api/crm/tasks/${_crmEditTaskId}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, dueAt, completed: false })
      });
    } else {
      await fetch('/api/crm/tasks', {
        method: 'POST', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
    closeCrmTaskModal();
    loadCrmTasks();
    if (crmActiveTicket) loadCpTasks(crmActiveTicket.id);
  });
});

// ── APPOINTMENTS ──
let crmApptFilter = 'active'; // 'active' | 'cancelled'
let crmApptNotifSince = new Date().toISOString(); // timestamp da última verificação
let crmApptNotifTimer = null;

function crmSetApptFilter(status, btn) {
  crmApptFilter = status;
  document.querySelectorAll('.crm-appt-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadCrmAppointments();
}

async function loadCrmAppointments() {
  try {
    const params = new URLSearchParams();
    if (crmCurrentClientId) params.set('clientId', crmCurrentClientId);
    if (crmApptFilter === 'cancelled') params.set('status', 'cancelled');
    const res = await fetch(`/api/crm/appointments?${params}`, { headers: { Authorization: `Bearer ${crmToken()}` } });
    const appts = await res.json();
    const container = document.getElementById('crm-appointments-list');
    if (!appts.length) { container.innerHTML = '<div style="color:var(--muted);font-size:.85rem;padding:1.5rem 0">Nenhum agendamento</div>'; return; }
    container.innerHTML = appts.map(a => {
      const dt = a.scheduledAt ? new Date(a.scheduledAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
      const isPast = a.scheduledAt && new Date(a.scheduledAt) < new Date();
      const isCancelled = a.status === 'cancelled';
      const statusLabel = isCancelled ? 'Cancelado' : a.detectedBy === 'ai' ? 'IA' : 'Manual';
      return `<div class="crm-appt-item${isCancelled ? ' cancelled' : ''}">
        <div class="crm-appt-body">
          <div class="crm-appt-title">${escapeHtml(a.title)}</div>
          <div class="crm-appt-meta">
            ${a.leadName ? `${escapeHtml(a.leadName)} · ` : ''}
            <span style="color:${isCancelled ? 'var(--muted)' : isPast ? 'var(--danger)' : 'var(--cyan)'}">${dt}</span>
            ${a.notes ? ` — ${escapeHtml(a.notes.slice(0,80))}` : ''}
          </div>
        </div>
        <span class="crm-appt-badge${isCancelled ? ' cancelled' : ''}">${statusLabel}</span>
        ${!isCancelled ? `
          <button class="btn-sm btn-edit" style="margin-left:.5rem;font-size:.75rem" onclick="crmRescheduleAppt(${a.id})">Remarcar</button>
          <button class="btn-sm" style="color:var(--warning);margin-left:.25rem;font-size:.75rem" onclick="crmCancelAppt(${a.id})">Cancelar</button>
        ` : ''}
        <button class="btn-sm" style="color:var(--danger);margin-left:.25rem;font-size:.75rem" onclick="deleteCrmAppt(${a.id})">Excluir</button>
      </div>`;
    }).join('');
  } catch (_) {}
}

async function crmCancelAppt(id) {
  if (!confirm('Cancelar este agendamento?')) return;
  await fetch(`/api/crm/appointments/${id}/status`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' })
  });
  loadCrmAppointments();
  showToast('Agendamento cancelado');
}

async function crmRescheduleAppt(id) {
  const newDate = prompt('Nova data e hora (ex: 2025-05-10T14:00):');
  if (!newDate) return;
  const dt = new Date(newDate);
  if (isNaN(dt)) { showToast('Data inválida'); return; }
  await fetch(`/api/crm/appointments/${id}/status`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed', scheduledAt: dt.toISOString() })
  });
  loadCrmAppointments();
  showToast('Agendamento remarcado');
}

async function deleteCrmAppt(id) {
  if (!confirm('Excluir agendamento permanentemente?')) return;
  await fetch(`/api/crm/appointments/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${crmToken()}` } });
  loadCrmAppointments();
}

// ── Polling de notificações de agendamento (verifica a cada 30s) ──
function crmStartApptNotifPolling() {
  crmApptNotifSince = new Date().toISOString();
  if (crmApptNotifTimer) clearInterval(crmApptNotifTimer);
  crmApptNotifTimer = setInterval(crmCheckApptNotifs, 30000);
}

async function crmCheckApptNotifs() {
  try {
    const params = new URLSearchParams({ since: crmApptNotifSince });
    if (crmCurrentClientId) params.set('clientId', crmCurrentClientId);
    const res = await fetch(`/api/crm/appointments/notify?${params}`, { headers: { Authorization: `Bearer ${crmToken()}` } });
    const data = await res.json();
    if (data.count > 0) {
      crmApptNotifSince = new Date().toISOString();
      // Mostra badge na aba
      const badge = document.getElementById('crm-appt-tab-badge');
      if (badge) { badge.textContent = data.count; badge.classList.remove('hidden'); }
      // Toast para cada mudança
      data.items.forEach(item => {
        const dt = item.scheduledAt ? new Date(item.scheduledAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
        const msg = item.status === 'cancelled'
          ? `Cancelamento: ${item.leadName || 'Lead'} — ${item.title}`
          : `Agendamento: ${item.leadName || 'Lead'} — ${item.title}${dt ? ' · ' + dt : ''}`;
        showToast(msg, 6000);
      });
      // Recarrega lista se a aba estiver visível
      if (!document.getElementById('crm-tab-appointments')?.classList.contains('hidden')) {
        loadCrmAppointments();
      }
    }
  } catch (_) {}
}

function openCrmApptModal() {
  const modal = document.getElementById('crm-appt-modal');
  document.getElementById('crm-appt-form').reset();
  const sel = document.getElementById('crm-appt-lead');
  sel.innerHTML = '<option value="">— Nenhum —</option>';
  crmTickets.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = (t.name || t.phone || `#${t.id}`);
    sel.appendChild(o);
  });
  if (crmActiveTicket) sel.value = crmActiveTicket.id;
  modal.classList.remove('hidden');
}
function closeCrmApptModal() { document.getElementById('crm-appt-modal').classList.add('hidden'); }
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('crm-appt-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const title = document.getElementById('crm-appt-title').value.trim();
    const scheduledAt = document.getElementById('crm-appt-date').value;
    const notes = document.getElementById('crm-appt-notes').value.trim();
    const leadId = document.getElementById('crm-appt-lead').value;
    await fetch('/api/crm/appointments', {
      method: 'POST', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, scheduledAt, notes, leadId, clientId: crmCurrentClientId })
    });
    closeCrmApptModal();
    loadCrmAppointments();
  });
});

// ── QUICK REPLIES ──
async function loadCrmQuickReplies() {
  try {
    const qs = crmCurrentClientId ? `?clientId=${crmCurrentClientId}` : '';
    const res = await fetch(`/api/crm/quick-replies${qs}`, { headers: { Authorization: `Bearer ${crmToken()}` } });
    crmAllQuickReplies = await res.json();
    const container = document.getElementById('crm-qr-list');
    if (!container) return;
    if (!crmAllQuickReplies.length) { container.innerHTML = '<div style="color:var(--muted);font-size:.85rem;padding:1rem">Nenhuma resposta rápida cadastrada</div>'; return; }
    container.innerHTML = crmAllQuickReplies.map(q => `
      <div class="crm-qr-item">
        <span class="crm-qr-shortcut">/${escapeHtml(q.shortcut)}</span>
        <span class="crm-qr-body">${escapeHtml(q.content)}</span>
        <button class="btn-sm" style="color:var(--danger)" onclick="deleteCrmQr(${q.id})">Excluir</button>
      </div>`).join('');
  } catch (_) {}
}

async function deleteCrmQr(id) {
  if (!confirm('Excluir resposta rápida?')) return;
  await fetch(`/api/crm/quick-replies/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${crmToken()}` } });
  loadCrmQuickReplies();
}

function openCrmQrModal() {
  document.getElementById('crm-qr-form').reset();
  document.getElementById('crm-qr-modal').classList.remove('hidden');
}
function closeCrmQrModal() { document.getElementById('crm-qr-modal').classList.add('hidden'); }
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('crm-qr-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const shortcut = document.getElementById('crm-qr-shortcut').value.trim();
    const content  = document.getElementById('crm-qr-content').value.trim();
    await fetch('/api/crm/quick-replies', {
      method: 'POST', headers: { Authorization: `Bearer ${crmToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortcut, content, clientId: crmCurrentClientId || null })
    });
    closeCrmQrModal();
    loadCrmQuickReplies();
  });
});

// ─── Silence auto-reply ────────────────────────────────────────────────────────
// (future feature — to be implemented server-side)

async function initReportsPage() {
  // Set default date range: last 30 days
  const now = new Date();
  const d30 = new Date(now - 30 * 86400000);
  document.getElementById('report-end').value   = now.toISOString().slice(0, 10);
  document.getElementById('report-start').value = d30.toISOString().slice(0, 10);

  // Populate client dropdown
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/clients', { headers: { 'Authorization': `Bearer ${token}` } });
    const clients = await res.json();
    const sel = document.getElementById('report-client');
    if (Array.isArray(clients)) {
      clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        sel.appendChild(opt);
      });
    }
  } catch (_) {}

  await loadReports();
}
