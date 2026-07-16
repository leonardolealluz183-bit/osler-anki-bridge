# Osler Anki Bridge — Fase 2 Android-only

A versão 0.4.2 corrige cards em que pergunta, resposta e explicação aparecem em contêineres diferentes na página da Osler.

## Correção validada

O TSV de teste não continha o card:

- `Angioedema. Em linhas gerais, qual a fisiopatologia?`
- resposta: `Perda da integridade vascular.`

A 0.4.2 procura a pergunta em um contêiner ancestral comum, extrai os blocos que ficam entre pergunta e explicação e mantém um snapshot recente do card revelado antes da troca de tela.

## Fluxo

1. Errei e Difícil adicionam o card à fila persistente.
2. Acertei não adiciona.
3. O painel mostra a quantidade na fila.
4. Se o contador não aumentar em um caso isolado, use **Adicionar card atual** antes de avançar; esse botão é um fallback de segurança.
5. Baixe o TSV no fim da sessão.

A fila continua em `oslerAnkiBridge.queue.v1` e sobrevive a F5 e ao encerramento da sessão da Osler.
