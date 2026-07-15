# Osler Anki Bridge

Fase 1 Android-only para capturar e diagnosticar cards da Osler por meio de userscript, sem envio de dados e sem integração com AnkiDroid ou aplicativo Android.

## Versão 0.3.3

A extração na página real da Osler é automática:

- localiza a pergunta a partir de `div.osler-card-explanation`;
- extrai o assunto do primeiro `<strong>` da pergunta;
- substitui respostas reveladas `.cloze-answer` por `[...]` na versão da pergunta;
- preserva também a pergunta revelada;
- captura um ou vários clozes como resposta;
- em cards sem cloze, captura o bloco de resposta existente entre a pergunta e a explicação, incluindo listas;
- captura todos os parágrafos da explicação;
- detecta **Errei** e **Difícil** em `pointerdown` e `click`, inclusive quando o intervalo aparece concatenado ao texto do botão;
- ignora **Acertei**;
- remove `token`, `access_token`, assinatura e parâmetros equivalentes das URLs presentes no HTML copiado.

A calibração manual permanece disponível somente como fallback de diagnóstico.

## Conteúdo do repositório

- `userscript/osler-anki-bridge.user.js`: código-fonte do userscript.
- `docs/osler-anki-bridge.user.js`: cópia publicada pelo GitHub Pages.
- `docs/index.html`: página simulada da estrutura real da Osler.
- `tests/osler-anki-bridge.test.js`: testes automatizados da extração.
- `docs/android-only.md`: instruções e limites da Fase 1.

O GitHub Pages deve ser configurado para publicar diretamente da branch `main`, pasta `/docs`.

## Desenvolvimento

```bash
npm test
npm run lint
```

## Fora do escopo

Este repositório ainda não implementa Fase 2, Android Intent, envio direto ao AnkiDroid, backend, sincronização em nuvem nem aplicativo Android nativo.
