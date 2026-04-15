const crypto = require('crypto');

const META_API_VERSION = 'v19.0';

function sha256(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

/**
 * Dispara evento de Purchase na Meta Conversions API
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
 */
async function sendPurchaseEvent({ pixelId, accessToken, value, currency = 'BRL', phone, email, name, sourceUrl }) {
  // Remove espaços do pixelId (erro comum ao copiar do Meta)
  pixelId = String(pixelId).replace(/\s/g, '');

  if (!pixelId || !accessToken) {
    console.warn('[MetaPixel] pixelId ou accessToken não configurados — evento não enviado');
    return null;
  }

  // Monta user_data com dados hasheados (obrigatório pela Meta)
  const userData = {};
  const phoneClean = phone ? phone.replace(/\D/g, '') : null;
  if (phoneClean) userData.ph = [sha256(phoneClean)];
  if (email) userData.em = [sha256(email)];
  if (name) {
    const parts = name.trim().split(' ');
    userData.fn = [sha256(parts[0])];
    if (parts.length > 1) userData.ln = [sha256(parts.slice(1).join(' '))];
  }

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_source_url: sourceUrl || 'https://loja.com',
        user_data: userData,
        custom_data: {
          currency,
          value: parseFloat(value) || 0,
        },
      },
    ],
  };

  try {
    const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json();

    if (res.ok) {
      console.log(`[MetaPixel] Purchase disparado — Pixel ${pixelId} | R$ ${value} | events_received: ${json.events_received}`);
    } else {
      console.error('[MetaPixel] Erro:', JSON.stringify(json.error || json));
    }

    return json;
  } catch (err) {
    console.error('[MetaPixel] Falha na requisição:', err.message);
    return null;
  }
}

module.exports = { sendPurchaseEvent };
