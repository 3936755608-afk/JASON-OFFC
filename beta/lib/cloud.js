/* 云同步（Firebase）：登录 + 数据存取。两个 App 共用。
   数据路径：users/{登录账号}/{集合名}/{记录id}，访问规则只允许本人读写。 */
(function(){
const cfg={apiKey:"AIzaSyCOcKF3hQivqpY3ZEZe8eS3G40gKyqK5jI",authDomain:"chejian-pandian.firebaseapp.com",projectId:"chejian-pandian",
  storageBucket:"chejian-pandian.firebasestorage.app",messagingSenderId:"919626262912",appId:"1:919626262912:web:8021d6f041e8eb6a1f3965"};
firebase.initializeApp(cfg);
const auth=firebase.auth(),fs=firebase.firestore();
const persist=fs.enablePersistence({synchronizeTabs:true}).catch(()=>{});
let uid=null,onRemote=null,pending=0;const SFX=window.CLOUD_SUFFIX||"";const remoteFns=new Set();
const listeners=new Set();

/* ---------- status pill ---------- */
function status(){
  const el=document.getElementById("cloudStatus");if(!el)return;
  const on=navigator.onLine;
  el.className="sync "+(on?(pending?"":"ok"):"bad");
  el.querySelector("span").textContent=!uid?"未登录":on?(pending?"正在上传…":"已同步到云端"):"离线，联网后自动上传";
}
window.addEventListener("online",status);window.addEventListener("offline",status);
function fire(p){pending++;status();p.then(()=>{pending--;status()},e=>{pending--;status();console.error(e);
  const b=document.getElementById("banner");if(b){b.hidden=false;b.textContent="有一条记录没能保存到云端（"+(e&&e.code||"错误")+"）。请检查网络后刷新页面。"}});return Promise.resolve()}

/* ---------- login overlay ---------- */
function loginUI(){
  return new Promise(res=>{
    const css=`#cl-ov{position:fixed;inset:0;z-index:1000;background:var(--bg,#eef1f3);display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-left,0px))}
#cl-box{background:var(--panel,#fff);color:var(--ink,#1b2328);border:1px solid var(--line,#d3dade);border-radius:14px;padding:22px;width:min(380px,100%);display:flex;flex-direction:column;gap:12px;font-family:var(--f-body,system-ui)}
#cl-box h2{margin:0;font-size:20px}#cl-box p{margin:0;color:var(--muted,#5d6a72);font-size:14px}
#cl-box input{border:1px solid var(--line,#d3dade);background:var(--bg,#eef1f3);color:inherit;border-radius:8px;padding:10px 12px;min-height:46px;font-size:16px;width:100%;box-sizing:border-box}
#cl-box button{min-height:48px;border-radius:8px;border:0;background:var(--accent,#1f5f7a);color:var(--accent-ink,#fff);font-size:17px;font-weight:700;cursor:pointer}
#cl-err{color:var(--danger,#b3261e);font-size:14px;min-height:20px}`;
    const st=document.createElement("style");st.textContent=css;document.head.appendChild(st);
    const ov=document.createElement("div");ov.id="cl-ov";
    ov.innerHTML=`<form id="cl-box" autocomplete="on"><h2>登录</h2><p>用你在 Firebase 里建的邮箱和密码登录。电脑、iPad、手机用同一个账号，数据自动同步。</p>
      <input id="cl-email" type="email" placeholder="邮箱" autocomplete="username" required>
      <input id="cl-pw" type="password" placeholder="密码" autocomplete="current-password" required>
      <button type="submit" id="cl-go">登录</button><div id="cl-err" role="alert"></div></form>`;
    document.body.appendChild(ov);
    const f=ov.querySelector("form");
    f.addEventListener("submit",async e=>{e.preventDefault();const b=document.getElementById("cl-go"),er=document.getElementById("cl-err");
      b.disabled=true;b.textContent="正在登录…";er.textContent="";
      try{await auth.signInWithEmailAndPassword(document.getElementById("cl-email").value.trim(),document.getElementById("cl-pw").value);ov.remove();res()}
      catch(err){const c=err&&err.code||"";
        er.textContent=/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)?"邮箱或密码不对，请再试一次。":/network/.test(c)?"连不上网络。第一次登录需要联网。":/too-many/.test(c)?"试错次数太多，请稍等几分钟再试。":"登录失败："+c;
        b.disabled=false;b.textContent="登录"}});
  });
}
const ready=(async()=>{
  await persist;
  const u=await new Promise(r=>{const un=auth.onAuthStateChanged(x=>{un();r(x)})});
  if(!u)await loginUI();
  uid=auth.currentUser.uid;status();
  auth.onAuthStateChanged(x=>{if(!x)location.reload()});
  return uid;
})();

/* ---------- live query cache ---------- */
function live(q){
  const L={map:new Map(),unsub:null,first:true};
  L.ready=new Promise(res=>{
    L.unsub=q.onSnapshot(snap=>{
      snap.docChanges().forEach(ch=>{if(ch.type==="removed")L.map.delete(ch.doc.id);else L.map.set(ch.doc.id,ch.doc.data())});
      if(L.first){L.first=false;res()}else if(!snap.metadata.hasPendingWrites){if(onRemote)onRemote();remoteFns.forEach(f=>{try{f()}catch(e){console.error(e)}})}
    },err=>{console.error(err);if(L.first){L.first=false;res()}});
  });
  L.list=()=>[...L.map.values()];
  listeners.add(L);return L;
}
/* ---------- BOSS 授权：所有改动都要先确认、输授权码（5 分钟内不用重输） ---------- */
const LOGN=window.CLOUD_LOG||"pandian_log",PINC=window.CLOUD_PIN||"pandian_kv";   // 销售 App 用自己的操作记录和授权码，不和车间混
const FREE=new Set(["pandian_sum","pandian_log",LOGN]);          // 自动算出来的汇总和操作记录本身，不用授权
const AUTH_MS=5*60*1000,GRACE_MS=1000;let scope=0;
let curGid=null,lastCancel=0,authUntil=0,graceUntil=0,graceCap=0,gq=[],gTimer=null,bad=0,badUntil=0,pinCache=null;
const FL={m:"型号",L:"长度",w:"支重",q:"支数",s:"状态",n:"备注",d:"日期",p:"页码",pq:"上次支数",lines:"明细",cust:"客户",name:"名称",contact:"联系人",phone:"电话",addr:"地址",pay:"付款方式",note:"备注",amt:"金额",way:"方式",text:"内容",next:"下次跟进",car:"车牌",driver:"司机",kg:"过磅重量",order:"订单"};
const CN={pandian_records:"盘点记录",chuhuo_stock:"出货库存",chuhuo_alloc:"出货分配",chuhuo_cust:"客户",chuhuo_plant:"加工厂",chuhuo_pick:"提货单",
  xs_cust:"客户",xs_follow:"跟进记录",xs_quote:"报价单",xs_order:"订单",xs_ship:"发货单",xs_pay:"收款",xs_ingot:"铝锭价",xs_prod:"产品规格"};
const md=d=>d?String(d).slice(5).replace("-","/")+" ":"";
const showV=v=>v==null||v===""?"空":Array.isArray(v)?v.length+" 行":typeof v==="object"?"（已修改）":String(v);
function nm(c,v){if(!v)return "";if(/^xs_/.test(c)&&!v.m)return (v.no||v.name||"")+(v.d&&!v.no&&!v.name?md(v.d):"");if(c==="pandian_records"||v.m)return md(v.d)+(v.m||"")+(v.L!=null?" "+v.L+"米":"")+(v.w!=null?" "+v.w:"");return v.name||v.no||v.id||""}
function dUpd(c,pre,patch){const ch=Object.keys(patch).filter(k=>k!=="hist"&&k!=="t"&&(!pre||JSON.stringify(pre[k])!==JSON.stringify(patch[k])));
  if(!ch.length)return null;return (CN[c]||c)+"："+nm(c,Object.assign({},pre,patch))+"　"+ch.map(k=>(FL[k]||k)+" "+(pre?showV(pre[k]):"空")+" → "+showV(patch[k])).join("，")}
function dPut(c,pre,v){return pre?dUpd(c,pre,v):"新增"+(CN[c]||c)+"："+nm(c,v)+(v.q!=null?"　"+v.q+" 支":"")+(v.s?"　"+v.s:"")}
function dDel(c,pre,id){return "删除"+(CN[c]||c)+"："+(nm(c,pre)||id)+(pre&&pre.q!=null?"　"+pre.q+" 支":"")}
function kvName(k){return k==="billet"?"标准胚料加工费":k==="colors"?"颜色加工费表":k==="catalog"?"型号库（录入下拉用）":k==="stdlib_review"?"型号标准库审核":/^checks_/.test(k)?"查错核对 "+md(k.slice(7)).trim():k}
const metaDoc=()=>fs.doc("users/"+uid+"/"+PINC+SFX+"/_boss");
const logCol=()=>fs.collection("users/"+uid+"/"+LOGN+SFX);
async function sha(t){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function getPin(){if(pinCache)return pinCache;try{const s=await metaDoc().get();pinCache=s.exists?s.data():null}catch(e){pinCache=null}return pinCache}
async function setPin(pin){const salt=Math.random().toString(36).slice(2)+Date.now().toString(36);const v={salt,hash:await sha(salt+"|"+pin),at:new Date().toISOString()};await metaDoc().set(v);pinCache=v}
async function okPin(pin){const m=await getPin();return !!m&&await sha(m.salt+"|"+pin)===m.hash}
let gcss=false;
function gStyle(){if(gcss)return;gcss=true;const st=document.createElement("style");st.textContent=`
#bg-ov{position:fixed;inset:0;z-index:2000;background:rgba(10,20,28,.55);display:flex;align-items:center;justify-content:center;padding:16px;margin:0;border:0;width:100%;height:100%;max-width:none;max-height:none;box-sizing:border-box;color:inherit}
#bg-ov::backdrop{background:transparent}
#bg-box{background:var(--panel,#fff);color:var(--ink,#1b2328);border-radius:16px;padding:20px;width:min(460px,100%);max-height:90vh;overflow:auto;display:flex;flex-direction:column;gap:12px;font-family:var(--f-body,system-ui);box-shadow:0 10px 40px rgba(0,0,0,.3)}
#bg-box h2{margin:0;font-size:20px;display:flex;align-items:center;gap:8px}#bg-box h2 b{background:#c00000;color:#fff;border-radius:6px;padding:1px 8px;font-size:13px}
#bg-box ul{margin:0;padding:10px 12px 10px 28px;background:var(--bg,#eef1f3);border-radius:10px;font-size:16px;line-height:1.5;max-height:40vh;overflow:auto;overflow-wrap:anywhere}
#bg-box p{margin:0;color:var(--muted,#5d6a72);font-size:14px}
#bg-box input{border:2px solid #bf8f00;background:#fff2cc;color:#1b2328;border-radius:10px;padding:8px 12px;min-height:54px;font-size:26px;letter-spacing:10px;text-align:center;width:100%;box-sizing:border-box}
#bg-err{color:var(--danger,#b3261e);font-size:15px;font-weight:700;min-height:20px}
#bg-box .row{display:flex;gap:10px}#bg-box .row button{flex:1;min-height:52px;border-radius:10px;font-size:18px;font-weight:700;cursor:pointer;border:1px solid var(--line,#d3dade);background:var(--panel,#fff);color:inherit}
#bg-box .row button.go{background:#c00000;border-color:#c00000;color:#fff}
#bg-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2001;background:#1b2328;color:#fff;border-radius:10px;padding:10px 16px;font-size:16px;max-width:90vw}`;document.head.appendChild(st)}
function toast(t){gStyle();let el=document.getElementById("bg-toast");if(!el){el=document.createElement("div");el.id="bg-toast";document.body.appendChild(el)}el.textContent=t;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>{el.hidden=true},3500)}
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// 弹窗：mode = confirm（已授权，只确认）/ pin（要输授权码）/ setup（第一次设授权码）/ change（改授权码）
function dialog({title,items,mode,note}){
  gStyle();return new Promise(res=>{
    // 用 <dialog> 的 showModal 打开：这样即使页面上已经开着别的弹窗（例如“确认提货”），授权框也在最上面、能点
    const modal=typeof HTMLDialogElement==="function";
    const ov=document.createElement(modal?"dialog":"div");ov.id="bg-ov";const many=items&&items.length>12;
    const li=items?(items.slice(0,12).map(t=>`<li>${esc(t)}</li>`).join("")+(many?`<li>……还有 ${items.length-12} 项</li>`:"")):"";
    const inp=(id,ph)=>`<input id="${id}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="${ph}">`;
    ov.innerHTML=`<div id="bg-box" role="dialog" aria-modal="true"><h2>${esc(title)} <b>BOSS</b></h2>${li?`<ul>${li}</ul>`:""}${note?`<p>${esc(note)}</p>`:""}
      ${mode==="pin"?inp("bg-p1","6 位授权码"):mode==="setup"?inp("bg-p1","设置 6 位授权码")+inp("bg-p2","再输一次"):mode==="change"?inp("bg-p0","原来的授权码")+inp("bg-p1","新的 6 位授权码")+inp("bg-p2","再输一次"):""}
      <div id="bg-err" role="alert"></div><div class="row"><button type="button" id="bg-no">取消</button><button type="button" class="go" id="bg-ok">${mode==="confirm"?"确认修改":"授权并修改"}</button></div></div>`;
    if(mode==="setup"||mode==="change")ov.querySelector("#bg-ok").textContent="保存授权码";
    document.body.appendChild(ov);if(modal){try{ov.showModal()}catch(e){}ov.addEventListener("cancel",e=>{e.preventDefault();done(false)})}
    const $=id=>ov.querySelector("#"+id),err=t=>{$("bg-err").textContent=t};
    const first=ov.querySelector("input")||$("bg-ok");setTimeout(()=>first.focus(),30);
    let fin=false;function done(v){if(fin)return;fin=true;try{if(modal&&ov.open)ov.close()}catch(e){}ov.remove();res(v)}
    $("bg-no").onclick=()=>done(false);
    ov.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("bg-ok").click()}if(e.key==="Escape")done(false)});
    $("bg-ok").onclick=async()=>{
      const p1=$("bg-p1")&&$("bg-p1").value.trim(),p2=$("bg-p2")&&$("bg-p2").value.trim();
      if(mode==="confirm")return done(true);
      if(mode==="pin"){if(Date.now()<badUntil)return err("错太多次了，请 1 分钟后再试。");
        if(!/^\d{6}$/.test(p1||""))return err("请输入 6 位数字。");
        if(await okPin(p1)){bad=0;return done(true)}bad++;if(bad>=5){badUntil=Date.now()+60000;bad=0}$("bg-p1").value="";return err("授权码不对，请再试一次。")}
      if(mode==="change"){const p0=$("bg-p0").value.trim();if(!(await okPin(p0)))return err("原来的授权码不对。")}
      if(!/^\d{6}$/.test(p1||""))return err("授权码要 6 位数字。");if(p1!==p2)return err("两次输入的不一样。");
      try{await setPin(p1);done(true)}catch(e){err("保存失败，请检查网络后再试。")}};
  })}
