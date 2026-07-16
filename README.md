# Osler Anki Bridge

Userscript Android-only para capturar cards marcados como **Errei** ou **Difícil** na Osler e exportá-los para o AnkiDroid.

## Versão 0.5.0 — script unificado

A captura, a sessão nomeada e a exportação agora ficam no mesmo userscript. Não há mais dependência entre o capturador principal, a camada de sessões e correções separadas.

A 0.5.0:

- preserva a fila e o histórico das versões anteriores;
- recupera sessões antigas e reinícios acidentais com o mesmo nome;
- adiciona cada card diretamente à sessão ativa dentro da mesma transação que o salva;
- inclui também cards duplicados na sessão atual quando forem vistos e marcados novamente;
- impede Errei/Difícil quando não há sessão ativa;
- salva antes de avançar e confirma a mudança real do card;
- evita confundir referências bibliográficas em itálico com a pergunta;
- exporta somente a sessão escolhida, usando seu nome como baralho;
- preserva o assunto original como tag;
- reúne sessão, captura, diagnóstico, backup e exportação em um único painel móvel.

## Instalação

Instale `docs/osler-anki-bridge-v050.user.js` e mantenha somente o script **Osler Anki Bridge 0.5.0** ativado no Violentmonkey. As antigas extensões auxiliares de sessões e correção de perguntas devem ser desativadas.

## Fluxo

1. Fora dos flashcards, abra o painel e inicie uma sessão nomeada.
2. Entre nos flashcards e use **Espaço**, **1 Errei** ou **2 Difícil**.
3. O contador da sessão é atualizado no mesmo momento em que o card é salvo.
4. Ao terminar, saia dos flashcards.
5. Prepare e baixe o TSV da sessão.
6. Encerre a sessão antes de iniciar outro tema.

## Desenvolvimento

```bash
npm test
npm run lint
```
