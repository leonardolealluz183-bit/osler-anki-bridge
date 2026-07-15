# Osler Anki Bridge

Fase 1 Android-only para capturar e diagnosticar conteúdo de páginas Osler por meio de userscript, sem envio de dados e sem integração com AnkiDroid ou aplicativo Android.

## Conteúdo do repositório

- `userscript/osler-anki-bridge.user.js`: userscript de captura, calibração visual e painel JSON/logs.
- `demo/index.html`: página simulada para calibrar pergunta, resposta, explicação, assunto/deck e botões Errei/Difícil.
- `tests/osler-anki-bridge.test.js`: testes automatizados dos requisitos da Fase 1.
- `docs/android-only.md`: documentação do escopo Android-only sem Fase 2 e sem integração com AnkiDroid.
- `.github/workflows/pages.yml`: workflow para publicar a demo estática no GitHub Pages.

## Desenvolvimento

```bash
npm test
npm run lint
```

## Fora do escopo

Este repositório não implementa Fase 2, Android Intent, envio direto ao AnkiDroid, backend, sincronização em nuvem nem aplicativo Android nativo.
