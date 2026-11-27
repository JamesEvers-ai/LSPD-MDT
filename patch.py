from pathlib import Path
p=Path('/mnt/data/v29work/functions/api/[[path]].js')
s=p.read_text()
# Insert bonus/accounting dispatch before vacationDispatch
marker='async function vacationDispatch(method,args,env,token){'
insert=r'''async function financeDispatch(method,args,env,token){
  const supported=["getBonusData","saveBonusSubmission","approveBonusSubmission","rejectBonusSubmission","payBonusSubmission","getAccountingData","createAccountingEntry","setOrgAccountBalance"];
  if(!supported.includes(method)) return undefined;
  const now=new Date().toISOString();
  const rates={event:15000,towing:5000,drugs:5000,entry_control:25000};
  const calcTotal=d=>Number(d.eventCount||0)*rates.event+Number(d.towingCount||0)*rates.towing+Number(d.drugsCount||0)*rates.drugs+Number(d.entryControlCount||0)*rates.entry_control;
  if(method==="getBonusData"){
    const au=await authz(env,token,"bonuses.view");
    const [users,people,ranks,rows]=await Promise.all([
      db(env,"users",{query:{select:"id,name,rank,active,approved",active:"eq.true",approved:"eq.true",order:"name.asc"}}),
      db(env,"personnel",{query:{select:"user_id,department,unit,call_sign"}}),rankRows(env),
      db(env,"fib_bonus_payouts",{query:{select:"id,employee_id,employee_name,rank_id,rank_name,rank_level,event_count,towing_count,drugs_count,entry_control_count,total_amount,status,evidence,description,submitted_at,reviewed_at,reviewed_by_name,paid_at,paid_by_name",order:"submitted_at.desc",limit:"500"}})
    ]);
    const peopleBy=new Map((people||[]).map(p=>[String(p.user_id),p]));
    const rankBy=new Map((ranks||[]).map(r=>[String(r.id),r]));
    const eligible=(users||[]).map(u=>{const r=rankBy.get(String(u.rank))||(ranks||[]).find(x=>String(x.name)===String(u.rank));const p=peopleBy.get(String(u.id))||{};return {...u,rankId:r?.id||u.rank,rankName:r?.name||u.rank||"Kein Rang",rankLevel:Number(r?.level||0),department:p.department||"",unit:p.unit||"",callSign:p.call_sign||""};}).filter(u=>u.rankLevel>1);
    return {rates,eligibleEmployees:eligible,submissions:rows||[],canManage:au.master||au.permissions.includes("bonuses.manage"),currentUser:{id:au.user.id,name:au.user.name,rankLevel:Number(au.user.rankLevel||0)}};
  }
  if(method==="saveBonusSubmission"){
    const au=await authz(env,token,"bonuses.view");
    const d=args[1]||{}; const total=calcTotal(d); if(total<=0)throw new Error("Bitte mindestens eine bonusfähige Aktivität angeben.");
    const existingId=text(d.id); let target=au.user; let rankLevel=0,rankName=au.user.rank||"Kein Rang",rankId=au.user.rank||"";
    const ranks=await rankRows(env);const r=ranks.find(x=>String(x.id)===String(au.user.rank))||ranks.find(x=>String(x.name)===String(au.user.rank));rankLevel=Number(r?.level||0);rankName=r?.name||rankName;rankId=r?.id||rankId;
    if(existingId){
      const existing=(await db(env,"fib_bonus_payouts",{query:{select:"*",id:`eq.${existingId}`,limit:"1"}}))?.[0];
      if(!existing)throw Object.assign(new Error("Bonus-Einreichung nicht gefunden."),{status:404});
      if(!au.master&&!au.permissions.includes("bonuses.manage")&&String(existing.employee_id)!==String(au.user.id))throw Object.assign(new Error("Du darfst nur deine eigene Einreichung bearbeiten."),{status:403});
      if(["paid","approved"].includes(String(existing.status).toLowerCase())&&!au.master&&!au.permissions.includes("bonuses.manage"))throw new Error("Diese Einreichung wurde bereits bearbeitet.");
      const patch={event_count:Number(d.eventCount||0),towing_count:Number(d.towingCount||0),drugs_count:Number(d.drugsCount||0),entry_control_count:Number(d.entryControlCount||0),total_amount:total,evidence:text(d.evidence),description:text(d.description),status:au.permissions.includes("bonuses.manage")||au.master?text(d.status)||existing.status:"pending",updated_at:now};
      const saved=await db(env,"fib_bonus_payouts",{method:"PATCH",query:{id:`eq.${existingId}`,select:"*"},body:patch,prefer:"return=representation"});return saved?.[0]||{...existing,...patch};
    }
    const row={id:id("BON"),employee_id:au.user.id,employee_name:au.user.name,rank_id:rankId,rank_name:rankName,rank_level:rankLevel,event_count:Number(d.eventCount||0),towing_count:Number(d.towingCount||0),drugs_count:Number(d.drugsCount||0),entry_control_count:Number(d.entryControlCount||0),total_amount:total,status:"pending",evidence:text(d.evidence),description:text(d.description),submitted_at:now,created_at:now,created_by:au.user.id,created_by_name:au.user.name};
    const saved=await db(env,"fib_bonus_payouts",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return saved?.[0]||row;
  }
  if(method==="approveBonusSubmission"||method==="rejectBonusSubmission"){
    const au=await authz(env,token,"bonuses.manage");const rid=text(args[1]);const rows=await db(env,"fib_bonus_payouts",{query:{select:"*",id:`eq.${rid}`,limit:"1"}});const row=rows?.[0];if(!row)throw Object.assign(new Error("Bonus-Einreichung nicht gefunden."),{status:404});
    const status=method==="approveBonusSubmission"?"approved":"rejected";const patch={status,reviewed_at:now,reviewed_by:au.user.id,reviewed_by_name:au.user.name,rejection_reason:method==="rejectBonusSubmission"?text(args[2]):""};const saved=await db(env,"fib_bonus_payouts",{method:"PATCH",query:{id:`eq.${rid}`,select:"*"},body:patch,prefer:"return=representation"});return saved?.[0]||{...row,...patch};
  }
  if(method==="payBonusSubmission"){
    const au=await authz(env,token,"bonuses.manage");const rid=text(args[1]);const rows=await db(env,"fib_bonus_payouts",{query:{select:"*",id:`eq.${rid}`,limit:"1"}});const row=rows?.[0];if(!row)throw Object.assign(new Error("Bonus-Einreichung nicht gefunden."),{status:404});if(String(row.status)!=="approved")throw new Error("Nur genehmigte Bonusauszahlungen können ausgezahlt werden.");
    const acct=(await db(env,"fib_org_account",{query:{select:"id,balance",id:"eq.MAIN",limit:"1"}}))?.[0]||{id:"MAIN",balance:0};const amount=Number(row.total_amount||0);if(Number(acct.balance)<amount)throw new Error("Das Organisationskonto verfügt nicht über ausreichend Guthaben.");
    await db(env,"fib_org_account",{method:"PATCH",query:{id:"eq.MAIN"},body:{balance:Number(acct.balance)-amount,updated_at:now,updated_by:au.user.id},prefer:"return=minimal"});
    const entry={id:id("ACC"),entry_type:"expense",amount,purpose:`Bonusauszahlung – ${row.employee_name}`,description:row.description||"Bonusauszahlung",reference_type:"bonus",reference_id:row.id,created_by:au.user.id,created_by_name:au.user.name,created_at:now};await db(env,"fib_accounting_entries",{method:"POST",body:entry,prefer:"return=minimal"});
    const patch={status:"paid",paid_at:now,paid_by:au.user.id,paid_by_name:au.user.name};const saved=await db(env,"fib_bonus_payouts",{method:"PATCH",query:{id:`eq.${rid}`,select:"*"},body:patch,prefer:"return=representation"});return {success:true,item:saved?.[0]||{...row,...patch},balance:Number(acct.balance)-amount};
  }
  if(method==="getAccountingData"){
    const au=await authz(env,token,"accounting.view");const [acct,entries]=await Promise.all([db(env,"fib_org_account",{query:{select:"id,balance,updated_at",id:"eq.MAIN",limit:"1"}}),db(env,"fib_accounting_entries",{query:{select:"id,entry_type,amount,purpose,description,reference_type,reference_id,created_by,created_by_name,created_at",order:"created_at.desc",limit:"500"}})]);return {balance:Number(acct?.[0]?.balance||0),updatedAt:acct?.[0]?.updated_at||null,entries:entries||[],canManage:au.master||au.permissions.includes("accounting.manage")};
  }
  if(method==="createAccountingEntry"){
    const au=await authz(env,token,"accounting.manage");const d=args[1]||{},type=text(d.entryType),amount=Number(d.amount);if(!["income","expense"].includes(type)||!Number.isFinite(amount)||amount<=0)throw new Error("Bitte eine gültige Einnahme oder Ausgabe angeben.");if(!text(d.purpose))throw new Error("Ein Verwendungszweck ist erforderlich.");const acct=(await db(env,"fib_org_account",{query:{select:"id,balance",id:"eq.MAIN",limit:"1"}}))?.[0]||{id:"MAIN",balance:0};const next=Number(acct.balance)+(type==="income"?amount:-amount);if(next<0)throw new Error("Das Organisationskonto kann nicht unter 0 € fallen.");await db(env,"fib_org_account",{method:"PATCH",query:{id:"eq.MAIN"},body:{balance:next,updated_at:now,updated_by:au.user.id},prefer:"return=minimal"});const row={id:id("ACC"),entry_type:type,amount,purpose:text(d.purpose),description:text(d.description),reference_type:"manual",reference_id:null,created_by:au.user.id,created_by_name:au.user.name,created_at:now};const saved=await db(env,"fib_accounting_entries",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return {success:true,entry:saved?.[0]||row,balance:next};
  }
  if(method==="setOrgAccountBalance"){
    const au=await authz(env,token,"accounting.manage");const next=Number(args[1]);if(!Number.isFinite(next)||next<0)throw new Error("Bitte einen gültigen Kontostand ab 0 € eingeben.");const acct=(await db(env,"fib_org_account",{query:{select:"id,balance",id:"eq.MAIN",limit:"1"}}))?.[0]||{id:"MAIN",balance:0};const delta=next-Number(acct.balance||0);await db(env,"fib_org_account",{method:"PATCH",query:{id:"eq.MAIN"},body:{balance:next,updated_at:now,updated_by:au.user.id},prefer:"return=minimal"});if(delta!==0)await db(env,"fib_accounting_entries",{method:"POST",body:{id:id("ACC"),entry_type:"adjustment",amount:Math.abs(delta),purpose:"Manuelle Kontostandsanpassung",description:`Kontostand von ${Number(acct.balance||0).toFixed(2)} € auf ${next.toFixed(2)} € geändert.`,reference_type:"balance_adjustment",reference_id:null,created_by:au.user.id,created_by_name:au.user.name,created_at:now},prefer:"return=minimal"});return {success:true,balance:next};
  }
}

'''
s=s.replace(marker,insert+marker)
# dispatch
s=s.replace('const vacationResult=await vacationDispatch(method,args,env,token); if(vacationResult!==undefined)return vacationResult;', 'const financeResult=await financeDispatch(method,args,env,token); if(financeResult!==undefined)return financeResult;\n const vacationResult=await vacationDispatch(method,args,env,token); if(vacationResult!==undefined)return vacationResult;')
# Academy access: manage rank gate and get data rank info
old='''  if(method==="academyGetData"){
  const au=await academyAccess(env,token,"academy.view");
  const [documents,tests,results]=await Promise.all(['''
