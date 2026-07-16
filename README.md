# Osler Anki Bridge

Userscripts Android-only para capturar cards marcados como **Errei** ou **Difícil** na Osler e exportá-los para o AnkiDroid.

## Versão 0.4.12 — sessões rastreadas pelo log

A captura estável permanece no script principal 0.4.10. A camada de sessões 0.4.12 é instalada junto dele e usa o histórico real de capturas do painel principal.

A correção impede que uma sessão nova herde os cards antigos da fila. Também inclui na sessão um card antigo quando ele é realmente reencontrado e marcado durante o tema atual.

Com ela é possível:

- iniciar uma sessão com um nome, por exemplo `Princípios do SUS`;
- começar a sessão com zero cards, independentemente do tamanho da fila completa;
- contabilizar somente eventos `adicionado` ou `duplicado` ocorridos depois do início da sessão;
- exportar um TSV contendo somente os cards daquela sessão;
- colocar todos os cards exportados no mesmo baralho, usando o nome da sessão;
- preservar o assunto original de cada card como tag;
- reparar automaticamente sessões ativas da 0.4.11 que exibiam toda a fila antiga.

## Instalação

1. Mantenha instalado o script principal `docs/osler-anki-bridge.user.js` na versão 0.4.10.
2. Atualize a camada de sessões instalando `docs/osler-anki-sessions-v0412.user.js`.
3. Feche todas as abas da Osler e abra novamente.
4. Abra o painel com `+`; o bloco **Sessão de exportação — 0.4.12** aparecerá no início.

## Fluxo por tema

1. Fora da sessão de flashcards, digite o nome do tema e toque em **Nova sessão**.
2. Confirme que o contador começa em zero.
3. Minimize o painel e faça os flashcards normalmente.
4. Saia da sessão de flashcards.
5. Abra o painel e confira o número de cards da sessão.
6. Toque em **Preparar TSV da sessão**.
7. Use **Baixar TSV da sessão**, **Baixar via Violentmonkey** ou **Copiar TSV**.
8. Toque em **Encerrar sessão** antes de iniciar outro tema.

A exportação completa e o log continuam disponíveis no painel principal.

## Desenvolvimento

```bash
npm test
npm run lint
```
