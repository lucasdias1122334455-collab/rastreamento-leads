const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const prisma = require('../config/database');

const SESSION_ID = 'default';
const AUTH_PATH = './whatsapp-auth';

let sock = null;
let currentStatus = 'disconnected';
let currentQR = null;
let userInitiatedDisconnect = false;

function clearAuthFiles() {
  try {
    if (fs.existsSync(AUTH_PATH)) {
      fs.readdirSync(AUTH_PATH).forEach((f) => fs.unlinkSync(path.join(AUTH_PATH, f)));
    }
  } catch (e) {
    console.error('[WhatsApp] Erro ao limpar arquivos de auth:', e.message);
  }
}

function getStatus() {
  return { status: currentStatus, qrCode: currentQR };
}

async function updateSessionInDB(status, qrCode = null, phone = null) {
  await prisma.whatsAppSession.upsert({
    where: { sessionId: SESSION_ID },
    update: { status, qrCode, phone },
    create: { sessionId: SESSION_ID, status, qrCode, phone },
  });
}

async function handleIncomingMessage(msg) {
  if (msg.key.fromMe) return;

  const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
  const content =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    '[mídia]';

  // Cria ou encontra o lead pelo telefone
  let lead = await prisma.lead.findUnique({ where: { phone } });
  if (!lead) {
    lead = await prisma.lead.create({
      data: { phone, source: 'whatsapp', status: 'new', stage: 'awareness' },
    });
  }

  // Registra a interação
  await prisma.interaction.create({
    data: {
      leadId: lead.id,
      type: 'message',
      direction: 'inbound',
      content,
      metadata: JSON.stringify({ rawMessage: msg }),
    },
  });

  console.log(`[WhatsApp] Mensagem recebida de ${phone}: ${content}`);
}

async function connect() {
  if (sock) return;

  currentStatus = 'connecting';
  await updateSessionInDB('connecting');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = await qrcode.toDataURL(qr);
      currentStatus = 'connecting';
      await updateSessionInDB('connecting', currentQR);
      console.log('[WhatsApp] QR Code gerado — escaneie no celular');
    }

    if (connection === 'open') {
      currentStatus = 'connected';
      currentQR = null;
      const phone = sock.user?.id?.split(':')[0] ?? null;
      await updateSessionInDB('connected', null, phone);
      console.log('[WhatsApp] Conectado:', phone);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const wasUserInitiated = userInitiatedDisconnect;
      userInitiatedDisconnect = false;

      sock = null;
      currentStatus = 'disconnected';
      currentQR = null;
      await updateSessionInDB('disconnected');

      if (reason === DisconnectReason.loggedOut) {
        if (wasUserInitiated) {
          console.log('[WhatsApp] Sessão encerrada pelo usuário');
        } else {
          // Sessão rejeitada pelo WhatsApp (expirada/inválida) — limpa credenciais e reconecta para gerar novo QR
          console.log('[WhatsApp] Sessão inválida — limpando credenciais e reconectando...');
          clearAuthFiles();
          setTimeout(connect, 2000);
        }
      } else {
        console.log('[WhatsApp] Reconectando...');
        setTimeout(connect, 5000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      await handleIncomingMessage(msg).catch(console.error);
    }
  });
}

async function disconnect() {
  if (sock) {
    userInitiatedDisconnect = true;
    await sock.logout();
    sock = null;
  }
  currentStatus = 'disconnected';
  currentQR = null;
  await updateSessionInDB('disconnected');
}

async function sendMessage(phone, text) {
  if (!sock || currentStatus !== 'connected') {
    throw new Error('WhatsApp não está conectado');
  }
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
}

module.exports = { getStatus, connect, disconnect, sendMessage };
