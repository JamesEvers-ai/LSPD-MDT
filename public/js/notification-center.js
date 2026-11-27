(() => {
  'use strict';
  const $=id=>document.getElementById(id), button=$('fibNotificationButton'),panel=$('fibNotificationPanel'),list=$('fibNotificationList'),badge=$('fibNotificationCount'),summary=$('fibNotificationSummary'),all=$('fibNotificationReadAll');
  if(!button||!panel)return;
  let session='',items=[],busy=false,marking=false,epoch=0;
  const token=()=>sessionStorage.getItem('fib_mdt_session')||'';
  function close(){panel.hidden=true;button.setAttribute('aria-expanded','false');}
  function paint(){
    const n=items.filter(x=>!x.read).length;badge.hidden=!n;badge.textContent=String(n);button.setAttribute('aria-label',`Benachrichtigungen (${n} ungelesen)`);summary.textContent=`${n} ungelesen · letzte ${items.length}`;all.disabled=!n;
    list.replaceChildren();if(!items.length){const empty=document.createElement('p');empty.className='fib-notice-empty';empty.textContent='Keine Benachrichtigungen vorhanden.';list.append(empty);return;}
    for(const item of items){const el=document.createElement('button');el.type='button';el.className='fib-notice'+(item.read?'':' unread');const title=document.createElement('strong'),msg=document.createElement('span'),stamp=document.createElement('small');title.textContent=item.title;msg.textContent=item.message;const date=new Date(item.created_at);stamp.textContent=(Number.isNaN(date.getTime())?'':date.toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}))+(item.read?' · Gelesen':' · Neu');el.append(title,msg,stamp);el.addEventListener('click',async()=>{if(!item.read&&!(await mark([item.id])))return;close();if(['vacations','bonuses','officers','announcements'].includes(item.page)&&typeof navigateTo==='function')navigateTo(item.page);});list.append(el);}
  }
  function syncSession(){const t=token();if(t!==session){session=t;epoch++;items=[];busy=false;marking=false;close();paint();}return t;}
  async function refresh(){const t=syncSession();if(!t||busy||marking||document.visibilityState==='hidden'||typeof window.runServer!=='function')return;busy=true;const e=++epoch;try{const data=await window.runServer('getNotifications',t);if(e!==epoch||t!==token())return;items=Array.isArray(data?.items)?data.items:[];paint();}catch(err){if(e===epoch&&t===token()){summary.textContent='Abruf fehlgeschlagen – erneut öffnen';}}finally{if(e===epoch)busy=false;}}
  async function mark(ids){const t=syncSession();if(!t||!ids.length||marking)return false;marking=true;epoch++;busy=false;all.disabled=true;try{const data=await window.runServer('markNotificationsRead',t,ids);if(t!==token()||data?.success!==true)return false;const set=new Set(ids);items=items.map(x=>set.has(x.id)?{...x,read:true}:x);paint();return true;}catch(err){if(t===token())summary.textContent='Lesestatus konnte nicht gespeichert werden.';return false;}finally{if(t===token()){marking=false;all.disabled=!items.some(x=>!x.read);}}}
  button.addEventListener('click',()=>{syncSession();if(!panel.hidden){close();return;}panel.hidden=false;button.setAttribute('aria-expanded','true');refresh();});$('fibNotificationClose').addEventListener('click',close);all.addEventListener('click',()=>mark(items.filter(x=>!x.read).map(x=>x.id)));
  document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!button.contains(e.target))close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){close();button.focus();}});
  window.addEventListener('fib-mdt:data-changed',e=>{if(e.detail?.method==='logout'){syncSession();close();return;}if(/Vacation|Bonus|Training|ModuleItem/.test(e.detail?.method||''))refresh();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(refresh,30000);setInterval(()=>{if(token()!==session)refresh();},1000);refresh();
})();
