const axios = require('axios');

const BASE_URL = process.env.EVOLUTION_API_URL || 'https://distinguished-comfort-production.up.railway.app';
const API_KEY = process.env.EVOLUTION_API_KEY || 'evolution_key_123';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://rastreamento-leads-production.up.railway.app/api/whatsapp/webhook';

const headers = { apikey: API_KEY };

// ─── Instância principal (legado) ────────────────────────────────────────────

const INSTANCE = process.env.EVOLUTION_INSTANCE || 'teste';

async function getStatus() {
  const { data } = await axios.get(`${BASE_URL}/instance/fetchInstances`, { headers });
  const inst = Array.isArray(data) ? data.find(i => i.instance.instanceName === INSTANCE) : null;
  if (!inst) return { status: 'disconnected', qrCode: null };
  const s = inst.instance.status;
  const status = s === 'open' ? 'connected' : s === 'connecting' ? 'connecting' : 'disconnected';
  const phone = inst.instance.owner ? inst.instance.owner.replace('@s.whatsapp.net', '') : null;
  return { status, qrCode: null, phone };
}

async function getQRCode() {
  const { data } = await axios.get(`${BASE_URL}/instance/connect/${INSTANCE}`, { headers });
  return data.base64 || null;
}

async function sendMessage(phone, text) {
  const number = phone.replace(/\D/g, '');
  await axios.post(`${BASE_URL}/message/sendText/${INSTANCE}`, { number, text }, { headers });
}

async function disconnectInstance() {
  await axios.delete(`${BASE_URL}/instance/logout/${INSTANCE}`, { headers });
}

// ─── Multi-cliente ────────────────────────────────────────────────────────────

async function createClientInstance(instanceName) {
  await axios.post(`${BASE_URL}/instance/create`, {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
  }, { headers });

  // Configura webhook automaticamente
  await axios.post(`${BASE_URL}/webhook/set/${instanceName}`, {
    url: WEBHOOK_URL,
    webhook_by_events: false,
    webhook_base64: false,
    events: ['MESSAGES_UPSERT'],
  }, { headers });
}

async function getClientQRCode(instanceName) {
  const { data } = await axios.get(`${BASE_URL}/instance/connect/${instanceName}`, { headers });
  return data.base64 || null;
}

async function getClientStatus(instanceName) {
  const { data } = await axios.get(`${BASE_URL}/instance/fetchInstances`, { headers });
  const inst = Array.isArray(data) ? data.find(i => i.instance.instanceName === instanceName) : null;
  if (!inst) return 'disconnected';
  const s = inst.instance.status;
  return s === 'open' ? 'connected' : s === 'connecting' ? 'connecting' : 'disconnected';
}

async function deleteClientInstance(instanceName) {
  try {
    await axios.delete(`${BASE_URL}/instance/logout/${instanceName}`, { headers });
  } catch (_) {}
  await axios.delete(`${BASE_URL}/instance/delete/${instanceName}`, { headers });
}

async function sendClientMessage(instanceName, phone, text) {
  const number = phone.replace(/\D/g, '');
  await axios.post(`${BASE_URL}/message/sendText/${instanceName}`, { number, text }, { headers });
}

async function getMediaBase64(instanceName, messageKey) {
  const { data } = await axios.post(
    `${BASE_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
    { message: { key: messageKey }, convertToMp4: false },
    { headers }
  );
  return data.base64 || null;
}

module.exports = {
  getStatus, getQRCode, sendMessage, disconnectInstance,
  createClientInstance, getClientQRCode, getClientStatus, deleteClientInstance, sendClientMessage, getMediaBase64,
};
