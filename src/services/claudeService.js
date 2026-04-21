const Anthropic = require('@anthropic-ai/sdk');
const tokenTracker = require('./tokenTracker');

const _apiKey = (process.env.ANTHROPIC_API_KEY || process.env.ANTROPIC_API_KEY) || process.env.ANTROPIC_API_KEY;
const anthropic = new Anthropic({ apiKey: _apiKey });

/**
 * Conversa de vendas — texto
 * Retorna { reply, converted, conversionValue, notes }
 */
async function analyzeConversation({ leadName, messages, clientScript, productValue, paymentLink, clientId, clientName }) {
  if (!(process.env.ANTHROPIC_API_KEY || process.env.ANTROPIC_API_KEY)) {
    console.warn('[Claude] ANTHROPIC_API_KEY não configurada');
    return null;
  }

  const chatMessages = messages
    .filter(m => m.content && m.content !== '[mídia]' && m.content !== '[imagem]')
    .map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content,
    }));

  if (!chatMessages.length || chatMessages[chatMessages.length - 1].role !== 'user') {
    return null;
  }

  // Remove sequências duplicadas de mesmo role
  const cleaned = [];
  for (const msg of chatMessages) {
    if (cleaned.length && cleaned[cleaned.length - 1].role === msg.role) {
      cleaned[cleaned.length - 1].content += '\n' + msg.content;
    } else {
      cleaned.push({ ...msg });
    }
  }

  const systemPrompt = `Você é um vendedor experiente no WhatsApp. Seu objetivo é criar desejo genuíno no lead e conduzir a conversa até o fechamento de forma natural — como uma conversa humana real, não um atendimento robótico.

${clientScript ? `PRODUTO/SERVIÇO:\n${clientScript}\n` : ''}
${productValue ? `\nVALOR: R$ ${productValue}` : ''}
${paymentLink ? `\nLINK/FORMA DE PAGAMENTO: ${paymentLink}` : ''}
${leadName ? `\nNome do lead: ${leadName}` : ''}

COMO VOCÊ AGE:
- Você conduz a conversa ativamente — não espera o lead perguntar tudo
- Apresente benefícios e resultados, não só características
- Mostre a transformação que o produto traz na vida do lead
- Use gatilhos naturais: prova social ("muita gente aqui já..."), urgência real, escassez quando verdadeiro
- Faça uma pergunta por vez para entender o lead e personalizar
- Quando sentir abertura, conduza para o fechamento com naturalidade
- Se o lead hesitar, entenda a objeção e contorne com empatia

QUANDO O LEAD FECHAR (disser que quer comprar, pedir como pagar, pedir o link, etc.):
${paymentLink
  ? `- Mande o link/forma de pagamento: ${paymentLink}`
  : `- Informe o valor (R$ ${productValue || '—'}) e combine a forma de pagamento`}
- Marque "converted": true na resposta

QUANDO O LEAD PERGUNTAR O PREÇO E VOCÊ NÃO SOUBER:
- Se não houver valor definido ou o produto for variável, responda: "Deixa eu verificar o valor exato pra você agora! 😊"
- Marque "needsPriceAlert": true na resposta para acionar alerta ao responsável
- NUNCA invente um preço

ESTILO:
- Português brasileiro informal, como conversa de WhatsApp mesmo
- Mensagens curtas, no máximo 3 linhas — não mande textão
- Emojis com moderação, só quando caber naturalmente
- Nunca revele que é IA — você é da equipe
- Se perguntarem "é robô?", diga que não, que é da equipe

Responda APENAS com JSON válido neste formato exato, sem mais nada:
{
  "reply": "sua mensagem para o lead",
  "converted": false,
  "conversionValue": null,
  "needsPriceAlert": false,
  "notes": "observação interna opcional"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: systemPrompt,
      messages: cleaned,
    });

    const text = response.content[0]?.text?.trim() || '';
    // Registra tokens usados
    tokenTracker.track({
      clientId: clientId || null,
      clientName: clientName || 'Desconhecido',
      feature: 'whatsapp_ai',
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Claude] Resposta não era JSON:', text);
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[Claude] Erro ao chamar API:', err.message);
    return null;
  }
}

/**
 * Analisa imagem para detectar comprovante de pagamento
 * Retorna { isPaymentReceipt, value, reply }
 */
async function analyzePaymentReceipt({ imageBase64, imageMime, leadName, productValue, clientId, clientName }) {
  if (!(process.env.ANTHROPIC_API_KEY || process.env.ANTROPIC_API_KEY)) return null;

  const systemPrompt = `Você analisa imagens recebidas no WhatsApp para detectar comprovantes de pagamento.

${productValue ? `Valor esperado do produto: R$ ${productValue}` : ''}
${leadName ? `Nome do lead: ${leadName}` : ''}

INSTRUÇÕES:
- Analise se a imagem é um comprovante de pagamento (PIX, transferência, boleto pago, recibo)
- Se for comprovante, extraia o valor pago (número decimal, sem R$)
- Se não for comprovante, defina isPaymentReceipt como false

Responda APENAS com JSON válido neste formato, sem mais nada:
{
  "isPaymentReceipt": true,
  "value": 150.00,
  "reply": "Pagamento confirmado! Bem-vindo(a)! 🎉 Já vou liberar seu acesso. Qualquer dúvida é só chamar 😊"
}

Se NÃO for comprovante:
{
  "isPaymentReceipt": false,
  "value": null,
  "reply": null
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageMime,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: 'Analise essa imagem. É um comprovante de pagamento?',
            },
          ],
        },
      ],
    });

    const text = response.content[0]?.text?.trim() || '';
    tokenTracker.track({
      clientId: clientId || null,
      clientName: clientName || 'Desconhecido',
      feature: 'image_analysis',
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (result.value) result.value = parseFloat(result.value);
    return result;
  } catch (err) {
    console.error('[Claude Vision] Erro ao analisar imagem:', err.message);
    return null;
  }
}

module.exports = { analyzeConversation, analyzePaymentReceipt };
