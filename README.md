# Osler Anki Bridge

Userscripts Android-only para capturar cards marcados como **Errei** ou **Difícil** na Osler e exportá-los para o AnkiDroid.

## Versão 0.4.11 — sessões nomeadas

A captura estável permanece no script principal 0.4.10. A camada de sessões 0.4.11 é instalada junto dele e acrescenta controles dentro do mesmo painel, sem alterar o mecanismo de captura e avanço.

Com ela é possível:

- iniciar uma sessão com um nome, por exemplo `Hipertensão Arterial Sistêmica`;
- considerar como pertencentes à sessão somente os cards novos capturados depois do início;
- exportar um TSV contendo somente os cards daquela sessão;
- colocar todos os cards exportados no mesmo baralho, usando o nome da sessão;
- preservar o assunto original de cada card como tag;
- manter os cards e backups antigos intactos;
- encerrar uma sessão e iniciar outra sem limpar a fila principal.

## Instalação

1. Mantenha instalado o script principal `docs/osler-anki-bridge.user.js` na versão 0.4.10.
2. Instale também `docs/osler-anki-sessions.user.js`.
3. Feche todas as abas da Osler e abra novamente.
4. Abra o painel com `+`; o bloco **Sessão de exportação — 0.4.11** aparecerá no início.

## Fluxo por tema

1. Fora da sessão de flashcards, digite o nome do tema e toque em **Nova sessão**.
2. Minimize o painel e faça os flashcards normalmente.
3. Saia da sessão de flashcards.
4. Abra o painel e confira o número de cards da sessão.
5. Toque em **Preparar TSV da sessão**.
6. Use **Baixar TSV da sessão**, **Baixar via Violentmonkey** ou **Copiar TSV**.
7. Toque em **Encerrar sessão** antes de iniciar outro tema.

O TSV da sessão não inclui os cards que já estavam na fila quando ela foi iniciada. A exportação completa e o log continuam disponíveis no painel principal.

## Desenvolvimento

```bash
npm test
npm run lint
```
