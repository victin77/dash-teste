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


## Senhas por consultor

Este projeto suporta **uma senha diferente para cada consultor**.

### Padrão (já vem configurado)
- azurdin → Azurdin@21  
- vitor → Vitor@32  
- polly → Polly@45  
- marcelo → Marcelo@18  
- pedro → Pedro@27  
- gustavo → Gustavo@39  
- graca → Graca@14  

> Você pode trocar tudo pelo Railway/Render em **Variables/Environment** usando `CONSULTANT_PASSWORDS`.

### Configurar via variável de ambiente (recomendado)
Defina a variável `CONSULTANT_PASSWORDS` como um JSON:

```json
{"azurdin":"Azurdin@21","vitor":"Vitor@32","polly":"Polly@45","marcelo":"Marcelo@18","pedro":"Pedro@27"}
```

E para o admin (DM), use:
- `ADMIN_PASSWORD` = sua_senha