let logSeq=0;
async function writeLog(items,undo,intent){try{const t=Date.now()*1000+(logSeq++%1000),id=t.toString(36)+Math.random().toString(36).slice(2,6);
  fire(logCol().doc(id).set({id,t,at:new Date().toISOString(),gid:curGid,intent:!!intent,items:items.slice(0,200),n:items.length,undo:undo||null,undone:false}))}catch(e){console.error(e)}}
// 排队：同一次操作里连续发出的改动，合成一次确认
function gate(items,undo,refresh,intent){
  items=items.filter(Boolean);
  if(!items.length)return Promise.resolve();
  const now=Date.now();
  if(now<authUntil&&(scope>0||(now<graceUntil&&now<graceCap))){graceUntil=now+GRACE_MS;writeLog(items,undo,intent);return Promise.resolve()}
  return new Promise((res,rej)=>{gq.push({items,undo,refresh,intent,res,rej});clearTimeout(gTimer);gTimer=setTimeout(runGate,40)})}
let gBusy=false;
async function runGate(){
  if(gBusy)return;gBusy=true;const q=gq;gq=[];
  try{
    const items=[].concat(...q.map(x=>x.items));let ok;
    const m=await getPin();
    if(!m){ok=await dialog({title:"第一次使用：设置授权码",mode:"setup",note:"以后所有改动都要用这个授权码。请记住它，不要告诉别人。"});
      if(ok)ok=await dialog({title:"确认修改",items,mode:"confirm",note:"授权码已设置。下面是这次要改的内容："})}
    else if(Date.now()<authUntil)ok=await dialog({title:"确认修改",items,mode:"confirm",note:"授权还剩 "+Math.ceil((authUntil-Date.now())/60000)+" 分钟，不用再输授权码。"});
    else ok=await dialog({title:"需要授权",items,mode:"pin",note:"输入授权码后，5 分钟内的改动不用再输。"});
    if(ok){const t=Date.now();authUntil=t+AUTH_MS;graceUntil=t+GRACE_MS;graceCap=t+5000;
      curGid=t.toString(36)+Math.random().toString(36).slice(2,5);
      q.forEach(x=>writeLog(x.items,x.undo,x.intent));
      q.forEach(x=>x.res())}
    else{lastCancel=Date.now();toast("已取消，没有修改任何数据。");q.forEach(x=>{const e=new Error("已取消");e.code="cancelled";e.cancelled=true;x.rej(e)});
      const rf=q.map(x=>x.refresh).filter(Boolean);setTimeout(async()=>{for(const f of rf){try{await f()}catch(e){}}remoteFire()},50)}
  }finally{gBusy=false;if(gq.length)runGate()}
}
function remoteFire(){if(onRemote)onRemote();remoteFns.forEach(f=>{try{f()}catch(e){console.error(e)}})}
const BIG=50;
async function pre(col,id){try{const s=await col().doc(id).get({source:"cache"});if(s.exists)return s.data()}catch(e){}try{const s=await col().doc(id).get();return s.exists?s.data():null}catch(e){return null}}

