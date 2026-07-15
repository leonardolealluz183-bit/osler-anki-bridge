# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.7 — Fase 2

Correções principais:

- mantém os atalhos: **Espaço** mostra a resposta pela Osler, **1** captura Errei e **2** captura Difícil;
- continua salvando o card antes de permitir o avanço;
- depois de salvar, confirma que a Osler realmente saiu do card atual;
- detecta o avanço quando a pergunta muda, o nó do card é substituído, os botões Errei/Difícil desaparecem ou o relatório abre;
- tenta avançar por clique nativo, sequência de ponteiro e repetição do atalho de teclado;
- se o card continuar na tela, o próximo `1` ou `2` tenta apenas avançar, sem registrar outra duplicata;
- migra a fila antiga do `localStorage` para o armazenamento permanente do Violentmonkey usando `GM_getValue` e `GM_setValue`;
- mantém um espelho local de contingência, log de até 500 eventos e modo leve em `/test/report`;
- preserva as correções anteriores de clozes distintos, respostas em lista, citações e bloqueio de respostas incompletas.

O problema que motivou a 0.4.7 apareceu em uma sessão real da 0.4.6: os 100 cards novos foram salvos corretamente, mas houve 66 tentativas duplicadas porque a Osler frequentemente permanecia no mesmo card depois do primeiro salvamento. A nova versão não considera a operação concluída até observar o avanço real.

## Fluxo

1. Pressione **Espaço** para mostrar a resposta.
2. Pressione **1** para Errei ou **2** para Difícil.
3. O painel mostra `AGUARDANDO RESPOSTA`, depois `SALVO — avançando` e finalmente `SALVO E AVANÇOU`.
4. Quando aparecer `SALVO, MAS NÃO AVANÇOU`, pressione a mesma tecla novamente; o card já salvo não será duplicado.
5. O painel deve informar `Fila permanente do Violentmonkey ativa`.
6. No relatório final, use **Baixar TSV** ou **Baixar log** no modo leve.

## Desenvolvimento

```bash
npm test
npm run lint
```