new='''  if(method==="academyGetData"){
  const au=await academyAccess(env,token,"academy.view");
  const rankRowsData=await rankRows(env);
  const viewerRank=rankRowsData.find(r=>String(r.id)===String(au.user.rank))||rankRowsData.find(r=>String(r.name)===String(au.user.rank));
  const [documents,tests,results]=await Promise.all(['''
s=s.replace(old,new)
old2='''  const testMap=new Map((tests||[]).map(t=>[String(t.id),t.title]));
  const manage=await academyDepartmentHas(env,au,"academy.manage") && await has(env,au,"academy.manage");
  const safeTests=(tests||[]).map(t=>({...t,questions:(Array.isArray(t.questions)?t.questions:[]).map(q=>manage?q:{id:q.id,prompt:q.prompt,type:q.type,options:q.options||[]})}));
  return {department:au.department,manage,documents:documents||[],tests:safeTests,results:(results||[]).map(r=>({...r,test_title:testMap.get(String(r.test_id))||"Prüfung"}))};'''
new2='''  const testMap=new Map((tests||[]).map(t=>[String(t.id),t.title]));
  const manageDepartment=await academyDepartmentHas(env,au,"academy.manage");
  const manage=manageDepartment && (au.master===true || (viewerRank && Number(viewerRank.level)>=2));
  const visibleTests=(tests||[]).filter(t=>manage || !Array.isArray(t.eligible_rank_ids) || !t.eligible_rank_ids.length || t.eligible_rank_ids.map(String).includes(String(viewerRank?.id||au.user.rank)));
  const safeTests=visibleTests.map(t=>({...t,questions:(Array.isArray(t.questions)?t.questions:[]).map(q=>manage?q:{id:q.id,prompt:q.prompt,type:q.type,options:q.options||[]})}));
  return {department:au.department,manage,viewerRank:{id:viewerRank?.id||au.user.rank,name:viewerRank?.name||au.user.rank||"Kein Rang",level:Number(viewerRank?.level||0)},ranks:rankRowsData,documents:documents||[],tests:safeTests,results:(results||[]).map(r=>({...r,test_title:testMap.get(String(r.test_id))||"Prüfung"}))};'''
