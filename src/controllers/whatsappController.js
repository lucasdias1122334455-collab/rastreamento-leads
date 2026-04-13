const whatsappService = require('../services/whatsappService');

async function getStatus(req, res, next) {
  try {
    const status = whatsappService.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
}

async function connect(req, res, next) {
  try {
    await whatsappService.connect();
    res.json({ message: 'Iniciando conexão...' });
  } catch (err) {
    next(err);
  }
}

async function disconnect(req, res, next) {
  try {
    await whatsappService.disconnect();
    res.json({ message: 'Desconectado com sucesso' });
  } catch (err) {
    next(err);
  }
}

async function sendMessage(req, res, next) {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios' });
    }
    await whatsappService.sendMessage(phone, message);
    res.json({ message: 'Mensagem enviada' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStatus, connect, disconnect, sendMessage };
