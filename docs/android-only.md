# Osler Anki Bridge — Fase 1 Android-only

A Fase 1 é um userscript de captura e diagnóstico para uso em navegador Android com gerenciador de userscripts. Ela não envia dados para a internet, não chama Android Intent, não integra com AnkiDroid e não inclui aplicativo Android nativo.

## Fluxo da versão 0.3.0

1. Abra uma sessão de flashcards na Osler com o userscript instalado.
2. Toque em **Mostrar resposta**.
3. Ao tocar em **Errei** ou **Difícil**, o script captura o card antes da troca de tela.
4. **Acertei** não captura.
5. Use **Copiar JSON** para revisar o resultado.

Na página real da Osler não é necessário calibrar pergunta, assunto, resposta, explicação ou botões. A extração automática usa a estrutura estável do card, não as classes dinâmicas geradas pelo layout.

## Estrutura capturada

- `topic` e `deck`: primeiro `<strong>` da pergunta, sem pontuação final.
- `question.text` e `question.html`: pergunta com cada `.cloze-answer` substituído por `[...]`.
- `question.revealedText` e `question.revealedHtml`: versão revelada.
- `answer.text`, `answer.html` e `answer.items`: uma ou várias respostas ocultas.
- `explanation`: todo o bloco `div.osler-card-explanation`, incluindo todos os parágrafos.

## Fallback e limitações

- A calibração manual permanece em um painel recolhível apenas para diagnóstico de páginas não reconhecidas.
- **Limpar calibração** remove a configuração manual salva na chave v2.
- O HTML capturado é sanitizado.
- Capturas duplicadas são ignoradas por identificador estável.
- Nenhum dado é transmitido pela internet.
- A Fase 2 e a integração com AnkiDroid permanecem fora do escopo.
