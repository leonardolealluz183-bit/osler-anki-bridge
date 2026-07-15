# Osler Anki Bridge — Fase 2 Android-only

A versão 0.4.1 captura cards da Osler, mantém uma fila persistente no navegador e exporta um lote `.tsv` compatível com o importador de texto do AnkiDroid.

## Fluxo

1. Abra uma sessão de flashcards na Osler.
2. Toque em **Mostrar resposta**.
3. **Errei** e **Difícil** adicionam o card à fila.
4. **Acertei** não adiciona nada.
5. Ao terminar, toque em **Enviar ao AnkiDroid**.
6. Se o Firefox apenas baixar o arquivo, abra o `.tsv` pelo gerenciador de arquivos e escolha o AnkiDroid.

A fila usa `oslerAnkiBridge.queue.v1` no `localStorage` e sobrevive a F5, fechamento da aba e término da sessão da Osler.

## Reparo automático da fila

Ao carregar a 0.4.1, o script:

- remove `mark.osler-highlight` e atributos `data-start-offset`/`data-end-offset`, preservando o texto;
- elimina registros duplicados;
- remove cards sem resposta;
- remove cards cuja pergunta ou assunto seja apenas um veredito como `Sim!`, `Não!`, `Verdadeiro` ou `Falso`;
- salva a fila já reparada novamente.

Por isso, uma fila antiga pode diminuir de cinco para quatro cards. O registro removido era inválido e não deve ser importado.

## Perguntas de verdadeiro/falso

Quando a resposta intermediária é `Sim!` ou `Não!`, o script procura a pergunta temática anterior e usa o veredito como resposta. Ele não aceita o próprio `Não!` como pergunta.

## Estrutura do arquivo

```text
#separator:Tab
#html:true
#tags:osler
#columns:Frente    Verso    Tags    Baralho
#tags column:3
#deck column:4
```

Cada linha contém Frente, Verso, Tags e Baralho. O baralho padrão é `Osler`.

## Imagens e segurança

Imagens protegidas por token são substituídas por `[Imagem disponível na Osler]`. Scripts, atributos perigosos e parâmetros sensíveis das URLs são removidos. Nenhum card é enviado para servidor externo.

## Depois da importação

A fila não é apagada automaticamente porque o navegador não consegue confirmar se o AnkiDroid concluiu a importação. Somente depois de verificar os cards no AnkiDroid, volte à Osler e toque em **Limpar fila**.
