# Yide Vibe — Sistema de Rastreamento de Leads

## O que é este projeto
SaaS multi-cliente de gestão de leads, IA de vendas via WhatsApp, relatórios de anúncios e rastreamento de conversões. Frontend em HTML/CSS/JS puro, backend Node.js + Express, banco PostgreSQL no Railway.

---

## Links essenciais
- **Produção:** https://rastreamento-leads-production.up.railway.app
- **GitHub:** https://github.com/lucasdias1122334455-collab/rastreamento-leads
- **Railway (deploy + banco + env vars):** https://railway.app
- **Evolution API (WhatsApp):** https://distinguished-comfort-production.up.railway.app
- **Login padrão:** admin@sistema.com / admin123

---

## Stack técnica
- **Backend:** Node.js + Express
- **ORM:** Prisma (sem schema.prisma — usa `$executeRawUnsafe` e `$queryRawUnsafe`)
- **Banco:** PostgreSQL (Railway) — tabelas criadas automaticamente no `src/app.js` no boot
- **Frontend:** SPA em HTML/CSS/JS puro (sem React/Vue)
- **Charts:** Chart.js 4.4 via CDN
- **IA:** Anthropic Claude API (claude-3-5-haiku / claude-3-5-sonnet)
- **WhatsApp:** Evolution API (multi-instância por cliente)
- **Deploy:** Railway (auto-deploy ao push na branch `main`)

---

## Setup no notebook

### 1. Pré-requisitos
- Node.js LTS → https://nodejs.org
- Git → https://git-scm.com

### 2. Clonar e instalar
```bash
git clone https://github.com/lucasdias1122334455-collab/rastreamento-leads.git
cd rastreamento-leads
npm install
```

### 3. Criar arquivo `.env` na raiz
```env
DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DB
JWT_SECRET=qualquer_string_secreta
REPORTS_API_KEY=yide2024reports
ANTHROPIC_API_KEY=sk-ant-...
EVOLUTION_API_URL=https://distinguished-comfort-production.up.railway.app
EVOLUTION_API_KEY=evolution_key_123
WEBHOOK_URL=https://rastreamento-leads-production.up.railway.app/api/whatsapp/webhook
```
> Pegar os valores reais no painel do Railway → projeto → Variables

### 4. Rodar local
```bash
npm start
# Servidor sobe em http://localhost:3000
# Tabelas criadas automaticamente no primeiro boot
```

---

## Estrutura de arquivos
```
rastreamento-leads/
├── frontend/
│   ├── index.html              ← SPA completa (toda a UI)
│   ├── assets/css/style.css    ← estilos + dark mode + @media print
│   └── assets/js/app.js        ← toda lógica frontend (1500+ linhas)
└── src/
    ├── app.js                  ← servidor Express + criação de tabelas no boot
    ├── config/database.js      ← instância Prisma singleton
    ├── middleware/
    │   ├── auth.js             ← JWT authenticate + requireAdmin
    │   └── errorHandler.js
    ├── routes/
    │   ├── auth.js             ← POST /api/auth/login, /register, /me
    │   ├── leads.js            ← CRUD leads + filtros
    │   ├── interactions.js     ← mensagens/notas por lead
    │   ├── clients.js          ← CRUD clientes (admin)
    │   ├── users.js            ← CRUD usuários (admin)
    │   ├── dashboard.js        ← stats, funnel, conversions, sales-list
    │   ├── whatsapp.js         ← status, QR, webhook Evolution API
    │   ├── conversations.js    ← conversas por lead
    │   ├── meta.js             ← webhook Meta Ads (leads do WhatsApp Business)
    │   ├── mercadopago.js      ← webhook MP por cliente (/api/mp/webhook/:clientId)
    │   ├── saleWebhook.js      ← webhook genérico de venda (/api/sale/webhook/:clientId)
    │   ├── instagram.js        ← webhook Instagram DM
    │   ├── aiAnalyst.js        ← chat IA com dados em tempo real
    │   ├── tokenUsage.js       ← rastreamento de custo por cliente (admin Portuga)
    │   ├── reports.js          ← /ads /daily /funnel /summary /channels
    │   └── tracking.js         ← links de rastreamento + redirect público
    └── controllers/
        ├── whatsappController.js     ← webhook WA + runAIAgent + runImageAgent
        ├── saleWebhookController.js  ← processa vendas Brendi/MP/qualquer site
        ├── dashboardController.js    ← stats + getConversionValues + sales-list
        ├── clientController.js       ← CRUD clientes
        ├── instagramController.js
        └── ...
    └── services/
        ├── claudeService.js          ← analyzeConversation + analyzePaymentReceipt
        ├── evolutionService.js       ← multi-instância WA
        └── metaConversionsService.js ← Pixel Purchase event
```

