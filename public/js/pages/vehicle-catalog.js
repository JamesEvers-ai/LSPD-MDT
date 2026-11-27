(function(){
 "use strict";
 const CLASSES=[["STR","Straßenwagen"],["STR (UM)","Straßenwagen (UM)"],["OFF","Offroad"],["OFF (UM)","Offroad (UM)"],["HSP","Hochgeschwindigkeit"],["HSP (UM)","Hochgeschwindigkeit (UM)"],["OVW","Overwatch"]];
 const state={items:[],canManage:false,filter:"",search:"",editId:null,loading:null};
 const root=document.getElementById("vehicleCatalogPage");
 const $=id=>root.querySelector("#"+id);
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 async function api(method,...args){if(typeof window.runServer!=="function")throw new Error("API ist nicht verfügbar.");return window.runServer(method,...args);}
 function notify(message,isError){$("vcStatus").textContent=message||"";$("vcStatus").style.color=isError?"#a52832":"#48647e";if(isError&&window.showError)window.showError(message);}
 function renderFilters(){
  $("vcFilters").innerHTML='<button class="vc-filter '+(!state.filter?'active':'')+'" data-class="">Alle Klassen</button>'+CLASSES.map(([v,l])=>'<button class="vc-filter '+(state.filter===v?'active':'')+'" data-class="'+esc(v)+'">'+esc(l)+'</button>').join("");
 }
 function visibleItems(){return state.items.filter(x=>(!state.filter||x.vehicle_class===state.filter)&&(!state.search||[x.name,x.description,x.vehicle_class].join(" ").toLowerCase().includes(state.search.toLowerCase())));}
 function render(){
  renderFilters();$("vcFilters").querySelectorAll("[data-class]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.class===state.filter)));const items=visibleItems();$("vcCount").textContent=items.length+" von "+state.items.length+" Fahrzeugen";
  $("vcGrid").innerHTML=items.length?items.map(x=>'<article class="vc-card"><div class="vc-image">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.innerHTML=\'<span class=&quot;vc-no-image&quot;>BILD NICHT VERFÜGBAR</span>\'">':'<span class="vc-no-image">KEIN BILDMATERIAL</span>')+'</div><div class="vc-card-body"><div class="vc-card-top"><div class="vc-name">'+esc(x.name)+'</div><span class="vc-tag">'+esc(x.vehicle_class)+'</span></div>'+(x.description?'<div class="vc-description">'+esc(x.description)+'</div>':'')+(state.canManage?'<div class="vc-card-actions"><button class="vc-button" data-edit="'+esc(x.id)+'">Bearbeiten</button><button class="vc-button danger" data-delete="'+esc(x.id)+'">Entfernen</button></div>':'')+'</div></article>').join(""):'<div class="vc-empty">Keine Fahrzeuge gefunden. Passe die Suche oder den Klassenfilter an.</div>';
 }
 async function load(){
  if(state.loading)return state.loading;
  if(!root.isConnected)return;
  const button=$("vcRefresh");button.disabled=true;
  if(!state.items.length)$("vcGrid").innerHTML='<div class="vc-loading">Fahrzeugkatalog wird geladen …</div>';
  state.loading=(async()=>{try{const r=await api("getVehicleCatalog");if(!root.isConnected)return;state.items=Array.isArray(r?.items)?r.items:[];state.canManage=!!r?.canManage;$("vcAddButton").hidden=!state.canManage;render();}
  catch(e){if(root.isConnected){if(!state.items.length)$("vcGrid").innerHTML='<div class="vc-empty">'+esc(e.message||"Fahrzeugkatalog konnte nicht geladen werden.")+'</div>';else if(window.showError)window.showError(e.message||"Aktualisierung fehlgeschlagen.");}}finally{button.disabled=false;state.loading=null;}})();return state.loading;
 }
 function resetForm(){state.editId=null;$("vcFormTitle").textContent="Fahrzeug anlegen";$("vcName").value="";$("vcClass").value="STR";$("vcImage").value="";$("vcDescription").value="";notify("");}
 function openForm(item){if(!state.canManage)return;state.editId=item?.id||null;$("vcFormTitle").textContent=item?"Fahrzeug bearbeiten":"Fahrzeug anlegen";$("vcName").value=item?.name||"";$("vcClass").value=item?.vehicle_class||"STR";$("vcImage").value=item?.image_url||"";$("vcDescription").value=item?.description||"";$("vcAdmin").classList.add("open");$("vcName").focus();}
 async function save(){if(!state.canManage)return;const name=$("vcName").value.trim(),vehicleClass=$("vcClass").value,imageUrl=$("vcImage").value.trim(),description=$("vcDescription").value.trim();if(!name){notify("Bitte einen Fahrzeugnamen angeben.",true);return;}if(imageUrl&&!/^https:\/\//i.test(imageUrl)){notify("Bitte einen HTTPS-Bildlink verwenden.",true);return;}const btn=$("vcSave");btn.disabled=true;try{await api("saveVehicleCatalogItem",{id:state.editId,name,vehicleClass,imageUrl,description,active:true});$("vcAdmin").classList.remove("open");resetForm();await load();}catch(e){notify(e.message||"Speichern fehlgeschlagen.",true);}finally{btn.disabled=false;}}
 async function askRemove(id){const item=state.items.find(x=>x.id===id);if(!item||!state.canManage)return;const ok=await window.FIB_MDT_MODAL.confirm({title:"Fahrzeug entfernen?",message:`Soll „${item.name}“ wirklich aus dem Fahrzeugkatalog entfernt werden?`,confirmText:"Entfernen",cancelText:"Abbrechen",danger:true});if(!ok||!root.isConnected)return;try{await api("deleteVehicleCatalogItem",id);await load();}catch(e){if(window.showError)window.showError(e.message||"Entfernen fehlgeschlagen.");}}
 $("vcAddButton").addEventListener("click",()=>{openForm(null);});
 $("vcCancel").addEventListener("click",()=>{$("vcAdmin").classList.remove("open");resetForm();});
 $("vcSave").addEventListener("click",save);
 $("vcRefresh").addEventListener("click",load);
 $("vcSearch").addEventListener("input",e=>{state.search=e.target.value;render();});
 $("vcFilters").addEventListener("click",e=>{const b=e.target.closest("[data-class]");if(!b)return;state.filter=b.dataset.class;render();});
 $("vcGrid").addEventListener("click",e=>{const edit=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete]");if(edit){const item=state.items.find(x=>x.id===edit.dataset.edit);if(item)openForm(item);}if(del)askRemove(del.dataset.delete);});
 load();
})();
