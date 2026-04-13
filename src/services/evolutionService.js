const axios = require('axios');

const BASE_URL = process.env.EVOLUTION_API_URL || 'https://distinguished-comfort-production.up.railway.app';
const API_KEY = process.env.EVOLUTION_API_KEY || 'evolution_key_123';
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'teste';

const headers = { apikey: API_KEY };

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

module.exports = { getStatus, getQRCode, sendMessage, disconnectInstance };