s=s.replace(old2,new2)
# documents and test save manage gate
s=s.replace('const au=await academyAccess(env,token,"academy.manage"),d=args[1]||{},title=text(d.title),content=text(d.content);', 'const au=await academyAccess(env,token,"academy.manage"); const academyRanks=await rankRows(env); const academyViewerRank=academyRanks.find(r=>String(r.id)===String(au.user.rank))||academyRanks.find(r=>String(r.name)===String(au.user.rank)); if(!au.master&&Number(academyViewerRank?.level||0)<2)throw Object.assign(new Error("Die Verwaltung der Academy ist erst ab Rang-Level 2 freigeschaltet."),{status:403}); const d=args[1]||{},title=text(d.title),content=text(d.content);')
s=s.replace('const au=await academyAccess(env,token,"academy.manage"),d=args[1]||{},title=text(d.title),questions=Array.isArray(d.questions)?d.questions:[];', 'const au=await academyAccess(env,token,"academy.manage"); const academyRanks=await rankRows(env); const academyViewerRank=academyRanks.find(r=>String(r.id)===String(au.user.rank))||academyRanks.find(r=>String(r.name)===String(au.user.rank)); if(!au.master&&Number(academyViewerRank?.level||0)<2)throw Object.assign(new Error("Die Verwaltung der Academy ist erst ab Rang-Level 2 freigeschaltet."),{status:403}); const d=args[1]||{},title=text(d.title),questions=Array.isArray(d.questions)?d.questions:[];')
# test save row include eligible rank ids
s=s.replace('const row={title,category:text(d.category)||"Qualifikation",description:text(d.description),passing_score:', 'const eligibleRankIds=[...new Set((Array.isArray(d.eligibleRankIds)?d.eligibleRankIds:[]).map(text).filter(Boolean))];\n  if(!eligibleRankIds.length)throw new Error("Bitte mindestens einen berechtigten Rang auswählen.");\n  const row={title,category:text(d.category)||"Qualifikation",description:text(d.description),eligible_rank_ids:eligibleRankIds,passing_score:')
# test attempt eligibility
old3='''  const test=tests?.[0];if(!test)throw Object.assign(new Error("Prüfung nicht gefunden."),{status:404});const questions=(Array.isArray(test.questions)?test.questions:[]).map(q=>({id:q.id,prompt:q.prompt,type:q.type,options:q.options||[]}));return {...test,questions};'''
new3='''  const test=tests?.[0];if(!test)throw Object.assign(new Error("Prüfung nicht gefunden."),{status:404}); const attemptRanks=await rankRows(env); const attemptRank=attemptRanks.find(r=>String(r.id)===String(au.user.rank))||attemptRanks.find(r=>String(r.name)===String(au.user.rank)); const allowed=Array.isArray(test.eligible_rank_ids)?test.eligible_rank_ids.map(String):[]; if(allowed.length&&!allowed.includes(String(attemptRank?.id||au.user.rank)))throw Object.assign(new Error("Dein Rang ist für diesen Test nicht berechtigt."),{status:403}); const questions=(Array.isArray(test.questions)?test.questions:[]).map(q=>({id:q.id,prompt:q.prompt,type:q.type,options:q.options||[]}));return {...test,questions};'''
s=s.replace(old3,new3)
# submit test eligibility
old4='''  const test=tests?.[0];if(!test)throw Object.assign(new Error("Prüfung nicht gefunden."),{status:404});
  const qs='''
new4='''  const test=tests?.[0];if(!test)throw Object.assign(new Error("Prüfung nicht gefunden."),{status:404}); const submitRanks=await rankRows(env); const submitRank=submitRanks.find(r=>String(r.id)===String(au.user.rank))||submitRanks.find(r=>String(r.name)===String(au.user.rank)); const allowedSubmit=Array.isArray(test.eligible_rank_ids)?test.eligible_rank_ids.map(String):[]; if(allowedSubmit.length&&!allowedSubmit.includes(String(submitRank?.id||au.user.rank)))throw Object.assign(new Error("Dein Rang ist für diesen Test nicht berechtigt."),{status:403});
  const qs='''
s=s.replace(old4,new4)
p.write_text(s)
