# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.1 — Fase 2

Fluxo:

1. estudar normalmente na Osler;
2. **Errei** e **Difícil** adicionam o card à fila persistente;
3. **Acertei** é ignorado;
4. tocar em **Enviar ao AnkiDroid** ao fim da sessão;
5. selecionar o AnkiDroid no compartilhamento do Android ou abrir o TSV baixado.

## Correções da 0.4.1

- remove automaticamente wrappers `mark.osler-highlight` e seus offsets sem apagar o texto;
- repara a fila antiga ao carregar a página;
- remove da fila cards inválidos, como uma falsa pergunta composta apenas por `Não!` e sem resposta;
- impede que cards sem resposta ou com assunto/pergunta de mero veredito entrem no TSV;
- procura a pergunta real antes de parágrafos intermediários como `Sim!` e `Não!`;
- reforça a captura de botões recriados dinamicamente com `MutationObserver` e listeners diretos;
- mantém a deduplicação por ID e a persistência em `localStorage`.

Ao atualizar da 0.4.0 para a 0.4.1, uma fila de cinco cards pode passar para quatro: isso significa que o card inválido foi removido. Os cards válidos permanecem e têm o HTML limpo automaticamente.

## Conteúdo exportado

O TSV usa:

- separador `Tab`;
- HTML habilitado;
- colunas `Frente`, `Verso`, `Tags` e `Baralho`;
- coluna 3 tratada como tags;
- coluna 4 tratada como baralho;
- baralho `Osler`.

A frente contém a pergunta e um identificador invisível. O verso contém resposta, explicação, assunto, ID e link para a Osler. Imagens protegidas por token são substituídas por um aviso textual.

## Persistência e segurança

A fila fica somente no `localStorage` do domínio da Osler, na chave `oslerAnkiBridge.queue.v1`. O userscript não usa servidor, `fetch`, backend ou sincronização externa.

## Desenvolvimento

```bash
npm test
npm run lint
```

O GitHub Pages publica `docs/osler-anki-bridge.user.js` diretamente de `main/docs`.
