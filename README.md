# ESG Campo

Aplicativo (PWA) de coleta de dados por questionário para orientadores agrícolas avaliarem a conformidade ESG
de propriedades rurais. Funciona **offline**, instala na tela inicial do celular/tablet e guarda tudo no próprio aparelho.

## Funcionalidades

**Administrador** (menu *Admin*, protegido por senha)
- Monta questionários por seções nos pilares **E** (Ambiental), **S** (Social) e **G** (Governança).
- Tipos de pergunta: Conformidade (Conforme / Parcial / Não conforme / N.A.), Sim/Não, escolha única (com nota por opção),
  múltipla escolha, texto, número e data.
- Por pergunta: peso, obrigatória, **item crítico** e **foto obrigatória se não conforme**.
- Rascunho salvo automaticamente; **Publicar** gera uma nova versão.
- **Exportar p/ orientadores** gera um arquivo `.json` para distribuir.
- Inclui um **modelo ESG inicial** (CAR, APP, Reserva Legal, agrotóxicos, NR-31, trabalho infantil/escravo, embargos etc.)
  — revise com a equipe técnica antes de usar.

**Orientador**
- Cadastro de produtores e propriedades (CPF/CNPJ, CAR, área, município/UF, GPS).
- Visita: GPS, respostas, observações e **fotos de evidência** por pergunta, com salvamento automático.
- Revisão: **índice de conformidade** geral e por pilar, alertas de itens críticos e **plano de ação**
  (ação, responsável, prazo) para cada não conformidade.
- **Assinatura do produtor** na tela.
- **Relatório** para imprimir ou salvar em PDF.
- Exportação **CSV** (resumo e respostas detalhadas; abre no Excel) e **backup completo** (JSON com fotos) com restauração.

### Pontuação
- Conforme = 1, Parcial = 0,5, Não conforme = 0, N.A. = ignorado; Sim/Não conforme a “resposta esperada”;
  escolha única pela nota de cada opção.
- Índice = soma(peso × nota) ÷ soma(pesos), por pilar e geral.
- Classificação: ≥ 85% Alta, ≥ 60% Parcial, abaixo disso Baixa. Qualquer **item crítico** não conforme marca a visita
  como **Pendência crítica**, independente do percentual.

## Como rodar no computador

Não precisa instalar nada. No PowerShell, dentro desta pasta:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Abra http://localhost:8080.

## Como usar no celular (campo)

Câmera, GPS e modo offline exigem **HTTPS**. Publique a pasta em qualquer hospedagem estática gratuita
(GitHub Pages, Netlify, Cloudflare Pages). No celular:

1. Abra o endereço com internet e use **“Adicionar à tela inicial” / “Instalar app”**.
2. A partir daí, o app funciona sem internet.

Ao atualizar arquivos do app, aumente a versão em `sw.js` (`CACHE = 'esg-campo-v2'`) para os aparelhos baixarem a nova versão.

## Fluxo de distribuição (sem servidor)

1. Admin cria/edita o questionário → **Publicar** → **Exportar p/ orientadores** (`.json`).
2. Envia o arquivo aos orientadores (WhatsApp, e-mail…).
3. Orientador: **Ajustes → Importar questionário**.
4. Após as visitas: **Ajustes → CSV** ou **Backup** para enviar os dados à coordenação.

## Limitações atuais

- **Não há servidor**: cada aparelho tem seus próprios dados. Faça backups regularmente.
- A senha de admin protege só **aquele aparelho**; não é um controle de acesso central.
- Próximo passo natural: backend com sincronização (ex.: Supabase) para login real de usuários,
  painel da coordenação e envio automático das visitas quando houver sinal.

## Estrutura

```
index.html, manifest.webmanifest, sw.js   PWA / offline
css/app.css                               estilos (claro/escuro, impressão)
js/app.js         roteamento, lista de visitas, ajustes
js/admin.js       login admin, lista e editor de questionários, importação
js/field.js       nova visita, preenchimento, finalização, relatório
js/properties.js  cadastro de propriedades
js/scoring.js     tipos de resposta e cálculo de conformidade
js/export.js      CSV, backup e restauração
js/media.js       fotos (compressão) e GPS
js/signature.js   campo de assinatura
js/seed.js        modelo ESG inicial
js/db.js          armazenamento local (IndexedDB)
serve.ps1         servidor local para testes
```
