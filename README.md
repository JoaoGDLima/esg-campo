# ESG Campo

Sistema de coleta de dados por questionário para orientadores agrícolas avaliarem a conformidade ESG
de propriedades rurais. São dois aplicativos web que compartilham um banco **Firebase (Firestore)**:

| App | Pasta | Quem usa | Conexão |
|---|---|---|---|
| **Campo** | `campo/` | Orientadores, no celular ou tablet | **Offline**, sincroniza quando há internet |
| **Admin** | `admin/` | Coordenação, no computador | Online, atualiza em tempo real |

Configuração inicial do Firebase: **[FIREBASE.md](FIREBASE.md)**.

## App de campo (orientador)
- Login com a conta criada pelo admin. O primeiro acesso precisa de internet; depois funciona sem sinal.
- Baixa os questionários **publicados** e as propriedades cadastradas.
- Visita: cadastro da propriedade, GPS, respostas, observações, **fotos de evidência**, plano de ação e
  **assinatura do produtor**. Tudo é salvo no aparelho a cada toque.
- Índice de conformidade por pilar (E/S/G). Item crítico não conforme marca a visita como **Pendência crítica**.
- Relatório para imprimir ou salvar em PDF, e CSV.

## Painel admin (coordenação)
- **Painel:** índice médio, visitas por mês, média por pilar, classificação das visitas, não conformidades
  mais frequentes, mapa com GPS e desempenho por orientador. Filtros por período, questionário,
  orientador e município. Atualiza **ao vivo** conforme os orientadores sincronizam.
- **Visitas:** lista com situação e progresso (inclusive as em andamento), relatório completo com fotos,
  **revisão** (aprovada / requer ajustes + comentário) e exportação CSV.
- **Questionários:** editor de seções e perguntas (pesos, itens críticos, foto obrigatória).
  Rascunho salvo automaticamente, **publicação versionada** e opção de arquivar.
- **Usuários:** cadastro de orientadores e admins, ativar/desativar e redefinição de senha.

## Como funciona a sincronização
```
 Celular (IndexedDB)                                   Firestore
 ─────────────────────                                 ─────────
 questionários publicados   ◄──── baixa ────   questionnaires (isPublished)
 configurações/instituição  ◄──── baixa ────   settings/app
 propriedades               ◄──► envia/baixa ─►  properties
 fotos (comprimidas)        ───── envia ────►   photos
 visitas (andamento/final.) ───── envia ────►   visits  ◄── revisão do admin
```
- O app **sempre grava primeiro no aparelho**. Cada registro tem um contador de alterações (`rev`) e
  o último valor enviado (`syncedRev`). O que tem os dois diferentes está **pendente**.
- A sincronização roda sozinha ao abrir o app, quando a internet volta, alguns segundos após cada
  alteração e a cada 5 minutos. Também dá para disparar em **Sincronizar**.
- Se o orientador editar durante um envio, o registro continua pendente e vai na rodada seguinte.
  Nada é perdido.
- Cada operação tem limite de tempo, para o sinal fraco no campo não travar o app. O que falhar é
  tentado de novo depois.
- Ordem de envio: propriedades → fotos → exclusões → visitas. Assim, quando a visita aparece no painel,
  as fotos já estão lá.
- Visitas já enviadas não podem ser excluídas pelo orientador; só o admin exclui.
- Ao sair da conta, o app exige que tudo esteja enviado. Em um aparelho novo, o orientador recupera
  as visitas em **Sincronizar → Baixar minhas visitas do servidor**.

## Segurança ([firestore.rules](firestore.rules))
- Só usuários com cadastro em `users` e `active: true` acessam dados.
- O orientador vê e altera **apenas as próprias visitas e fotos** e não pode mexer na revisão do admin.
- Só o admin altera questionários, usuários e configurações.

## Rodar localmente
```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```
Abra http://localhost:8080 e escolha **campo** ou **admin**.

## Publicar no GitHub Pages
Suba a pasta inteira para o repositório e ative o Pages (branch `main`, pasta `/`). Os endereços ficam assim:
- `https://SEU-USUARIO.github.io/REPO/campo/` → orientadores (instalar na tela inicial)
- `https://SEU-USUARIO.github.io/REPO/admin/` → coordenação

Lembre de adicionar `SEU-USUARIO.github.io` aos domínios autorizados do Firebase Authentication.
Ao alterar o app de campo, aumente a versão em `campo/sw.js` (`CACHE = 'esg-campo-v3'`...).

## Estrutura
```
index.html               página inicial (escolha do app)
firestore.rules          regras de segurança do Firestore
shared/                  código comum
  firebase-config.js     ← dados do seu projeto Firebase
  firebase.js            inicialização (SDK 12.6.0 via CDN)
  scoring.js             tipos de resposta e índice de conformidade
  report.js, csv.js      relatório e planilhas
  seed.js                modelo de questionário ESG
  util.js, app.css
campo/                   PWA offline do orientador
  js/db.js               IndexedDB local
  js/sync.js             motor de sincronização
  js/field.js            visita: preencher, finalizar, relatório
  js/properties.js, media.js, signature.js, app.js
  sw.js, manifest.webmanifest
admin/                   painel da coordenação
  js/dashboard.js        indicadores, gráficos e mapa
  js/visits.js           acompanhamento e revisão
  js/questionnaires.js   editor e publicação
  js/users.js            cadastro de usuários
  js/data.js             visitas em tempo real + filtros
serve.ps1                servidor local de testes
```
Tecnologias: HTML/CSS/JavaScript (ES Modules) sem build; Firebase Authentication + Cloud Firestore;
IndexedDB + Service Worker (offline); Leaflet + OpenStreetMap (mapa).
