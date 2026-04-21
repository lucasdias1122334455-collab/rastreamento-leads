const prisma = require('../config/database');

// Preços claude-sonnet-4-5 (USD por milhão de tokens)
const PRICE_INPUT  = 3.00;
const PRICE_OUTPUT = 15.00;

/**
 * Registra uso de tokens de uma chamada à API Claude.
 * @param {object} opts
 * @param {number|null} opts.clientId
 * @param {string}      opts.clientName
 * @param {string}      opts.feature  - ex: 'whatsapp_ai', 'ai_analyst', 'image_analysis'
 * @param {number}      opts.inputTokens
 * @param {number}      opts.outputTokens
 */
async function track({ clientId = null, clientName = 'Sistema', feature, inputTokens = 0, outputTokens = 0 }) {
  try {
    const costUsd = ((inputTokens * PRICE_INPUT) + (outputTokens * PRICE_OUTPUT)) / 1_000_000;
    await prisma.$executeRawUnsafe(`
      INSERT INTO token_usage ("clientId", "clientName", feature, "inputTokens", "outputTokens", "costUsd", date)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)
    `, clientId, clientName, feature, inputTokens, outputTokens, costUsd);
  } catch (e) {
    console.error('[TokenTracker] Erro ao registrar:', e.message);
  }
}

/**
 * Retorna resumo de uso por cliente no período.
 * @param {string} startDate  - YYYY-MM-DD
 * @param {string} endDate    - YYYY-MM-DD
 */
async function getSummary(startDate, endDate) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      "clientId",
      "clientName",
      SUM("inputTokens")::int  AS "totalInput",
      SUM("outputTokens")::int AS "totalOutput",
      SUM("costUsd")::numeric  AS "totalCostUsd",
      (SUM("costUsd") * 5.70)::numeric AS "totalCostBrl"
    FROM token_usage
    WHERE date BETWEEN $1 AND $2
    GROUP BY "clientId", "clientName"
    ORDER BY "totalCostUsd" DESC
  `, startDate, endDate);
  return rows;
}

/**
 * Retorna total geral do período.
 */
async function getTotal(startDate, endDate) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      SUM("inputTokens")::int  AS "totalInput",
      SUM("outputTokens")::int AS "totalOutput",
      SUM("costUsd")::numeric  AS "totalCostUsd",
      (SUM("costUsd") * 5.70)::numeric AS "totalCostBrl"
    FROM token_usage
    WHERE date BETWEEN $1 AND $2
  `, startDate, endDate);
  return rows[0];
}

module.exports = { track, getSummary, getTotal };
