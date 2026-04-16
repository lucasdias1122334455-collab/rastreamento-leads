const prisma = require('../config/database');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function chat(req, res, next) {
  try {
    const { message, clientId, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Gather real data from DB
    const where = clientId ? { clientId: Number(clientId) } : {};
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      totalLeads,
      convertedLeads,
      lostLeads,
      leadsLast7,
      leadsLast30,
      convertedLast7,
      convertedLast30,
      adGroups,
      clients,
    ] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: 'converted' } }),
      prisma.lead.count({ where: { ...where, status: 'lost' } }),
      prisma.lead.count({ where: { ...where, createdAt: { gte: sevenDaysAgo } } }),
      prisma.lead.count({ where: { ...where, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.lead.count({ where: { ...where, status: 'converted', updatedAt: { gte: sevenDaysAgo } } }),
      prisma.lead.count({ where: { ...where, status: 'converted', updatedAt: { gte: thirtyDaysAgo } } }),
      // Group by source/tags for ad performance
      prisma.lead.findMany({
        where: { ...where, source: 'whatsapp_meta' },
        select: { tags: true, status: true, value: true, createdAt: true },
      }),
      clientId ? [] : prisma.client.findMany({ select: { id: true, name: true } }),
    ]);

    // Ad-level breakdown
    const adStats = {};
    for (const lead of adGroups) {
      let adName = 'Meta Ads (sem título)';
      if (lead.tags) {
        try {
          const t = JSON.parse(lead.tags);
          adName = t.adHeadline || t.adId || adName;
        } catch (_) {}
      }
      if (!adStats[adName]) adStats[adName] = { leads: 0, converted: 0, revenue: 0 };
      adStats[adName].leads++;
      if (lead.status === 'converted') {
        adStats[adName].converted++;
        adStats[adName].revenue += lead.value || 0;
      }
    }

    // Ad spend data
    const adSpends = await prisma.adSpend.findMany({
      where: clientId ? { clientId: Number(clientId) } : {},
      orderBy: { date: 'desc' },
      take: 60,
    }).catch(() => []);

    const totalSpend30 = adSpends
      .filter(s => new Date(s.date) >= thirtyDaysAgo)
      .reduce((sum, s) => sum + (s.amount || 0), 0);

    const convRate30 = leadsLast30 > 0 ? ((convertedLast30 / leadsLast30) * 100).toFixed(1) : 0;
    const cpl30 = leadsLast30 > 0 && totalSpend30 > 0 ? (totalSpend30 / leadsLast30).toFixed(2) : null;
    const totalRevenue = convertedLeads > 0 ?
      (await prisma.lead.aggregate({ where: { ...where, status: 'converted' }, _sum: { value: true } }))._sum.value || 0
      : 0;
    const roas = totalSpend30 > 0 ? (totalRevenue / totalSpend30).toFixed(2) : null;

    // Instagram leads
    const igLeads = await prisma.lead.count({ where: { ...where, source: 'instagram' } });
    const igConverted = await prisma.lead.count({ where: { ...where, source: 'instagram', status: 'converted' } });

    const dataContext = `
## DADOS REAIS DO SISTEMA — ${new Date().toLocaleDateString('pt-BR')}
${clientId ? `Cliente: ${clientId}` : `Clientes no sistema: ${clients.length}`}

### Métricas Gerais
- Total de leads: ${totalLeads}
- Leads convertidos: ${convertedLeads} (${totalLeads > 0 ? ((convertedLeads/totalLeads)*100).toFixed(1) : 0}% taxa geral)
- Leads perdidos: ${lostLeads}
- Receita total registrada: R$ ${Number(totalRevenue).toFixed(2)}

### Últimos 7 dias
- Novos leads: ${leadsLast7}
- Conversões: ${convertedLast7}
- Taxa de conversão: ${leadsLast7 > 0 ? ((convertedLast7/leadsLast7)*100).toFixed(1) : 0}%

### Últimos 30 dias
- Novos leads: ${leadsLast30}
- Conversões: ${convertedLast30}
- Taxa de conversão: ${convRate30}%
- Investimento em anúncios: R$ ${totalSpend30.toFixed(2)}
${cpl30 ? `- CPL (Custo por Lead): R$ ${cpl30}` : '- CPL: sem dados de investimento'}
${roas ? `- ROAS estimado: ${roas}x` : '- ROAS: sem dados suficientes'}

### Performance por Anúncio (Meta Ads)
${Object.entries(adStats).length > 0 ?
  Object.entries(adStats)
    .sort((a, b) => b[1].converted - a[1].converted)
    .map(([name, s]) => `- "${name}": ${s.leads} leads, ${s.converted} convertidos (${s.leads > 0 ? ((s.converted/s.leads)*100).toFixed(1) : 0}% CVR), R$ ${s.revenue.toFixed(2)} receita`)
    .join('\n')
  : '- Nenhum dado de anúncio ainda'}

### Instagram DM
- Leads pelo Instagram: ${igLeads}
- Convertidos: ${igConverted} (${igLeads > 0 ? ((igConverted/igLeads)*100).toFixed(1) : 0}%)
`;

    const systemPrompt = `Você é um analista sênior especialista em Meta Ads, tráfego pago e otimização de conversões. Você tem 10+ anos de experiência gerenciando campanhas de alta performance no Facebook e Instagram Ads.

Seu papel é analisar os dados reais do sistema de rastreamento de leads do usuário e dar sugestões estratégicas e acionáveis — como um consultor sênior faria.

Características da sua análise:
- Direto ao ponto, sem enrolação
- Usa os dados reais fornecidos para embasar cada recomendação
- Identifica problemas e oportunidades específicas
- Sugere ações concretas (o que fazer, como fazer, por quê)
- Fala sobre CPL, ROAS, taxa de conversão, frequência, público, criativos, funil
- Usa linguagem profissional mas acessível
- Responde sempre em português brasileiro
- Quando os dados são insuficientes, pede informações específicas ou explica o que seria necessário
- Não fica só elogiando — aponta problemas reais quando existem

Você tem acesso aos seguintes dados em tempo real do sistema:
${dataContext}

Seja como aquele sócio especialista em tráfego que o usuário gostaria de ter no time.`;

    const messages = [
      ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const reply = response.content[0].text;
    res.json({ reply });
  } catch (err) {
    console.error('[AI Analyst] Erro:', err.message);
    next(err);
  }
}

module.exports = { chat };
