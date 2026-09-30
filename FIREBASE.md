# Configurar o Firebase (uma vez só)

Tudo pelo navegador, no plano gratuito **Spark** (não precisa de cartão).

## 1. Criar o projeto
1. Acesse https://console.firebase.google.com → **Adicionar projeto** → dê um nome (ex.: `esg-campo`).
   O Google Analytics é opcional.
2. Na página do projeto, clique no ícone **Web `</>`** para registrar um app da Web (nome: `ESG Campo`).
   Não marque "Firebase Hosting".
3. Copie o objeto `firebaseConfig` exibido e cole os valores em **`shared/firebase-config.js`**.

## 2. Ativar o login por e-mail
**Build → Authentication → Começar → Método de login → E-mail/senha → Ativar → Salvar.**

Em **Authentication → Configurações → Domínios autorizados**, adicione o domínio onde o app ficará,
por exemplo `seu-usuario.github.io` (o `localhost` já vem autorizado).

## 3. Criar o banco Firestore
1. **Build → Firestore Database → Criar banco de dados**.
2. Local: `southamerica-east1 (São Paulo)`.
3. Modo: **produção**.
4. Aba **Regras**: apague o conteúdo, cole o arquivo **`firestore.rules`** deste projeto e clique em **Publicar**.

## 4. Criar o primeiro administrador
O app não permite que ninguém se cadastre sozinho, então o primeiro admin é criado no console:

1. **Authentication → Usuários → Adicionar usuário**: informe seu e-mail e uma senha.
   Copie o **UID do usuário** que aparece na lista.
2. **Firestore Database → Dados → Iniciar coleção**:
   - ID da coleção: `users`
   - ID do documento: *cole o UID*
   - Campos:
     | campo | tipo | valor |
     |---|---|---|
     | `name` | string | Seu nome |
     | `email` | string | seu e-mail |
     | `role` | string | `admin` |
     | `active` | **boolean** (não string!) | `true` |
3. Abra `admin/` no navegador e entre. A partir daí, cadastre os orientadores em **Usuários**.

## 5. Primeiros passos no painel
1. **Configurações:** nome da instituição, que aparece nos relatórios.
2. **Questionários → Criar a partir do modelo ESG:** revise o questionário e clique em **Publicar**.
3. **Usuários:** cadastre os orientadores e informe a senha inicial a cada um.
4. Os orientadores abrem `campo/` no celular, entram e instalam o app na tela inicial.

## Limites do plano gratuito (Spark)
| Recurso | Cota gratuita | Estimativa de uso |
|---|---|---|
| Armazenamento | 1 GiB | Uma foto ocupa cerca de 150–330 KB. Com 5 fotos por visita, cabem cerca de 700–1.000 visitas. |
| Leituras | 50 mil/dia | O painel lê todas as visitas ao abrir. Com mil visitas, dá para abrir o painel mais de 40 vezes por dia. |
| Gravações | 20 mil/dia | Uma visita sincronizada gera poucas gravações. |

Se o volume crescer, dá para ativar o plano **Blaze** (paga só o que passar da cota gratuita) e migrar as fotos
para o Cloud Storage sem mudar o resto do app.
