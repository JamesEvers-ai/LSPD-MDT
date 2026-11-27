(() => {
  'use strict';
  const root=document.getElementById('mdt-module-bonuses');
  if(!root||root.dataset.ready)return;
  root.dataset.ready='1';
  const $=id=>root.querySelector('#'+id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const call=(m,...a)=>window.runServer(m,sessionStorage.getItem('fib_mdt_session')||'',...a);
  const fields=[['event','eventCount','event_count','event'],['towing','towingCount','towing_count','towing'],['drugs','drugsCount','drugs_count','drugs'],['entry','entryControlCount','entry_control_count','entry_control']];
  const labels={pending:'Ausstehend',approved:'Genehmigt',rejected:'Abgelehnt',paid:'Ausgezahlt'};
  const money=n=>'$'+Number(n||0).toLocaleString('de-DE',{maximumFractionDigits:2});
  const date=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('de-DE'):'—';
  const localDate=v=>{const d=v?new Date(v):new Date();return Number.isFinite(+d)?new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16):'';};
  const evidenceLink=v=>{try{const u=new URL(v);return u.protocol==='https:'?u.href:'';}catch{return '';}};
  let access={},data=null,accounting=null,activeTab='bonuses',workspace='history',editingId='',editingVersion='',busy=false,loading=null,accountingLoading=null;
  const mounted=()=>root.isConnected;
  function message(text,error=false){if(!mounted())return;const el=$('finance-message');el.textContent=text;el.classList.toggle('is-error',error);el.hidden=!text;}
  function counts(prefix){return Object.fromEntries(fields.map(([key,field])=>[field,Number($(prefix+key).value)]));}
  function total(c){return fields.reduce((sum,[,field,,rate])=>sum+Number(c[field]||0)*Number(data?.rates?.[rate]||0),0);}
  function recalc(prefix){const c=counts(prefix),valid=Object.values(c).every(n=>Number.isSafeInteger(n)&&n>=0);$(prefix+'total').textContent=valid?money(total(c)):'Ungültige Menge';}
  function resetOwn(row=null){
    editingId=row?.id||'';editingVersion=row?.updated_at||'';
    fields.forEach(([key,,col])=>{$('bonus-my-'+key).value=row?.[col]??0;});
    $('bonus-my-date').value=localDate(row?.activity_date);$('bonus-my-description').value=row?.description||'';$('bonus-my-evidence').value=row?.evidence||'';
    $('bonus-my-submit').textContent=editingId?'Änderungen einreichen':'Einreichung senden';$('bonus-my-cancel').hidden=!editingId;
    $('bonus-my-heading').textContent=editingId?'Einreichung bearbeiten':'Neue Bonus-Einreichung';recalc('bonus-my-');
  }
  function payload(prefix){
    const c=counts(prefix);if(Object.values(c).some(n=>!Number.isSafeInteger(n)||n<0)||total(c)<=0)throw new Error('Bitte gültige ganze Aktivitätsmengen angeben.');
    const raw=$(prefix+'date').value,d=new Date(raw);if(!raw||!Number.isFinite(+d))throw new Error('Bitte Datum und Uhrzeit angeben.');
    const description=$(prefix+'description').value.trim(),evidence=$(prefix+'evidence').value.trim();if(!description)throw new Error('Bitte eine Beschreibung angeben.');
    if((prefix==='bonus-my-'||evidence)&&!evidenceLink(evidence))throw new Error('Bitte einen gültigen HTTPS-Nachweislink angeben.');
    return {...c,description,evidence,activityDate:d.toISOString()};
  }
  function setBusy(value){busy=value;root.setAttribute('aria-busy',String(value));root.querySelectorAll('[data-finance-write]').forEach(b=>b.disabled=value);if(data&&Number(data.currentUser?.rankLevel)<=1)$('bonus-my-submit').disabled=true;}
  function renderHistory(){
    if(!data)return;
    const q=$('bonus-search').value.trim().toLowerCase(),filter=$('bonus-filter').value;
    const rows=data.submissions.filter(r=>(filter==='all'||r.status===filter)&&[r.employee_name,r.rank_name,r.description,r.id].join(' ').toLowerCase().includes(q));
    for(const k of Object.keys(labels)){
      const items=data.submissions.filter(r=>r.status===k);$('bonus-count-'+k).textContent=String(items.length);$('bonus-sum-'+k).textContent=money(items.reduce((sum,r)=>sum+Number(r.total_amount||0),0));
    }
    $('bonus-history-count').textContent=`${rows.length} von ${data.submissions.length} Einreichungen${data.truncated?' · Nur die letzten 500 geladen':''}`;
    $('bonus-rows').innerHTML=rows.length?rows.map(r=>{
      const own=String(r.employee_id)===String(data.currentUser.id),review=data.canManage&&r.status==='pending',pay=data.canManage&&r.status==='approved',edit=own&&['pending','rejected'].includes(r.status)&&Number(data.currentUser.rankLevel)>1;
      return `<tr><td><strong class="finance-person">${esc(r.employee_name)}</strong><small>${esc(r.rank_name||'')}</small></td><td>${esc(date(r.activity_date))}</td><td><span class="finance-activities">${fields.map(([key,,col])=>`<span title="${esc({event:"Eventaktivität",towing:"Abschleppen",drugs:"Drogen / Module",entry:"Einlasskontrolle"}[key])}">${esc({event:'EV',towing:'AB',drugs:'DM',entry:'EK'}[key])} <strong>${esc(r[col]||0)}</strong></span>`).join('')}</span></td><td class="finance-total">${money(r.total_amount)}</td><td><span class="finance-status ${esc(r.status)}">${esc(labels[r.status]||r.status)}</span>${r.rejection_reason?`<small class="finance-rejection">${esc(r.rejection_reason)}</small>`:''}</td><td><div class="finance-row-actions"><button class="finance-btn secondary" data-detail="${esc(r.id)}">Details</button>${edit?`<button class="finance-btn secondary" data-edit="${esc(r.id)}">Bearbeiten</button>`:''}${review?`<button class="finance-btn" data-finance-write data-approve="${esc(r.id)}">Genehmigen</button><button class="finance-btn danger" data-finance-write data-reject="${esc(r.id)}">Ablehnen</button>`:''}${pay?`<button class="finance-btn" data-finance-write data-pay="${esc(r.id)}">Auszahlen</button>`:''}</div></td></tr>`;
    }).join(''):'<tr><td colspan="6"><div class="finance-empty">Keine passenden Einreichungen.</div></td></tr>';
    setBusy(busy);
  }
  function setWorkspace(name){
    if(!data)return;
    if(name==='calculator'&&!data.canManage)name='history';
    if(workspace!==name)$('bonus-rates').open=name!=='history';
    workspace=name;
    $('finance-workspace').hidden=false;
    root.querySelectorAll('[data-finance-workspace]').forEach(b=>{b.classList.toggle('active',b.dataset.financeWorkspace===name);b.setAttribute('aria-pressed',String(b.dataset.financeWorkspace===name));if(b.dataset.financeWorkspace==='calculator')b.hidden=!data.canManage;});
    $('bonus-employee-card').hidden=name!=='own';$('bonus-manager-card').hidden=name!=='calculator'||!data.canManage;$('bonus-history-card').hidden=name!=='history';
  }
  function renderEmployees(){const select=$('bonus-calc-employee'),value=select.value;select.innerHTML='<option value="">Mitarbeiter auswählen</option>'+data.eligibleEmployees.map(e=>`<option value="${esc(e.id)}">${esc(e.name)} · ${esc(e.rankName)}${e.callSign?' · '+esc(e.callSign):''}</option>`).join('');if(data.eligibleEmployees.some(e=>String(e.id)===value))select.value=value;}
  async function loadBonus(){
    if(!access.bonuses||!mounted())return;if(loading)return loading;
    loading=(async()=>{try{const next=await call('getBonusData');if(!mounted())return;data=next;setWorkspace(workspace);$('bonus-eligibility').textContent=Number(data.currentUser.rankLevel)>1?`Einreichung für ${data.currentUser.name}`:'Bonusauszahlungen sind erst ab Rang-Level 2 möglich.';$('bonus-my-form').hidden=Number(data.currentUser.rankLevel)<=1;$('bonus-history-title').textContent=data.canManage?'Alle Einreichungen':'Meine Einreichungen';$('bonus-summary').hidden=false;renderEmployees();renderHistory();recalc('bonus-my-');recalc('bonus-calc-');}catch(e){message(e.message||'Bonusdaten konnten nicht geladen werden.',true);}finally{loading=null;}})();return loading;
  }
  async function loadAccounting(){
    if(!access.accounting||!mounted())return;if(accountingLoading)return accountingLoading;
    accountingLoading=(async()=>{try{const a=await call('getAccountingData');if(!mounted())return;accounting=a;$('finance-balance').textContent=money(a.balance);$('finance-balance-box').hidden=false;$('accounting-new').hidden=!a.canManage;$('accounting-balance').hidden=!a.canManage;$('accounting-rows').innerHTML=a.entries.length?a.entries.map(x=>`<tr><td>${esc(date(x.created_at))}</td><td class="finance-entry-${esc(x.entry_type)}">${esc({income:'Einnahme',expense:'Ausgabe',adjustment:'Anpassung'}[x.entry_type]||x.entry_type)}</td><td class="finance-total">${x.entry_type==='expense'?'-':''}${money(x.amount)}</td><td>${esc(x.purpose)}</td><td>${esc(x.description||'')}</td><td>${esc(x.created_by_name||'')}</td></tr>`).join(''):'<tr><td colspan="6"><div class="finance-empty">Noch keine Buchungen vorhanden.</div></td></tr>';}catch(e){message(e.message||'Buchhaltung konnte nicht geladen werden.',true);}finally{accountingLoading=null;}})();return accountingLoading;
  }
  async function write(method,args,success){if(busy)return false;setBusy(true);try{const r=await call(method,...args);if(r?.success===false)throw new Error(r.message||'Aktion fehlgeschlagen.');if(!mounted())return false;await Promise.allSettled([loading,accountingLoading].filter(Boolean));message(success);return true;}catch(e){message(e.message||'Aktion fehlgeschlagen.',true);throw e;}finally{setBusy(false);}}
  async function refresh(){if(busy)return;if(activeTab==='bonuses'){await loadBonus();if(accounting&&access.accounting)await loadAccounting();}else await loadAccounting();}
  function tab(name){activeTab=name;root.querySelectorAll('.finance-tab').forEach(b=>{b.classList.toggle('active',b.dataset.tab===name);b.setAttribute('aria-selected',String(b.dataset.tab===name));});root.querySelectorAll('.finance-panel').forEach(p=>p.hidden=p.id!=='finance-'+name+'-panel');refresh();}
  function details(row){const href=evidenceLink(row.evidence);window.FIB_MDT_MODAL.open({title:'Bonus-Einreichung',subtitle:row.employee_name+' · '+(labels[row.status]||row.status),body:`<div class="finance-dialog"><div class="finance-detail-summary"><strong>${money(row.total_amount)}</strong><span>${esc(date(row.activity_date))}</span></div><div class="finance-field"><label>Beschreibung</label><div class="finance-detail-text">${esc(row.description||'—')}</div></div><div class="finance-field"><label>Nachweis</label>${href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Nachweis öffnen</a>`:'<span>Kein Nachweis hinterlegt (manuelle Vormerkung möglich).</span>'}</div><div class="finance-field"><label>Prüfung / Auszahlung</label><div>${esc(row.reviewed_by_name||'—')} · ${esc(date(row.reviewed_at))}</div><div>${esc(row.paid_by_name||'—')} · ${esc(date(row.paid_at))}</div>${row.rejection_reason?`<p>${esc(row.rejection_reason)}</p>`:''}</div></div>`,cancelText:'Schließen',saveVisible:false});}
  function dialog(title,subtitle,body,saveText,onSave){window.FIB_MDT_MODAL.open({title,subtitle,body:`<div class="finance-dialog">${body}<p id="finance-dialog-error" role="alert" class="finance-rejection"></p></div>`,saveVisible:true,saveText,cancelText:'Abbrechen',onSave:async()=>{const btn=window.FIB_MDT_MODAL.getSaveButton();if(btn.disabled)return;btn.disabled=true;try{if(await onSave()===false)return;if(document.getElementById('finance-dialog-error'))window.FIB_MDT_MODAL.close();await refresh();}catch(e){const el=document.getElementById('finance-dialog-error');if(el)el.textContent=e.message||'Aktion fehlgeschlagen.';}finally{btn.disabled=false;}}});}
  root.querySelectorAll('.finance-tab').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
  root.querySelectorAll('[data-finance-workspace]').forEach(b=>b.onclick=()=>setWorkspace(b.dataset.financeWorkspace));
  for(const prefix of ['bonus-my-','bonus-calc-'])fields.forEach(([key])=>$(prefix+key).addEventListener('input',()=>recalc(prefix)));
  $('bonus-my-cancel').onclick=()=>resetOwn();$('bonus-refresh').onclick=refresh;$('bonus-search').oninput=renderHistory;$('bonus-filter').onchange=renderHistory;
  $('bonus-my-form').onsubmit=async e=>{e.preventDefault();try{const d=payload('bonus-my-');if(await write('saveBonusSubmission',[{...d,id:editingId,expectedUpdatedAt:editingVersion}],'Einreichung gespeichert.')){resetOwn();setWorkspace('history');await loadBonus();}}catch(e){message(e.message,true);}};
  $('bonus-calc-form').onsubmit=async e=>{e.preventDefault();try{const d=payload('bonus-calc-'),employeeId=$('bonus-calc-employee').value;if(!employeeId)throw new Error('Bitte einen Mitarbeiter auswählen.');if(await write('saveBonusForEmployee',[{...d,employeeId}],'Neue Vormerkung gespeichert.')){e.target.reset();$('bonus-calc-date').value=localDate();recalc('bonus-calc-');setWorkspace('history');await loadBonus();}}catch(e){message(e.message,true);}};
  $('bonus-rows').onclick=async e=>{const btn=e.target.closest('button');if(!btn||busy)return;const id=btn.dataset.detail||btn.dataset.edit||btn.dataset.approve||btn.dataset.reject||btn.dataset.pay,row=data?.submissions.find(r=>String(r.id)===id);if(!row)return;
    if(btn.dataset.detail)return details(row);if(btn.dataset.edit){resetOwn(row);setWorkspace('own');$('bonus-employee-card').scrollIntoView({block:'start'});return;}
    if(btn.dataset.reject){dialog('Einreichung ablehnen',row.employee_name,`<div class="finance-field"><label for="finance-reason">Ablehnungsgrund</label><textarea id="finance-reason" rows="4" required placeholder="z. B. Datum / Uhrzeit oder Bodycam-Nachweis fehlt"></textarea></div>`,'Ablehnen',()=>{const reason=document.getElementById('finance-reason').value.trim();if(!reason)throw new Error('Bitte einen Ablehnungsgrund angeben.');return write('rejectBonusSubmission',[row.id,reason,row.updated_at||''],'Einreichung abgelehnt.');});return;}
    if(btn.dataset.approve||btn.dataset.pay){const pay=!!btn.dataset.pay;dialog(pay?'Auszahlung bestätigen':'Einreichung genehmigen',row.employee_name,`<div class="finance-detail-summary"><strong>${money(row.total_amount)}</strong></div><p>${pay?'Der Betrag wird vom Organisationskonto abgebucht und als Ausgabe verbucht.':'Bitte Nachweis und Aktivitäten vor der Genehmigung kontrollieren.'}</p>`,pay?'Jetzt auszahlen':'Genehmigen',()=>write(pay?'payBonusSubmission':'approveBonusSubmission',pay?[row.id]:[row.id,row.updated_at||''],pay?'Bonus ausgezahlt und verbucht.':'Einreichung genehmigt.'));}
  };
  $('accounting-new').onclick=()=>dialog('Neue Buchung','Organisationskonto',`<div class="finance-field"><label>Art</label><select id="finance-type"><option value="income">Einnahme</option><option value="expense">Ausgabe</option></select></div><div class="finance-field"><label>Betrag ($)</label><input id="finance-amount" type="number" min="0.01" step="0.01"></div><div class="finance-field"><label>Verwendungszweck</label><input id="finance-purpose"></div><div class="finance-field"><label>Beschreibung (optional)</label><textarea id="finance-description"></textarea></div>`,'Buchung speichern',()=>{const amount=Number(document.getElementById('finance-amount').value),purpose=document.getElementById('finance-purpose').value.trim();if(!(amount>0)||!purpose)throw new Error('Bitte Betrag und Verwendungszweck angeben.');return write('createAccountingEntry',[{entryType:document.getElementById('finance-type').value,amount,purpose,description:document.getElementById('finance-description').value}],'Buchung gespeichert.');});
  $('accounting-balance').onclick=()=>dialog('Kontostand ändern','Aktuell: '+money(accounting?.balance),`<div class="finance-field"><label>Neuer Kontostand ($)</label><input id="finance-next" type="number" min="0" step="0.01" value="${esc(accounting?.balance||0)}"></div><p>Die Differenz wird als Kontostandsanpassung protokolliert.</p>`,'Kontostand speichern',()=>{const value=document.getElementById('finance-next').value;if(!value||Number(value)<0)throw new Error('Bitte gültigen Kontostand angeben.');return write('setOrgAccountBalance',[Number(value)],'Kontostand aktualisiert.');});
  resetOwn();$('bonus-calc-date').value=localDate();
  window.__fibPageLifecycle.on(window,'fib-mdt:refresh-request',()=>{if(mounted()&&!busy&&!document.getElementById('fibGlobalModalOverlay')?.classList.contains('open'))refresh();});
  (async()=>{try{access=await call('getFinanceAccess');if(!mounted())return;$('bonus-tab').hidden=!access.bonuses;$('accounting-tab').hidden=!access.accounting;if(!access.bonuses&&!access.accounting){message('Du besitzt keine Berechtigung für diesen Bereich.',true);return;}tab(access.bonuses?'bonuses':'accounting');}catch(e){message(e.message||'Berechtigungen konnten nicht geladen werden.',true);}})();
})();
