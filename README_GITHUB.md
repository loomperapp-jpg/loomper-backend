# 🚀 DEPLOY LOOMPER VIA GITHUB

## 📦 ARQUIVOS CRIADOS

Todos os arquivos estão prontos para você fazer commit no GitHub:

```
loomper/
├── functions/
│   ├── src/
│   │   └── index.ts              ← Código das Cloud Functions (20KB)
│   ├── package.json              ← Dependências
│   └── tsconfig.json             ← Configuração TypeScript
├── firestore.rules               ← Regras de segurança
├── firestore.indexes.json        ← Índices do Firestore
├── firebase.json                 ← Configuração do Firebase
├── .github/
│   └── workflows/
│       └── firebase-deploy.yml   ← Deploy automático (GitHub Actions)
└── .gitignore                    ← Arquivos ignorados
```

---

## 🔧 CONFIGURAÇÃO INICIAL (FAZER UMA VEZ)

### 1️⃣ GERAR TOKEN DO FIREBASE

No **Google Cloud Shell** (https://console.cloud.google.com):

```bash
npm install -g firebase-tools
firebase login --no-localhost
firebase projects:list
```

**Gerar token de CI:**

```bash
firebase login:ci
```

Vai aparecer um token tipo:
```
1//0eHv4aGYkjhsaCgYIARAAGA4SNwF-L9IrXxyz...
```

**⚠️ COPIE ESTE TOKEN!** Você vai precisar dele no próximo passo.

---

### 2️⃣ ADICIONAR SECRET NO GITHUB

1. Vá para o repositório no GitHub
2. **Settings** → **Secrets and variables** → **Actions**
3. Clique em **New repository secret**
4. **Name:** `FIREBASE_TOKEN`
5. **Value:** Cole o token que você copiou
6. Clique em **Add secret**

---

### 3️⃣ FAZER COMMIT DOS ARQUIVOS

No seu repositório local (ou diretamente no GitHub):

```bash
# Clone o repositório (se ainda não tiver)
git clone https://github.com/SEU_USUARIO/loomper.git
cd loomper

# Copie todos os arquivos que eu criei para dentro do repositório
# (functions/, firebase.json, firestore.rules, etc)

# Faça commit
git add .
git commit -m "feat: Adicionar Cloud Functions e GitHub Actions"
git push origin main
```

---

### 4️⃣ CONFIGURAR CREDENCIAIS DO MERCADO PAGO

**No Google Cloud Shell (última vez que precisa fazer isso!):**

```bash
firebase use loomper-e4c38

firebase functions:config:set \
  mercadopago.access_token="APP_USR-3934370180690366-012721-ef0f04a8adad7446c99e51ee43846eb1-3164408786" \
  mercadopago.public_key="APP_USR-932a6e86-2f00-4842-aa4d-a070dee00e61" \
  mercadopago.client_id="3934370180690366" \
  mercadopago.client_secret="eztPEVpI6RFF4AZMENiR5lKl4fpCRWlf"
```

**Verificar:**

```bash
firebase functions:config:get
```

---

## 🎯 COMO FUNCIONA O DEPLOY AUTOMÁTICO

### Após configurar, **TODO COMMIT NO GITHUB** vai:

1. ✅ Instalar dependências
2. ✅ Compilar TypeScript → JavaScript
3. ✅ Fazer deploy das Cloud Functions
4. ✅ Atualizar Firestore Rules

### Ver o progresso:

1. Vá para o repositório no GitHub
2. Clique em **Actions**
3. Você vai ver o workflow rodando
4. Clique nele para ver os logs em tempo real

---

## 🔄 WORKFLOW DE DESENVOLVIMENTO

### Para fazer mudanças:

```bash
# 1. Editar o código (ex: functions/src/index.ts)
nano functions/src/index.ts

# 2. Commit e push
git add .
git commit -m "feat: Adicionar nova função X"
git push origin main

# 3. GitHub Actions vai fazer deploy automaticamente!
```

### Ver logs das functions:

```bash
firebase functions:log --project loomper-e4c38
```

---

## 🧪 TESTAR LOCALMENTE (OPCIONAL)

Se quiser testar antes de fazer push:

```bash
# Instalar emuladores
npm install -g firebase-tools

# Instalar dependências
cd functions
npm install

# Rodar localmente
cd ..
firebase emulators:start --only functions
```

Vai abrir em: http://localhost:5001/loomper-e4c38/us-central1/onMercadoPagoWebhook

---

## 📊 MONITORAMENTO

### Ver funções ativas:

https://console.firebase.google.com/project/loomper-e4c38/functions

### Ver logs em tempo real:

https://console.firebase.google.com/project/loomper-e4c38/functions/logs

### Ver uso (calls, tempo, erros):

https://console.firebase.google.com/project/loomper-e4c38/functions/usage

---

## 🚨 TROUBLESHOOTING

### Erro: "FIREBASE_TOKEN not found"

- Verifique se você adicionou o secret no GitHub (Settings → Secrets)

### Erro: "Permission denied"

```bash
firebase login --reauth
```

### Erro: "Cloud Build API not enabled"

1. Vá para: https://console.cloud.google.com/apis/library/cloudbuild.googleapis.com
2. Clique em **Ativar**
3. Aguarde 1 minuto
4. Tente novamente

### Erro: "Functions deploy failed"

Ver logs detalhados:

```bash
firebase deploy --only functions --debug
```

---

## 🎉 PRONTO!

Agora você tem:

- ✅ Deploy automático via GitHub
- ✅ Versionamento do código
- ✅ Rollback fácil (só fazer `git revert`)
- ✅ Zero instalação no seu notebook

**Toda vez que você fizer push, o deploy acontece automaticamente!** 🚀

---

## 📞 PRÓXIMOS PASSOS

1. [ ] Fazer commit dos arquivos no GitHub
2. [ ] Configurar FIREBASE_TOKEN no GitHub Secrets
3. [ ] Fazer push e ver o deploy automático
4. [ ] Configurar webhook no Mercado Pago
5. [ ] Criar pacotes no Firestore
6. [ ] Testar compra!

---

**LOOMPER CONNECT** - Deploy moderno e profissional! 💪
