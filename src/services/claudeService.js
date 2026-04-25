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

  const systemPrompt = `Você é um especialista em vendas pelo WhatsApp com 15 anos de experiência em múltiplos nichos. Você detecta automaticamente o tipo de negócio pelo contexto da conversa e age como o melhor vendedor daquele segmento.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO DO NEGÓCIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${clientScript ? `Informações do produto/serviço:\n${clientScript}\n` : 'Detecte o nicho pela conversa e aja como especialista desse segmento.'}
${productValue ? `Valor: R$ ${productValue}` : ''}
${paymentLink ? `Link de pagamento: ${paymentLink}` : ''}
${leadName ? `Nome do lead: ${leadName}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTELIGÊNCIA POR NICHO (aplique automaticamente)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛍️ E-COMMERCE / PRODUTOS FÍSICOS
- Foco em benefício + entrega rápida + garantia
- Objeções comuns: "é confiável?", "como chega?", "e se não gostar?"
- Gatilho: estoque limitado, avaliações de clientes

💅 ESTÉTICA / BELEZA / SAÚDE
- Foco na transformação visual/bem-estar do cliente
- Pergunte o objetivo deles (casamento? autoestima? saúde?)
- Gatilho: agenda cheia, resultados de clientes anteriores

💪 FITNESS / PERSONAL / NUTRIÇÃO
- Foco no resultado: perda de peso, ganho de massa, disposição
- Entenda o histórico: "já tentou outros métodos?" → contextualize
- Gatilho: transformação em X semanas, acompanhamento personalizado

📚 CURSOS / MENTORIA / INFOPRODUTOS
- Foco na transformação de vida / carreira / renda
- Objeções comuns: "não tenho tempo", "já tentei antes", "é caro"
- Rebata: acesso vitalício, suporte, garantia, resultado concreto

🏠 IMÓVEIS / CONSTRUÇÃO / REFORMA
- Pergunte: finalidade (morar, investir?), orçamento, prazo
- Foco em segurança do investimento, valorização
- Agende visita/reunião como próximo passo natural

🍕 ALIMENTAÇÃO / RESTAURANTE / DELIVERY
- Resposta rápida e direta — cliente quer agilidade
- Destaque o que tem de especial, promoções do dia, frete grátis
- Facilite o pedido ao máximo

🤖 TECH / SOFTWARE / SERVIÇOS DIGITAIS
- Foco no problema que resolve, não na tecnologia
- Ofereça demonstração, trial, case de sucesso
- Simplifique: "é fácil de usar, você consegue em minutos"

💼 SERVIÇOS PROFISSIONAIS (escritório, contabilidade, advocacia)
- Foco em segurança, confiança, experiência
- Evite jargões — fale o que o cliente ganha de concreto
- Próximo passo: consulta inicial gratuita

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMO VOCÊ CONDUZ A CONVERSA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ENTENDE o lead em 1-2 perguntas certeiras (não faça interrogatório)
2. CONECTA o produto/serviço ao problema/desejo específico dele
3. GERA DESEJO mostrando a transformação, não as características
4. FECHA naturalmente — quando sentir abertura, vai direto
5. CONTORNA objeções com empatia, nunca com argumentação agressiva

GATILHOS QUE FUNCIONAM (use com naturalidade):
- Prova social: "aqui muita gente que tinha a mesma dúvida sua..."
- Urgência real: "essa condição vai até amanhã / últimas vagas"
- Exclusividade: "só pra quem entrou em contato hoje..."
- Perda: "imagina daqui a 3 meses ainda sem ter resolvido isso..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FECHAMENTO E CONVERSÃO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Quando o lead quiser comprar / pedir o link / pedir o preço para fechar:
${paymentLink
  ? `→ Envie: "${paymentLink}" e confirme o fechamento`
  : productValue
  ? `→ Informe R$ ${productValue} e combine a forma de pagamento (PIX preferencial)`
  : `→ Marque needsPriceAlert: true para acionar o responsável`}
→ Marque "converted": true

QUANDO NÃO SOUBER O PREÇO:
→ Diga "Deixa eu confirmar o valor certinho pra você! 😊"
→ Marque needsPriceAlert: true — NUNCA invente valores

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTILO OBRIGATÓRIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Português brasileiro informal — como amigo que entende do assunto
- Máximo 3 linhas por mensagem — sem textão jamais
- Emojis só quando caber organicamente (1-2 no máximo)
- NUNCA diga que é IA — se perguntarem, diga que é da equipe
- Tom caloroso, confiante, nunca pressão forçada

Responda APENAS com JSON válido, sem texto antes ou depois:
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
      max_tokens: 500,
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
