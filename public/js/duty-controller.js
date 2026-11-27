/* LSPD MDT duty picker: database-driven, read-only configuration. */
(function () {
  const defaults={
    tenCodes:["10-1","10-3","10-6","10-23","10-76"],
    locations:["LS - City","LS - County","Roxwood County","Highway - East","Highway - West","Highway - City","Highway - Allgemein","Vespucci PD","Paleto SO","Sandy Shores SO","Roxwood SO","Border Station","City Hall","Staatsgefängnis","Police Academy","Krankenhaus","Air Support","Ermittlung","SWAT","Gang Unit","LS - City - Blitz"],
    activities:["Streifenfahrt","Feierabend","Juwelier","Geiselnahme","Raubüberfall","Großschadenslage","Großevent","Beschäftigt","Beschäftigt AD","Ausbildung / Übung","Besprechung","Code-PEE","Transport","Tätigkeitsbearbeitung","Durchsuchung","OOV"],
    vehicles:["STR","STR (UM)","OFF","OFF (UM)","HSP","HSP (UM)","OVW"]
  };
  const labels={tenCode:"Ten Code auswählen",location:"Einsatzort auswählen",activity:"Status auswählen",vehicle:"Fahrzeug auswählen"};
  const picker=document.getElementById('fibDutyPicker'); if(!picker)return;
  picker.innerHTML='<div class="fib-duty-picker-head"><strong id="fibDutyPickerTitle">Auswahl</strong><button type="button" id="fibDutyPickerClose" class="fib-duty-close" aria-label="Auswahl schließen">×</button></div><div class="fib-duty-picker-scroll"><div class="fib-duty-options" id="fibDutyOptions"></div></div>';
  let state={location:'',activity:'',vehicle:'',tenCode:'10-1'}, activeKey='location', onDuty=false, saving=false, ready=false, session='', syncing=false, lastSync=0, generation=0, callSign='';
  let options={tenCode:defaults.tenCodes.slice(),location:defaults.locations.slice(),activity:defaults.activities.slice(),vehicle:defaults.vehicles.slice()};
  let colorConfig={tenCodeColors:{},statusColors:{}};


  function safeColor(value){return typeof value==='string' && /^(#[0-9a-f]{3,8}|rgba?\([0-9\s.,%+-]+\)|hsla?\([0-9\s.,%+-]+\))$/i.test(value.trim())?value.trim():'';}
  function applyTopbarColors(){
    const statusChip=document.querySelector('[data-duty-picker-trigger="activity"]');
    const tenChip=document.querySelector('[data-duty-picker-trigger="tenCode"]');
    const statusColor=safeColor(colorConfig.statusColors?.[state.activity]);
    const tenColor=safeColor(colorConfig.tenCodeColors?.[state.tenCode]);
    if(statusChip){statusChip.removeAttribute('data-db-color');statusChip.style.removeProperty('--fib-db-color');if(statusColor){statusChip.style.setProperty('--fib-db-color',statusColor);statusChip.setAttribute('data-db-color','true');}}
    if(tenChip){tenChip.removeAttribute('data-db-color');tenChip.style.removeProperty('--fib-db-color');if(tenColor){tenChip.style.setProperty('--fib-db-color',tenColor);tenChip.setAttribute('data-db-color','true');}}
  }
  function waitForCloudApi(){
    if(typeof window.runServer==='function') return Promise.resolve();
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=()=>{if(settled)return;settled=true;window.removeEventListener('fib-mdt:cloud-api-ready',finish);resolve();};
      window.addEventListener('fib-mdt:cloud-api-ready',finish,{once:true});
      window.setTimeout(()=>{if(typeof window.runServer==='function')finish();else{settled=true;window.removeEventListener('fib-mdt:cloud-api-ready',finish);reject(new Error('Cloud-API ist nicht verfügbar.'));}},5000);
    });
  }
  let configPromise=null;
  async function loadConfig(){
    if(configPromise)return configPromise;
    configPromise=(async()=>{
      const configToken=token();
      await waitForCloudApi();
      const result=await window.runServer('getPatrolDutyConfig');
      if(!result||result.success===false)throw new Error('Dienst-Konfiguration nicht verfügbar.');
      if(configToken!==token())return result;
      options={tenCode:result.tenCodes||defaults.tenCodes,location:result.locations||defaults.locations,activity:result.activities||defaults.activities,vehicle:result.vehicles||defaults.vehicles};
      colorConfig={tenCodeColors:result.tenCodeColors||{},statusColors:result.statusColors||{}};
      if(!onDuty&&!options.tenCode.includes(state.tenCode))state.tenCode=options.tenCode[0]||'';
      window.__FIB_PATROL_DUTY_CONFIG__=result;update();return result;
    })();
    try{return await configPromise;}catch(error){configPromise=null;throw error;}
  }
  function token(){return sessionStorage.getItem('fib_mdt_session')||sessionStorage.getItem('lspd_mdt_session')||'';}
  function report(error){const message=error?.message||String(error);if(window.MDT?.notify?.error)window.MDT.notify.error('Fehler',message);else console.error(message);}
  function success(message){if(window.MDT?.notify?.success)window.MDT.notify.success('Erfolgreich',message);}
  function adopt(patrol){
    onDuty=!!patrol;
    if(patrol)state={location:String(patrol.location||''),activity:String(patrol.activity||''),vehicle:String(patrol.vehicleType||patrol.vehicle_type||''),tenCode:String(patrol.tenCode||patrol.ten_code||patrol.status||'')};
    update();
  }
  function reset(){onDuty=false;ready=false;callSign='';state={location:'',activity:'',vehicle:'',tenCode:options.tenCode[0]||'10-1'};update();}
  async function sync(force=false){
    const t=token();
    if(t!==session){session=t;generation++;configPromise=null;lastSync=0;syncing=false;saving=false;reset();if(t)loadConfig().catch(console.warn);}
    if(!t||saving||syncing||(!force&&Date.now()-lastSync<15000))return;
    if(typeof window.runServer!=='function')return;
    const g=generation;syncing=true;
    try{const result=await window.runServer('getOwnDuty',t);if(g!==generation||saving)return;if(!result||result.success!==true)throw new Error(result?.message||'Dienststatus konnte nicht geladen werden.');callSign=result.callSign||'';ready=true;adopt(result.patrol);lastSync=Date.now();}
    catch(error){if(g===generation){lastSync=Date.now();if(error.status!==401&&error.status!==403)console.warn('Dienststatus:',error);}}
    finally{if(g===generation)syncing=false;}
  }
  async function mutate(method,detail){
    if(saving||!ready||!token())return;
    const t=token();generation++;const ownGeneration=generation;syncing=false;saving=true;update();
    try{
      const result=await window.runServer(method,t,...(detail?[detail]:[]));
      if(ownGeneration!==generation||t!==token())return;
      if(!result||result.success!==true)throw new Error(result?.message||'Dienständerung konnte nicht gespeichert werden.');
      if(method==='leavePatrol'){onDuty=false;state={location:'',activity:'',vehicle:'',tenCode:options.tenCode[0]||'10-1'};update();success('Du hast deinen Dienst beendet.');}
      else {adopt(result.patrol);if(method==='startDuty')success('Du bist jetzt im Dienst.');}
      lastSync=Date.now();
    }catch(error){if(ownGeneration===generation){report(error);lastSync=0;}}
    finally{if(ownGeneration===generation){saving=false;update();if(!lastSync)sync(true);}}
  }
  function update(){
    const values={fibTopPatrolUnit:state.location||'Einsatzort auswählen',fibTopDutyStatus:state.activity||'Status auswählen',fibTopVehicle:state.vehicle||'Fahrzeug auswählen',fibTopTenCode:state.tenCode||'Ten Code auswählen'};
    Object.keys(values).forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=values[id];});
    applyTopbarColors();
    const call=document.getElementById('fibTopCallSign');if(call)call.textContent=callSign||'—';
    const b=document.getElementById('fibDutyStartButton'); const end=document.getElementById('fibDutyEndButton');
    if(b){b.hidden=onDuty;b.style.display=onDuty?'none':'';b.textContent=onDuty?'Im Dienst':'In Dienst gehen';b.disabled=saving||!ready;}
    if(end){end.hidden=!onDuty;end.style.display=onDuty?'inline-flex':'none';end.disabled=saving||!ready;}
    const hint=document.getElementById('fibDutySelectionHint'); if(hint)hint.textContent=onDuty?'Dienststatus aktiv – Änderungen werden in die bestehende Streife übernommen.':'Einsatzort, Status und Fahrzeug auswählen.';
  }
  function render(key){activeKey=key;picker.querySelector('#fibDutyPickerTitle').textContent=labels[key];const root=picker.querySelector('#fibDutyOptions');root.className='fib-duty-options'+(key==='activity'?' fib-duty-options-warm':'');root.innerHTML='';(options[key]||[]).forEach(item=>{const b=document.createElement('button');b.type='button';b.className='fib-duty-option';b.textContent=item;b.setAttribute('aria-pressed',String(state[key]===item));const c=safeColor(key==='tenCode'?colorConfig.tenCodeColors?.[item]:colorConfig.statusColors?.[item]);if(c){b.style.borderColor=c;b.style.color=c;}b.disabled=saving||!ready;b.addEventListener('click',()=>{close();if(saving||!ready||state[key]===item)return;if(onDuty)mutate('updateOwnDuty',{field:key==='vehicle'?'vehicleType':key,value:item});else{state[key]=item;update();}});root.appendChild(b);});}
  function open(key,trigger){render(key);picker.hidden=false;picker.style.position='fixed';const r=trigger&&trigger.getBoundingClientRect();const w=Math.min(400,innerWidth-16);picker.style.width=w+'px';if(r){picker.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';let top=r.bottom+6;const h=Math.min(innerHeight*.65,500);if(top+h>innerHeight-8)top=Math.max(8,r.top-h-6);picker.style.top=top+'px';picker.style.maxHeight=h+'px';}}
  function close(){picker.hidden=true;document.querySelectorAll('[data-duty-picker-trigger]').forEach(e=>e.setAttribute('aria-expanded','false'));}
  update();
  sync(true);
  document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-duty-picker-trigger]');
    if (trigger) {
      const key = trigger.dataset.dutyPickerTrigger;
      if(!ready||saving)return;open(key, trigger);
      trigger.setAttribute('aria-expanded', 'true');
      return;
    }
    if (e.target.closest('#fibDutyStartButton')) {
      if (!(state.location && state.activity && state.vehicle && state.tenCode)) {
        report('Bitte Einsatzort, Status, Fahrzeug und Ten Code auswählen.');
        return;
      }
      mutate('startDuty',{location:state.location,activity:state.activity,vehicleType:state.vehicle,tenCode:state.tenCode});
      return;
    }
    if(e.target.closest('#fibDutyEndButton')){mutate('leavePatrol');return;}
    if (!picker.hidden && !picker.contains(e.target)) close();
  });
  picker.querySelector('#fibDutyPickerClose').addEventListener('click',close);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!picker.hidden)close();if(ready&&!saving&&(e.key==='Enter'||e.key===' ')&&e.target.matches('[data-duty-picker-trigger]')){e.preventDefault();open(e.target.dataset.dutyPickerTrigger,e.target);}});
  // The controller lives in the shell, never in the dynamically mounted page.
  window.addEventListener('fib-mdt:data-changed',e=>{
    if(/^(joinPatrol|deletePatrol|updatePatrol|createPatrol|setPatrolTenCode)$/.test(e.detail?.method||''))sync(true);
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')sync(true);});
  window.setInterval(()=>{if(token()!==session||document.visibilityState==='visible')sync();},1000);
  window.fibGetPatrolDutyConfig=loadConfig;
  window.FIBDuty={refresh:()=>sync(true)};
})();
