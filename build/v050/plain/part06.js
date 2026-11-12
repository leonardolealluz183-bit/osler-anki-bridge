ve?.());installLegacyIsolation(doc);await loadState();panel=doc.createElement('section');panel.id=PANEL_ID;panel.innerHTML=`
      <div data-role="drag-handle" style="display:flex;align-items:center;gap:8px;cursor:move;touch-action:none;user-select:none;padding:2px 0 6px">
        <strong data-role="panel-title" style="flex:1"></strong>
        <button type="button" data-action="reset-panel" title="Voltar ao canto superior direito" style="min-width:30px">↗</button>
        <button type="button" data-action="toggle-panel" title="Abrir ou minimizar" style="min-width:30px">+</button>
      </div>
      <div data-role="panel-body">
        <div style="border:1px solid #8aa7c7;border-radius:8px;padding:8px;margin-bottom:8px;background:#f5f9ff">
          <strong>Sessão de exportação</strong>
          <div data-role="session-status" style="margin:5px 0"></div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <input data-role="session-name" type="text" placeholder="Ex.: Princípios do SUS" style="flex:1;min-width:180px;padding:5px;box-sizing:border-box">
            <button type="button" data-action="start-session">Nova sessão</button>
            <button type="button" data-action="end-session">Encerrar sessão</button>
          </div>
        </div>

        <div data-role="queue-status"></div>
        <div data-role="run-status" style="margin-top:3px"></div>
        <div data-role="mode-status" style="margin-top:6px"></div>

        <div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">
          <button type="button" data-action="capture">Adicionar card atual</button>
          <button type="button" data-action="prepare">Preparar TSV da sessão</button>
          <a data-role="session-download" href="#" hidden>Baixar TSV da sessão</a>
          <button type="button" data-action="gm-session">Baixar via Violentmonkey</button>
          <button type="button" data-action="copy-session">Copiar TSV</button>
        </div>

        <div data-role="export-status" style="margin-top:6px"></div>
        <div data-role="message" style="margin-top:6px;max-width:450px;overflow-wrap:anywhere"></div>

        <details style="margin-top:8px">
          <summary>Diagnóstico e recuperação</summary>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin:6px 0">
            <a data-role="log-download" href="#" hidden>Baixar log</a>
            <button type="button" data-action="gm-log">Baixar log via Violentmonkey</button>
            <button type="button" data-action="copy-log">Copiar log</button>
          </div>
          <label>TSV da sessão</label>
          <textarea data-role="session-tsv-text" rows="5" style="width:100%;box-sizing:border-box"></textarea>
          <label>Log</label>
          <textarea data-role="log-text" rows="5" style="width:100%;box-sizing:border-box"></textarea>
          <label>Backup completo</label>
          <textarea data-role="backup-text" rows="6" style="width:100%;box-sizing:border-box"></textarea>
          <button type="button" data-action="import-backup">Importar backup colado</button>
        </details>
      </div>
    `;panel.style.cssText='position:fixed;z-index:2147483647;background:#fff;color:#111;border:1px solid #999;border-radius:10px;padding:8px 10px;font:12px system-ui;width:min(460px,calc(100vw - 16px));box-sizing:border-box;box-shadow:0 4px 18px rgba(0,0,0,.35)';doc.body.appendChild(panel);const run=(operation)=>Promise.resolve().then(operation).catch((error)=>{setMessage(error?.message||String(error),'failed');renderPanel();});panel.querySelector('[data-action="toggle-panel"]').addEventListener('click',()=>{panelState.minimized=!panelState.minimized;applyPanelState();persistPanelState();});panel.querySelector('[data-action="reset-panel"]').addEventListener('click',()=>{panelState.left=null;panelState.top=12;applyPanelState();persistPanelState();});panel.querySelector('[data-action="start-session"]').addEventListener('click',()=>run(async()=>{const input=panel.querySelector('[data-role="session-name"]');await startSession(input?.value||'');if(input)input.value='';}));panel.querySelector('[data-action="end-session"]').addEventListener('click',()=>run(endSession));panel.querySelector('[data-action="capture"]').addEventListener('click',()=>run(()=>capture('captura manual',doc)));panel.querySelector('[data-action="prepare"]').addEventListener('click',()=>run(prepareExports));panel.querySelector('[data-action="gm-session"]').addEventListener('click',()=>run(()=>downloadWithGm('session')));panel.querySelector('[data-action="copy-session"]').addEventListener('click',()=>run(async()=>{if(exportDirty||!prepared.sessionTsv)prepareExports();await copyText(prepared.sessionTsv,'TSV da sessão');}));panel.querySelector('[data-action="gm-log"]').addEventListener('click',()=>run(()=>downloadWithGm('log')));panel.querySelector('[data-action="copy-log"]').addEventListener('click',()=>run(async()=>{if(exportDirty||!prepared.log)prepareExports();await copyText(prepared.log,'Log');}));panel.querySelector('[data-action="import-backup"]').addEventListener('click',()=>run(()=>{const text=panel.querySelector('[data-role="backup-text"]')?.value||'';return importBackup(text);}));installPanelDragging();ensureGlobalListeners(doc);installRouteWatcher();renderPanel();syncPageMode();}
const api={VERSION,activeSession,assignCardToActiveSession,buildSessionTsv,cardsForSession,deriveIdsFromAudit,extractCard,extractResponse,findQuestionElement,isEntirelyItalic,isLikelyReference,mergeCardArrays,mergeSessionStates,normalizeSessionState,questionScore,repairLegacySessions,safeDeckName,slugify,stableHash,topicStartsParagraph,validateCard,};pageWindow.OslerAnkiBridgeV050=api;if(typeof module!=='undefined'&&module.exports){module.exports=api;}else{install().catch((error)=>console.error('[Osler Anki Bridge 0.5.0]',error));}}());
