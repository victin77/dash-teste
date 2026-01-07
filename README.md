# Dashboard de Comissões (Render-ready)

Projeto profissional **React (Vite) + Node/Express + SQLite**.

## Rodar localmente
```bash
npm install
npm run build
npm start
```

Acesse: http://localhost:3000

## Deploy no Render (1 serviço)
- **Build Command**
```bash
npm run build
```
- **Start Command**
```bash
npm start
```

### Variáveis de ambiente
- `SESSION_SECRET` (obrigatório) – string forte
- `ADMIN_PASSWORD` (obrigatório) – senha do admin
- `ADMIN_USER` (opcional) – padrão: `admin`
- `DB_DIR` (opcional) – recomendado no Render: `/data`

### Persistência (IMPORTANTE)
No Render, adicione um **Persistent Disk** e monte em `/data`.
Assim o arquivo SQLite não é perdido entre deploys.

## Login
Use o usuário admin criado no primeiro start.
