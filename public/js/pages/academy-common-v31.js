(() => {
  "use strict";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  const token = () => sessionStorage.getItem("fib_mdt_session") || sessionStorage.getItem("lspd_mdt_session") || "";
  const call = (method, ...args) => new Promise((resolve, reject) => {
    CloudApi.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](token(), ...args);
  });
  const root = document.querySelector("[data-academy-page]");
  if (!root) return;

  function notify(message, type="info") {
    if (type === "error" && typeof window.showError === "function") return window.showError(message);
    if (type === "success" && typeof window.showSuccess === "function") return window.showSuccess(message);
    window.alert(message);
  }
  function empty(text) { return `<div class="academy-empty">${esc(text)}</div>`; }
  function nav(active) {
    // Academy pages are independent MDT pages. Navigation is handled by the
    // main sidebar, so no in-page tab/sub-navigation is rendered here.
  }
  function shell(title, subtitle, active) {
    root.innerHTML = `<div class="academy-page">
      <header class="academy-head"><div><div class="academy-kicker">POLICE ACADEMY</div><h2>${esc(title)}</h2><div class="academy-subtitle">${esc(subtitle)}</div></div><div class="academy-actions"><button class="academy-btn" id="academyRefresh">Aktualisieren</button></div></header>
      <div id="academyContent"></div>
    </div>`;
    document.getElementById("academyRefresh")?.addEventListener("click", load);
  }

  async function load() {
    try {
      const page = root.dataset.academyPage;
      if (page === "overview") return renderOverview();
      if (page === "documents") return renderDocuments();
      if (page === "tests") return renderTests();
      if (page === "results") return renderResults();
    } catch (e) {
      const el = document.getElementById("academyContent");
      if (el) el.innerHTML = empty(`Der Academy-Bereich konnte nicht geladen werden: ${e?.message || e}`);
    }
  }

  async function getData() { return await call("academyGetData"); }

  async function renderOverview() {
    shell("Police Academy", "Zentrale Ausbildungsstelle für Schulungsunterlagen, Qualifikationen und Eignungstests.", "academy");
    const el = document.getElementById("academyContent");
    const data = await getData();
    el.innerHTML = `<div class="academy-overview-grid">
      <article class="academy-card academy-card-link" data-nav="academy-documents"><div class="academy-card-icon">▤</div><div><h3>Schulungsunterlagen</h3><p>${data.documents.length} Unterlage(n) verfügbar. PDF-Dokumente werden erst beim Öffnen geladen.</p></div></article>
      <article class="academy-card academy-card-link" data-nav="academy-tests"><div class="academy-card-icon">✓</div><div><h3>Prüfungen & Eignungstests</h3><p>${data.tests.length} aktive Prüfung(en) für Rookie-Ausbildung und spezialisierte Qualifikationen.</p></div></article>
      <article class="academy-card academy-card-link" data-nav="academy-results"><div class="academy-card-icon">◫</div><div><h3>Meine Ergebnisse</h3><p>${data.results.length} bisher gespeicherte Prüfungsergebnisse.</p></div></article>
      <article class="academy-card"><div class="academy-card-icon">⌁</div><div><h3>Abteilungszugriff</h3><p>Der Zugriff wird zusätzlich zur Rangberechtigung über die Abteilung aus der Personalakte gesteuert.</p><span class="academy-tag">${esc(data.department || "Keine Abteilung")}</span></div></article>
    </div>`;
    el.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click",()=>{ if(typeof window.navigateToPage === "function") window.navigateToPage(b.dataset.nav); }));
  }

  async function renderDocuments() {
    shell("Schulungsunterlagen", "Ausbildungsunterlagen zentral verwalten und vorhandene PDF-Dokumente direkt bereitstellen.", "academy-documents");
    const el = document.getElementById("academyContent"); const data = await getData();
    const actions = data.manage ? `<div class="academy-section-actions"><button class="academy-btn" id="academyNewDocument">+ Dokument erstellen</button><button class="academy-btn primary" id="academyUploadPdf">+ PDF importieren</button></div>` : "";
    el.innerHTML = `<div class="academy-section-head"><div><h3>Unterlagen</h3><p>PDFs werden nicht in die MDT-Seite eingebettet, sondern nur bei Bedarf geöffnet.</p></div>${actions}</div><div class="academy-grid" id="academyDocumentGrid"></div>`;
    const grid=document.getElementById("academyDocumentGrid");
    grid.innerHTML = data.documents.length ? data.documents.map(d => `<article class="academy-card"><div class="academy-card-top"><span class="academy-tag">${esc(d.category||"Ausbildung")}</span>${d.file_name?'<span class="academy-filetype">PDF</span>':''}</div><h3>${esc(d.title)}</h3><div class="academy-meta">${esc(d.created_by_name||"Unbekannt")} · ${d.updated_at?esc(new Date(d.updated_at).toLocaleDateString("de-DE")):""}</div><div class="academy-content">${esc(d.description||d.content||"").slice(0,320)}</div><div class="academy-test-actions"><button class="academy-btn" data-open-doc="${esc(d.id)}">${d.file_name?"PDF ansehen":"Ansehen"}</button>${data.manage?`${d.file_name?"":`<button class="academy-btn" data-edit-doc="${esc(d.id)}">Bearbeiten</button>`}<button class="academy-btn danger" data-del-doc="${esc(d.id)}">Löschen</button>`:""}</div></article>`).join("") : empty("Noch keine Schulungsunterlagen vorhanden.");
    document.getElementById("academyNewDocument")?.addEventListener("click", ()=>openDocumentEditor());
    document.getElementById("academyUploadPdf")?.addEventListener("click", uploadPdf);
    grid.querySelectorAll("[data-open-doc]").forEach(b=>b.addEventListener("click",async()=>{try{b.disabled=true;b.textContent="PDF wird geöffnet …";const r=await call("academyGetDocumentFile",b.dataset.openDoc);if(!r?.url)throw new Error("Für diese Unterlage ist keine Datei hinterlegt.");const response=await fetch(r.url,{credentials:"omit"});if(!response.ok)throw new Error("Die PDF konnte nicht geladen werden.");const blob=await response.blob();const blobUrl=URL.createObjectURL(blob);const win=window.open(blobUrl,"_blank","noopener,noreferrer");if(!win){URL.revokeObjectURL(blobUrl);throw new Error("Das PDF-Fenster wurde vom Browser blockiert.");}setTimeout(()=>URL.revokeObjectURL(blobUrl),60000);}catch(e){notify(e?.message||"Die Datei konnte nicht geöffnet werden.","error");}finally{b.disabled=false;b.textContent="PDF ansehen";}}));
    grid.querySelectorAll("[data-edit-doc]").forEach(b=>b.addEventListener("click",()=>openDocumentEditor(data.documents.find(d=>String(d.id)===String(b.dataset.editDoc)))));
    grid.querySelectorAll("[data-del-doc]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Schulungsunterlage wirklich löschen?"))return;try{await call("academyDeleteDocument",b.dataset.delDoc);await renderDocuments();}catch(e){notify(e?.message||"Die Unterlage konnte nicht gelöscht werden.","error");}}));
  }

  function openDocumentEditor(existing){
    const overlay=document.createElement("div");overlay.className="academy-modal-overlay";overlay.innerHTML=`<div class="academy-modal"><div class="academy-modal-head"><div><div class="academy-kicker">SCHULUNGSUNTERLAGE</div><h3>${existing?"Dokument bearbeiten":"Dokument erstellen"}</h3></div><button type="button" class="academy-btn" data-close>Schließen</button></div><div class="academy-form"><div class="academy-form-grid"><div class="academy-field"><label>Titel</label><input id="adTitle" value="${esc(existing?.title||"")}"></div><div class="academy-field"><label>Kategorie</label><input id="adCategory" value="${esc(existing?.category||"Ausbildung")}"></div></div><div class="academy-field"><label>Beschreibung / Inhalt</label><textarea id="adContent" style="min-height:180px" placeholder="Schulungsinhalt, Hinweise oder Lernziele …">${esc(existing?.content||existing?.description||"")}</textarea></div><div class="academy-test-actions"><button type="button" class="academy-btn" data-close>Abbrechen</button><button type="button" class="academy-btn primary" id="adSave">Speichern</button></div></div></div>`;document.body.appendChild(overlay);overlay.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>overlay.remove()));overlay.querySelector("#adSave").addEventListener("click",async()=>{try{const title=overlay.querySelector("#adTitle").value.trim();const content=overlay.querySelector("#adContent").value.trim();if(!title||!content)throw new Error("Titel und Inhalt sind erforderlich.");await call("academySaveDocument",{id:existing?.id,title,category:overlay.querySelector("#adCategory").value.trim(),content,description:content.slice(0,240)});overlay.remove();await renderDocuments();notify("Schulungsdokument gespeichert.","success");}catch(e){notify(e?.message||"Das Dokument konnte nicht gespeichert werden.","error");}});
  }

  async function uploadPdf() {
    const title = prompt("Titel der Schulungsunterlage:"); if (!title?.trim()) return;
    const category = prompt("Kategorie (z. B. Grundlagen, Patrol, Detective):", "Ausbildung") || "Ausbildung";
    const input=document.createElement("input"); input.type="file"; input.accept="application/pdf,.pdf"; input.click();
    input.onchange=async()=>{const file=input.files?.[0];if(!file)return;if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){notify("Bitte ausschließlich PDF-Dateien importieren.","error");return;}if(file.size>10*1024*1024){notify("Die PDF darf maximal 10 MB groß sein.","error");return;}const fd=new FormData();fd.append("title",title.trim());fd.append("category",category.trim());fd.append("file",file,file.name);try{const r=await fetch("/api/academy-upload",{method:"POST",headers:{Authorization:`Bearer ${token()}`,Accept:"application/json"},body:fd});const j=await r.json();if(!r.ok||!j.success)throw new Error(j.message||"Upload fehlgeschlagen.");notify("Schulungsunterlage wurde importiert.","success");await renderDocuments();}catch(e){notify(e?.message||"Die PDF konnte nicht importiert werden.","error");}};
  }

  async function renderTests() {
    shell("Prüfungen & Eignungstests", "Rookie-Abschlusstests und spezialisierte Eignungsprüfungen mit unterschiedlichen Fragetypen.", "academy-tests");
    const el=document.getElementById("academyContent"); const data=await getData(); window.__academyRanks=Array.isArray(data.ranks)?data.ranks:[];
    el.innerHTML=`<div class="academy-section-head"><div><h3>Aktive Prüfungen</h3><p>Die eigentliche Prüfung wird außerhalb der MDT-Oberfläche in einem fokussierten Prüfungsfenster ausgefüllt.</p></div>${data.manage?'<div class="academy-section-actions"><button class="academy-btn primary" id="academyNewTest">+ Prüfung erstellen</button></div>':''}</div><div class="academy-grid" id="academyTestGrid"></div>`;
    const grid=document.getElementById("academyTestGrid");
    grid.innerHTML=data.tests.length?data.tests.map(t=>`<article class="academy-card"><div class="academy-card-top"><span class="academy-tag">${esc(t.category||"Qualifikation")}</span><span class="academy-filetype">${(t.questions||[]).length} Fragen</span></div><h3>${esc(t.title)}</h3><div class="academy-meta">Bestehen ab ${Number(t.passing_score||70)} % · ${esc(t.created_by_name||"Unbekannt")}${Array.isArray(t.eligible_rank_ids)&&t.eligible_rank_ids.length?` · Berechtigt: ${t.eligible_rank_ids.map(id=>{const r=(data.ranks||[]).find(x=>String(x.id)===String(id));return esc(r?.name||id)}).join(", ")}`:""}</div><div class="academy-content">${esc(t.description||"Keine Beschreibung hinterlegt.").slice(0,260)}</div><div class="academy-test-actions"><button class="academy-btn primary" data-start-test="${esc(t.id)}">Prüfung starten</button>${data.manage?`<button class="academy-btn" data-edit-test="${esc(t.id)}">Bearbeiten</button><button class="academy-btn danger" data-del-test="${esc(t.id)}">Löschen</button>`:""}</div></article>`).join("") : empty("Noch keine Prüfungen angelegt.");
    document.getElementById("academyNewTest")?.addEventListener("click",()=>openTestEditor());
    grid.querySelectorAll("[data-start-test]").forEach(b=>b.addEventListener("click",()=>launchTest(b.dataset.startTest)));
    grid.querySelectorAll("[data-edit-test]").forEach(b=>b.addEventListener("click",()=>openTestEditor(data.tests.find(t=>String(t.id)===String(b.dataset.editTest)))));
    grid.querySelectorAll("[data-del-test]").forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Prüfung wirklich löschen?"))return;try{await call("academyDeleteTest",b.dataset.delTest);await renderTests();}catch(e){notify(e?.message||"Die Prüfung konnte nicht gelöscht werden.","error");}}));
  }

  async function launchTest(testId){
    const w=window.open("/academy-test.html?test="+encodeURIComponent(testId),"_blank");
    if(!w){notify("Das Prüfungsfenster wurde vom Browser blockiert.","error");return;}
    const payload={type:"LSPD_ACADEMY_SESSION",token:token()};
    const timer=setInterval(()=>{try{w.postMessage(payload,location.origin);}catch(e){}},250);setTimeout(()=>clearInterval(timer),10000);
  }

  function questionTemplate(q,index){
    const type=q?.type||"single_choice";
    const opts=Array.isArray(q?.options)?q.options:["","","",""];
    return `<div class="academy-question" data-question-index="${index}"><div class="academy-question-head"><div><strong>Frage ${index+1}</strong></div><button type="button" class="academy-btn danger small" data-remove-question="${index}">Entfernen</button></div><div class="academy-field"><label>Fragetext</label><textarea data-q-prompt>${esc(q?.prompt||"")}</textarea></div><div class="academy-field"><label>Fragetyp</label><select data-q-type><option value="single_choice" ${type==="single_choice"?"selected":""}>Einfachauswahl</option><option value="multiple_choice" ${type==="multiple_choice"?"selected":""}>Mehrfachauswahl</option><option value="true_false" ${type==="true_false"?"selected":""}>Richtig / Falsch</option></select></div><div data-q-options>${typeOptions(type,opts,q)}</div></div>`;
  }
  function typeOptions(type,opts,q){
    if(type==="true_false") return `<div class="academy-field"><label>Richtige Antwort</label><select data-q-correct><option value="true" ${String(q?.correctAnswer)==="true"?"selected":""}>Richtig</option><option value="false" ${String(q?.correctAnswer)!=="true"?"selected":""}>Falsch</option></select></div>`;
    return `<div class="academy-option-list">${opts.slice(0,4).map((o,i)=>`<div class="academy-option-row"><input type="text" data-q-option value="${esc(o)}" placeholder="Antwort ${i+1}"><label><input type="checkbox" data-q-correct value="${i}" ${Array.isArray(q?.correctAnswers)?q.correctAnswers.map(String).includes(String(i)):(Number(q?.correctAnswer)===i?"checked":"")}> richtig</label></div>`).join("")}</div>`;
  }
  function collectQuestions(container){
    return [...container.querySelectorAll(".academy-question")].map(q => {
      const type = q.querySelector("[data-q-type]")?.value || "single_choice";
      const prompt = q.querySelector("[data-q-prompt]")?.value.trim() || "";
      const questionId = q.dataset.questionIndex;
      if (type === "true_false") {
        return {
          id: questionId,
          prompt: prompt,
          type: type,
          options: ["Richtig", "Falsch"],
          correctAnswer: q.querySelector("[data-q-correct]")?.value || "true"
        };
      }
      const options = [...q.querySelectorAll("[data-q-option]")].map(x => x.value.trim());
      const checks = [...q.querySelectorAll("[data-q-correct]")].filter(x => x.checked).map(x => Number(x.value));
      const result = {
        id: questionId,
        prompt: prompt,
        type: type,
        options: options
      };
      if (type === "multiple_choice") {
        result.correctAnswers = checks;
      } else {
        result.correctAnswer = checks.length ? checks[0] : 0;
      }
      return result;
    });
  }
  function openTestEditor(existing){
    const overlay=document.createElement("div");overlay.className="academy-modal-overlay";overlay.innerHTML=`<div class="academy-modal"><div class="academy-modal-head"><div><div class="academy-kicker">PRÜFUNGSEDITOR</div><h3>${existing?"Prüfung bearbeiten":"Neue Prüfung erstellen"}</h3></div><button type="button" class="academy-btn" data-close>Schließen</button></div><div class="academy-form"><div class="academy-form-grid"><div class="academy-field"><label>Titel</label><input id="aeTitle" value="${esc(existing?.title||"")}" placeholder="z. B. Detective Eignungstest"></div><div class="academy-field"><label>Kategorie</label><input id="aeCategory" value="${esc(existing?.category||"Eignungstest")}" placeholder="Rookie, Detective, K9 …"></div></div><div class="academy-field"><label>Beschreibung</label><textarea id="aeDescription" placeholder="Ziel und Inhalt der Prüfung">${esc(existing?.description||"")}</textarea></div><div class="academy-form-grid"><div class="academy-field"><label>Bestehensgrenze (%)</label><input id="aePassing" type="number" min="1" max="100" value="${Number(existing?.passing_score||70)}"></div><div class="academy-field"><label>Berechtigte Ränge</label><select id="aeRanks" multiple size="6">${(window.__academyRanks||[]).map(r=>`<option value="${esc(r.id)}" ${(Array.isArray(existing?.eligible_rank_ids)?existing.eligible_rank_ids.map(String):[]).includes(String(r.id))?"selected":""}>${esc(r.name)} (Level ${Number(r.level||0)})</option>`).join("")}</select><small>Nur ausgewählte Ränge dürfen diesen Test ablegen.</small></div></div><div class="academy-section-head"><div><h4>Fragen</h4><p>Einfachauswahl, Mehrfachauswahl und Richtig/Falsch werden serverseitig ausgewertet.</p></div><button type="button" class="academy-btn" id="aeAddQuestion">+ Frage</button></div><div id="aeQuestions"></div><div class="academy-test-actions"><button type="button" class="academy-btn" data-close>Abbrechen</button><button type="button" class="academy-btn primary" id="aeSave">Speichern</button></div></div></div>`;document.body.appendChild(overlay);
    const qc=overlay.querySelector("#aeQuestions");let qs=Array.isArray(existing?.questions)&&existing.questions.length?existing.questions:[{type:"single_choice",prompt:"",options:["","","",""],correctAnswer:0}];
    const draw=()=>{qc.innerHTML=qs.map(questionTemplate).join("");qc.querySelectorAll("[data-remove-question]").forEach(b=>b.addEventListener("click",()=>{qs.splice(Number(b.dataset.removeQuestion),1);if(!qs.length)qs.push({type:"single_choice",prompt:"",options:["","","",""],correctAnswer:0});draw();}));qc.querySelectorAll("[data-q-type]").forEach(sel=>sel.addEventListener("change",()=>{const card=sel.closest(".academy-question");const i=Number(card.dataset.questionIndex);qs[i]={...qs[i],type:sel.value};draw();}));};
    draw();overlay.querySelector("#aeAddQuestion").addEventListener("click",()=>{qs.push({type:"single_choice",prompt:"",options:["","","",""],correctAnswer:0});draw();});overlay.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>overlay.remove()));overlay.querySelector("#aeSave").addEventListener("click",async()=>{try{const questions=collectQuestions(qc);if(questions.some(q=>!q.prompt||q.options.filter(Boolean).length<2))throw new Error("Jede Frage benötigt einen Fragetext und mindestens zwei Antwortmöglichkeiten.");const eligibleRankIds=[...overlay.querySelector("#aeRanks").selectedOptions].map(o=>o.value);if(!eligibleRankIds.length)throw new Error("Bitte mindestens einen berechtigten Rang auswählen.");await call("academySaveTest",{id:existing?.id,title:overlay.querySelector("#aeTitle").value.trim(),category:overlay.querySelector("#aeCategory").value.trim(),description:overlay.querySelector("#aeDescription").value.trim(),passingScore:Number(overlay.querySelector("#aePassing").value||70),eligibleRankIds,questions});overlay.remove();await renderTests();notify("Prüfung gespeichert.","success");}catch(e){notify(e?.message||"Die Prüfung konnte nicht gespeichert werden.","error");}});
  }

  async function renderResults(){
    shell("Ergebnisse", "Deine abgeschlossenen Academy-Prüfungen und Qualifikationsnachweise.", "academy-results");
    const el=document.getElementById("academyContent");const data=await getData();
    el.innerHTML=data.results.length?`<div class="academy-table-wrap"><table class="academy-table"><thead><tr><th>Prüfung</th><th>Punktzahl</th><th>Status</th><th>Datum</th></tr></thead><tbody>${data.results.map(r=>`<tr><td>${esc(r.test_title)}</td><td><strong>${Number(r.score||0)} %</strong></td><td><span class="academy-result-badge ${r.passed?"passed":"failed"}">${r.passed?"Bestanden":"Nicht bestanden"}</span></td><td>${r.submitted_at?esc(new Date(r.submitted_at).toLocaleString("de-DE")):""}</td></tr>`).join("")}</tbody></table></div>`:empty("Noch keine Prüfungsergebnisse vorhanden.");
  }

  load();
})();