---

## Tabelas do banco (criadas no boot do app.js)
```sql
users               -- agentes e admins
clients             -- clientes do SaaS
leads               -- leads de todos os clientes
interactions        -- mensagens e notas dos leads
whatsapp_sessions   -- sessões WA (legado)
user_clients        -- relação usuário ↔ cliente
ad_spend            -- investimento por anúncio (manual)
token_usage         -- custo Claude por cliente (admin Portuga)
tracking_links      -- links de rastreamento de anúncios
tracking_clicks     -- cliques nos tracking links
```

### Colunas importantes nos leads
```
leads.source        -- whatsapp | whatsapp_meta | whatsapp_group | website | instagram | manual
leads.status        -- new | contacted | qualified | converted | lost
leads.stage         -- awareness | interest | consideration | decision | action
leads.value         -- valor da venda (NUMERIC)
leads.convertedAt   -- timestamp da conversão (adicionado via ALTER TABLE)
leads.tags          -- JSON string com adId, adName, adHeadline (Meta Ads)
```

---

## Deploy
**Automático via GitHub push:**
```bash
git add .
git commit -m "descrição"
git push origin main
# Railway detecta o push e faz deploy em ~2 min
```

---

## Variáveis de ambiente (Railway)
| Variável | Descrição |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Segredo para assinar tokens JWT |
| `REPORTS_API_KEY` | `yide2024reports` — acesso externo aos relatórios sem JWT |
| `ANTHROPIC_API_KEY` | Claude API |
| `EVOLUTION_API_URL` | URL da Evolution API (WhatsApp) |
| `EVOLUTION_API_KEY` | Chave da Evolution API |
| `WEBHOOK_URL` | URL pública do nosso webhook WA |

---

## Fluxo principal de um lead

### Via Meta Ads → WhatsApp
1. Pessoa clica no anúncio → manda mensagem no WhatsApp Business
2. Meta dispara webhook → `POST /api/meta/webhook`
3. Lead criado com `source: 'whatsapp_meta'` + tags com `adId`, `adHeadline`
4. IA Claude responde automaticamente (se `client.aiEnabled = true`)
5. Se enviar comprovante de pagamento → Claude analisa → converte automaticamente

### Via Link de Rastreamento → Brendi/Site
1. Criar link em **Links** no sistema
2. Colocar o link (`/rastrear/slug`) no anúncio do Meta no lugar da URL do site
3. Pessoa clica → nosso sistema registra o clique com a campanha → redireciona pro site
4. Pessoa compra no Brendi → Brendi dispara `POST /api/sale/webhook/:clientId`
5. Sistema busca o clique mais recente (últimas 24h) → atribui campanha ao lead
6. Aparece na tabela **Histórico de Vendas** com o nome da campanha

### Via Mercado Pago
1. Configurar no MP: `POST /api/mp/webhook/:clientId`
2. Aprovação de pagamento → lead convertido automaticamente
3. Confirmação enviada no WhatsApp

---

