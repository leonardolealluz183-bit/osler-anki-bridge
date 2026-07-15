# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.6 — Fase 2

Correções principais:

- mantém os atalhos: **Espaço** mostra a resposta pela Osler, **1** captura Errei e **2** captura Difícil;
- transforma `1` e `2` em uma captura transacional: o evento nativo é bloqueado, o script espera a resposta, salva o card e só então aciona o botão da Osler;
- tenta novamente a leitura a cada 60 ms por até 2,2 segundos;
- se a resposta não aparecer, registra a falha e não avança para o próximo card;
- rejeita listas ainda não reveladas que contenham `[...]`, evitando cards malformados como `[..., e Baterias/pilhas]`;
- mantém cards com o mesmo enunciado e respostas ocultas diferentes como IDs distintos;
- aplica o mesmo fluxo protegido aos cliques em Errei/Difícil;
- preserva a fila no mesmo `localStorage`, mantém log de até 500 eventos e conserva o modo leve em `/test/report`.

O problema que motivou a 0.4.6 foi confirmado pelo log de uma sessão: alguns atalhos não produziram evento de captura, enquanto outros foram processados antes de a resposta terminar de renderizar. A partir desta versão, o card não pode avançar silenciosamente sem que a tentativa termine como salvo, duplicado ou falhou sem avançar.

## Fluxo

1. Pressione **Espaço** para mostrar a resposta.
2. Pressione **1** para Errei ou **2** para Difícil.
3. O painel mostra `AGUARDANDO RESPOSTA` e depois `SALVO`.
4. A Osler só passa ao próximo card depois de o card entrar na fila.
5. Quando aparecer `NÃO AVANÇOU`, permaneça no mesmo card, mostre a resposta e pressione novamente.
6. No relatório final, use **Baixar TSV** ou **Baixar log** no modo leve.

## Desenvolvimento

```bash
npm test
npm run lint
```