function store(name){
  const col=()=>fs.collection("users/"+uid+"/"+name+SFX);
  const free=FREE.has(name);
  let dayL=null,dayKey=null,allL=null;
  const maps=()=>[dayL,allL].filter(Boolean);
  const local=(v)=>{if(dayL&&v.d===dayKey)dayL.map.set(v.id,v);if(allL)allL.map.set(v.id,v)};
  const unlocal=id=>maps().forEach(L=>L.map.delete(id));
  const find=id=>{for(const L of maps())if(L.map.has(id))return L.map.get(id);return null};
  // 取消时：把画面上已经改掉的那几条，按云端原样放回去
  const refresher=ids=>async()=>{for(const id of ids){const v=await pre(col,id);if(v)local(v);else unlocal(id)}};
  async function batched(ops){for(let i=0;i<ops.length;i+=400){const b=fs.batch();ops.slice(i,i+400).forEach(f=>f(b));fire(b.commit())}}
  return{
    async byDay(d){await ready;if(dayKey!==d){if(dayL)dayL.unsub();listeners.delete(dayL);dayKey=d;dayL=live(col().where("d","==",d))}await dayL.ready;return dayL.list()},
    async all(){await ready;if(!allL)allL=live(col());await allL.ready;return allL.list()},
    async allOnce(){await ready;const s=await col().get();return s.docs.map(x=>x.data())},
    async query(field,op,val){await ready;const s=await col().where(field,op,val).get();return s.docs.map(x=>x.data())},
    async lastDayBefore(d){await ready;const s=await col().where("d","<",d).orderBy("d","desc").limit(1).get();return s.empty?null:s.docs[0].data().d},
    async get(id){await ready;const v=find(id);if(v)return v;const s=await col().doc(id).get();return s.exists?s.data():undefined},
    async put(v){await ready;if(!free){const b=await pre(col,v.id);await gate([dPut(name,b,v)],[{c:name,id:v.id,before:b}],refresher([v.id]))}local(v);return fire(col().doc(v.id).set(v))},
    async update(id,patch){await ready;if(!free){const b=await pre(col,id);await gate([dUpd(name,b,patch)],[{c:name,id,before:b}],refresher([id]))}
      const o=find(id);if(o)local(Object.assign({},o,patch));return fire(col().doc(id).set(patch,{merge:true}))},
    async del(id){await ready;if(!free){const b=await pre(col,id);await gate([dDel(name,b,id)],[{c:name,id,before:b}],refresher([id]))}unlocal(id);return fire(col().doc(id).delete())},
    async putMany(vs){await ready;if(!vs.length)return;
      if(!free){let items,undo=null;
        if(vs.length<=BIG){const bs=await Promise.all(vs.map(v=>pre(col,v.id)));items=vs.map((v,i)=>dPut(name,bs[i],v));undo=vs.map((v,i)=>({c:name,id:v.id,before:bs[i]}))}
        else{const ds=[...new Set(vs.map(v=>v.d).filter(Boolean))].sort();items=["写入"+(CN[name]||name)+" "+vs.length+" 条"+(ds.length?"（"+ds.map(md).join("、").trim()+"）":"")+"。数量多，这一步不能撤销，可以用备份恢复。"]}
        await gate(items.filter(Boolean).length?items:["重新写入"+(CN[name]||name)+" "+vs.length+" 条（内容不变）"],undo,refresher(vs.map(v=>v.id)))}
      vs.forEach(local);return batched(vs.map(v=>b=>b.set(col().doc(v.id),v)))},
    async delMany(ids){await ready;if(!ids.length)return;
      if(!free){let items,undo=null;
        if(ids.length<=BIG){const bs=await Promise.all(ids.map(id=>pre(col,id)));items=ids.map((id,i)=>dDel(name,bs[i],id));undo=ids.map((id,i)=>({c:name,id,before:bs[i]}))}
        else items=["删除"+(CN[name]||name)+" "+ids.length+" 条。数量多，这一步不能撤销，可以用备份恢复。"];
        await gate(items,undo,refresher(ids))}
      ids.forEach(unlocal);return batched(ids.map(id=>b=>b.delete(col().doc(id))))},
  };
}
function kv(name){
  const doc=k=>fs.doc("users/"+uid+"/"+name+SFX+"/"+k);
  return{async get(k){await ready;const s=await doc(k).get();return s.exists?s.data().v:undefined},
         async set(k,v){await ready;
           let b;try{const s=await doc(k).get();b=s.exists?s.data().v:undefined}catch(e){}
           if(JSON.stringify(b)!==JSON.stringify(v)&&!(b===undefined&&k==="catalog")){  // 第一次建默认型号库不用授权
             let what="修改"+kvName(k);
             if(k==="catalog"&&Array.isArray(b)&&Array.isArray(v)){const key=x=>x.m+" "+x.L+"米 "+x.w,A=new Set(b.map(key)),B=new Set(v.map(key));
               const add=[...B].filter(x=>!A.has(x)),del=[...A].filter(x=>!B.has(x));what=[...add.map(x=>"型号库新增："+x),...del.map(x=>"型号库删除："+x)];if(!what.length)what="修改型号库（顺序或内容）"}
             else if(/^checks_/.test(k)&&b&&v&&b.res!==undefined){const r0=b.res||{},r1=v.res||{},ks=[...new Set([...Object.keys(r0),...Object.keys(r1)])].filter(x=>r0[x]!==r1[x]);
               if(ks.length)what=ks.map(x=>kvName(k)+"：标记 "+showV(r0[x])+" → "+showV(r1[x]))}
             else if(k==="stdlib_review"&&b&&v){const ks=[...new Set([...Object.keys(b),...Object.keys(v)])].filter(x=>JSON.stringify(b[x])!==JSON.stringify(v[x]));
               if(ks.length)what=ks.slice(0,30).map(x=>"型号标准库："+x+" → "+(v[x]?(v[x].ok+(v[x].to?" 合并到 "+v[x].to:"")):"取消决定"))}
             await gate([].concat(what),[{kv:name,k,before:b===undefined?null:b}],null)}
           return fire(doc(k).set({v}))}};
}
// 操作记录 / 撤销 / 锁上 / 改授权码
const Boss={
  left:()=>Math.max(0,authUntil-Date.now()),
  justCancelled:()=>Date.now()-lastCancel<4000,
  lock(){authUntil=0;graceUntil=0},
  async hasPin(){return !!(await getPin())},
  async changePin(){await ready;const m=await getPin();const ok=await dialog({title:m?"修改授权码":"设置授权码",mode:m?"change":"setup"});if(ok)toast("授权码已保存。");return ok},
  async forgot(pw){await ready;const u=auth.currentUser;const cred=firebase.auth.EmailAuthProvider.credential(u.email,pw);await u.reauthenticateWithCredential(cred);
    const ok=await dialog({title:"重新设置授权码",mode:"setup",note:"账号密码已验证。"});if(ok)toast("新的授权码已保存。");return ok},
  confirm:items=>gate([].concat(items),null,null,true),
  begin(){scope++},end(){scope=Math.max(0,scope-1)},
  async log(n){await ready;const s=await logCol().orderBy("t","desc").limit(n||30).get();return s.docs.map(x=>x.data())},
  async undoLast(){await ready;const s=await logCol().orderBy("t","desc").limit(300).get();const all=s.docs.map(x=>x.data());
    const isU=x=>String((x.items||[])[0]||"").startsWith("撤销：");
    const L=all.find(x=>!x.undone&&!isU(x));if(!L)return "没有可以撤销的改动。";
    const grp=L.gid?all.filter(x=>x.gid===L.gid&&!x.undone):[L];
    const ops=[].concat(...grp.filter(x=>!x.intent).map(x=>x.undo||[]));
    if(grp.some(x=>!x.intent&&!x.undo)||!ops.length)return "最近一次改动（"+(L.items||[])[0]+"）是导入或大批量改动，不能撤销。可以重新导入，或者用备份恢复。";
    const shown=[].concat(...grp.filter(x=>!x.intent).map(x=>x.items||[]));
    await gate(["撤销："+shown.slice(0,5).join("；")+(shown.length>5?"……共 "+shown.length+" 项":"")],null,null);
    const b=fs.batch();
    ops.forEach(o=>{if(o.kv){const r=fs.doc("users/"+uid+"/"+o.kv+SFX+"/"+o.k);o.before==null?b.delete(r):b.set(r,{v:o.before})}
      else{const r=fs.doc("users/"+uid+"/"+o.c+SFX+"/"+o.id);o.before==null?b.delete(r):b.set(r,o.before)}});
    fire(b.commit());grp.forEach(x=>fire(logCol().doc(x.id).set({undone:true},{merge:true})));
    setTimeout(remoteFire,400);return "已撤销："+shown[0]+(shown.length>1?" 等 "+shown.length+" 项":"")}
};
window.Cloud={ready,store,kv,boss:Boss,status,signOut:()=>auth.signOut(),email:()=>auth.currentUser&&auth.currentUser.email,
  set onRemote(fn){onRemote=fn},onChange:fn=>remoteFns.add(fn)};
})();