## Configuração de um cliente (modal Clientes)
| Campo | Descrição |
|---|---|
| Nome, Telefone, Email | Dados do cliente |
| Instance Name | Nome da instância no Evolution API (único) |
| Meta Phone Number ID | ID do número no WhatsApp Business |
| Meta Access Token | Token de acesso Meta |
| Pixel ID + Meta Conversions Token | Para disparar eventos Purchase no pixel |
| MP Access Token | Token Mercado Pago para webhook |
| AI Enabled | Liga/desliga a IA de vendas |
| AI Script | Roteiro de vendas para o Claude |
| Product Value | Valor padrão do produto (R$) |
| Payment Link | Link de pagamento enviado pela IA |
| Website | URL do site (usada no pixel) |
| Brendi Client ID + Secret | Credenciais para buscar pedidos Brendi |
| Instagram Token + Account ID | Para receber DMs do Instagram |

---

## URLs de webhook por cliente
```
WhatsApp:     https://rastreamento-leads-production.up.railway.app/api/whatsapp/webhook
Meta Ads:     https://rastreamento-leads-production.up.railway.app/api/meta/webhook
Mercado Pago: https://rastreamento-leads-production.up.railway.app/api/mp/webhook/{clientId}
Brendi/Site:  https://rastreamento-leads-production.up.railway.app/api/sale/webhook/{clientId}
Instagram:    https://rastreamento-leads-production.up.railway.app/api/instagram/webhook
```

---

## API de relatórios (acesso externo sem JWT)
```
GET /api/reports/summary?apiKey=yide2024reports&clientId=1&startDate=2025-01-01&endDate=2025-12-31
GET /api/reports/ads?apiKey=yide2024reports
GET /api/reports/daily?apiKey=yide2024reports
GET /api/reports/funnel?apiKey=yide2024reports
GET /api/reports/channels?apiKey=yide2024reports
# Adicionar &format=csv para exportar CSV
```

---

## Links de rastreamento
```
Criar link: Sistema → menu "Links" → + Novo Link
Uso no anúncio: https://rastreamento-leads-production.up.railway.app/rastrear/{slug}
Redirect: automático para o destino configurado (Brendi, site, etc.)
Atribuição: quando venda chega via webhook, sistema busca clique recente (24h) e atribui campanha ao lead
```

---

## Funcionalidades implementadas
- [x] Login JWT, roles admin/agent
- [x] Multi-cliente (cada cliente tem instância WhatsApp própria)
- [x] Gestão de leads com filtros, kanban de status
- [x] WhatsApp Business via Evolution API
- [x] IA de vendas Claude (texto + análise de comprovante de pagamento)
- [x] Webhook Meta Ads (leads do WhatsApp Business com atribuição de anúncio)
- [x] Webhook Mercado Pago por cliente
- [x] Webhook genérico de venda (Brendi + qualquer plataforma)
- [x] Instagram DM
- [x] Analista IA (chat com dados em tempo real)
- [x] Rastreamento de tokens/custo Claude por cliente
- [x] Página de Relatórios (KPIs, Chart.js, funil, por anúncio, por canal)
- [x] Export PDF dos relatórios (dark mode, window.print())
- [x] Histórico de vendas individuais (nome, telefone, canal, anúncio, valor)
- [x] Links de rastreamento com redirect e atribuição automática de campanha
- [x] Mobile responsive (bottom navbar)
- [x] Export CSV dos relatórios

---

## Atenção — Prisma sem schema
O projeto **não usa** `schema.prisma` para a maioria das tabelas novas. Novas colunas e tabelas são criadas via `ALTER TABLE` e `CREATE TABLE IF NOT EXISTS` no boot do `src/app.js`. Ao adicionar features que precisam de novas colunas, adicionar o SQL lá.

## Atenção — Frontend SPA
Todo o frontend está em um único `frontend/index.html` e `frontend/assets/js/app.js`. A navegação é feita pela função `navigateTo(page)` que mostra/esconde sections pelo id `page-{name}`. Para adicionar nova página: criar `<section id="page-X">` no HTML e adicionar `if (page === 'X') loadX()` no `navigateTo()`.
