# Rastreamento de Leads — WhatsApp CRM

Sistema para capturar, organizar e rastrear leads gerados via WhatsApp.

## Funcionalidades

- Conexão com WhatsApp via QR Code (Baileys)
- Captura automática de leads ao receber mensagens
- Histórico completo de interações por lead
- Dashboard com métricas em tempo real
- Funil de vendas com status e etapas
- Autenticação JWT com perfis admin/agente

## Tecnologias

- **Backend**: Node.js + Express
- **Banco de dados**: SQLite via Prisma ORM
- **WhatsApp**: @whiskeysockets/baileys
- **Frontend**: HTML/CSS/JS vanilla

## Como usar

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Edite o .env e defina um JWT_SECRET seguro
```

### 3. Criar o banco e o usuário admin

```bash
npm run db:migrate    # cria as tabelas
npm run db:seed       # cria admin@sistema.com / admin123
```

### 4. Iniciar o servidor

```bash
npm run dev           # desenvolvimento (nodemon)
npm start             # produção
```

Acesse **http://localhost:3000** e faça login com:
- Email: `admin@sistema.com`
- Senha: `admin123`

### 5. Conectar o WhatsApp

Na aba **WhatsApp**, clique em **Conectar** e escaneie o QR Code.

## Estrutura do projeto

```
├── prisma/
│   ├── schema.prisma      # Modelos do banco
│   └── seed.js            # Dados iniciais
├── src/
│   ├── app.js             # Entry point
│   ├── config/            # Conexão com banco
│   ├── controllers/       # Lógica das rotas
│   ├── middleware/        # Auth e error handler
│   ├── routes/            # Definição de rotas
│   └── services/          # Serviço WhatsApp
├── frontend/
│   ├── index.html
│   └── assets/
│       ├── css/style.css
│       └── js/app.js
├── .env.example
└── package.json
```

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Dados do usuário logado |
| GET | /api/leads | Listar leads (paginado) |
| POST | /api/leads | Criar lead |
| PUT | /api/leads/:id | Atualizar lead |
| DELETE | /api/leads/:id | Excluir lead |
| GET | /api/leads/:id/interactions | Histórico de interações |
| POST | /api/leads/:id/interactions | Adicionar interação |
| GET | /api/whatsapp/status | Status da conexão |
| POST | /api/whatsapp/connect | Conectar WhatsApp |
| POST | /api/whatsapp/disconnect | Desconectar |
| POST | /api/whatsapp/send | Enviar mensagem |
| GET | /api/dashboard/stats | Métricas do dashboard |
