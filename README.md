# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.0 — Fase 2

A Fase 2 evita criar um aplicativo intermediário desnecessário. O próprio AnkiDroid aceita arquivos de texto tabulados pelo sistema de compartilhamento/importação do Android, então o fluxo é:

1. estudar normalmente na Osler;
2. **Errei** e **Difícil** adicionam o card à fila persistente;
3. **Acertei** é ignorado;
4. tocar em **Enviar ao AnkiDroid** ao fim da sessão;
5. selecionar o AnkiDroid no compartilhamento do Android e confirmar a importação.

Se o navegador não conseguir compartilhar arquivos diretamente, o botão baixa um arquivo `.tsv`, que pode ser aberto no AnkiDroid.

## Conteúdo exportado

O TSV usa os cabeçalhos de importação do Anki:

- separador `Tab`;
- HTML habilitado;
- colunas `Frente`, `Verso`, `Tags` e `Baralho`;
- coluna 3 tratada como tags;
- coluna 4 tratada como baralho;
- baralho `Osler` criado pelo importador quando necessário.

A frente contém a pergunta e um identificador invisível para reduzir duplicatas. O verso contém resposta, explicação, assunto, ID e link para a Osler. Imagens protegidas por token não são copiadas nesta versão; o exportador coloca um aviso textual no lugar delas.

## Captura

A extração continua automática:

- pergunta localizada a partir de `div.osler-card-explanation`;
- assunto extraído do primeiro `<strong>`;
- `.cloze-answer` substituído por `[...]` na frente;
- resposta revelada preservada;
- cards sem cloze extraídos do bloco entre pergunta e explicação;
- explicação completa preservada;
- Errei e Difícil reconhecidos por texto e pela posição dos botões SRS;
- tokens temporários removidos das URLs.

## Persistência e segurança

A fila fica somente no `localStorage` do domínio da Osler, na chave `oslerAnkiBridge.queue.v1`. Ela sobrevive ao recarregamento da página e só é apagada pelo botão **Limpar fila**. O userscript não usa servidor, `fetch`, backend ou sincronização externa.

## Desenvolvimento

```bash
npm test
npm run lint
```

O GitHub Pages publica `docs/osler-anki-bridge.user.js` diretamente de `main/docs`.

## Próximas limitações a resolver

- validar o fluxo real de compartilhamento/importação no Firefox Android e no AnkiDroid;
- decidir a melhor configuração inicial de tipo de nota no importador;
- adicionar imagens como mídia real do Anki em uma etapa posterior, caso o ganho compense a complexidade.
