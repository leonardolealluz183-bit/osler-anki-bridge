# Osler Anki Bridge

Userscript para Firefox (Violentmonkey) que lê a **página de consulta** do Osler — onde os flashcards já aparecem abertos — e exporta tudo como **TSV pronto para importar no Anki**. Sem rede, sem backend e sem envio de dados.

## Versão 0.4.0

A captura agora é feita por card (`<article>`), e não mais por clique em **Errei/Difícil**:

- percorre **todos** os cards renderizados na consulta, um a um;
- usa o breadcrumb do card (`Clínica Médica › Cardiologia › Síncope`) para montar deck e tags;
- entende os dois formatos da Osler:
  - **cloze**: lacunas `.cloze-answer` na pergunta;
  - **pergunta/resposta**: pergunta no topo e resposta dentro de `AnswerSection`;
- preserva listas, imagens, negrito, itálico e sublinhado;
- remove as marcas d'água (`osler-wm` / `osler-fm`) e caracteres de largura zero;
- converte os clozes para `{{c1::...}}`, `{{c2::...}}` no TSV de cloze;
- gera também um TSV "básico" (frente/verso) com a resposta e a explicação no verso;
- inclui imagens com URL absoluta (o token do Osler é mantido no TSV, mas removido do JSON de diagnóstico);
- **Carregar tudo e capturar**: rola a lista até o fim para buscar os cards que ainda não foram renderizados (a consulta carrega em blocos; o topo pode dizer "50 de 50" com só 30 no DOM);
- **Capturar só a tela**: substitui a captura pelo que está visível agora (não acumula lixo de telas anteriores);
- o painel flutuante sobrevive às re-renderizações do SPA.

## Como usar

1. Abra a página de **consulta** do Osler com os flashcards abertos.
2. Clique em **Carregar tudo e capturar** (canto inferior direito).
3. Escolha o formato:
   - **Baixar TSV cloze** se você usa o note type **Cloze** no Anki;
   - **Baixar TSV básico** se quer frente/verso no note type **Basic**.
4. No Anki: **Arquivo → Importar** e selecione o `.tsv`.
   - O arquivo já traz `#separator:Tab`, `#html:true`, `#notetype`, `#tags column:3` e `#deck column:4`.
   - Requer Anki 2.1.55 ou mais recente (cabeçalhos de arquivo).
5. Opcional: **Copiar TSV** para colar direto na janela de importação.

## Conteúdo do repositório

- `userscript/osler-anki-bridge.user.js`: código-fonte do userscript.
- `docs/osler-anki-bridge.user.js`: cópia publicada pelo GitHub Pages.
- `docs/index.html`: exemplo da estrutura real da Osler (sem login).
- `tests/osler-anki-bridge.test.js`: testes de extração e exportação.
- `tests/helpers/mini-dom.js`: mini-DOM usado pelos testes (sem dependências).

O GitHub Pages publica da branch `main`, pasta `/docs`.

## Desenvolvimento

```bash
npm test
npm run lint
```

## Limitações conhecidas

- A página de consulta carrega os cards em blocos. Se você usar **Capturar só a tela**, só entra o que está no DOM naquele momento.
- Os tokens das imagens expiram (cerca de 14 dias). Importe o TSV enquanto a página estiver aberta para que o Anki baixe as imagens.
- O userscript não envia nada para fora e não conversa com o AnkiDroid.
