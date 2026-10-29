/* 云同步（Firebase）：登录 + 数据存取。两个 App 共用。
   数据路径：users/{登录账号}/{集合名}/{记录id}，访问规则只允许本人读写。 */
(function(){
const cfg={apiKey:"AIzaSyCOcKF3hQivqpY3ZEZe8eS3G40gKyqK5jI",authDomain:"chejian-pandian.firebaseapp.com",projectId:"chejian-pandian",
  storageBucket:"chejian-pandian.firebasestorage.app",messagingSenderId:"919626262912",appId:"1:919626262912:web:8021d6f041e8eb6a1f3965"};
firebase.initializeApp(cfg);
const auth=firebase.auth(),fs=firebase.firestore();
const persist=fs.enablePersistence({synchronizeTabs:true}).catch(()=>{});
let uid=null,onRemote=null,pending=0;
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
      if(L.first){L.first=false;res()}else if(!snap.metadata.hasPendingWrites&&onRemote)onRemote();
    },err=>{console.error(err);if(L.first){L.first=false;res()}});
  });
  L.list=()=>[...L.map.values()];
  listeners.add(L);return L;
}
function store(name){
  const col=()=>fs.collection("users/"+uid+"/"+name);
  let dayL=null,dayKey=null,allL=null;
  const maps=()=>[dayL,allL].filter(Boolean);
  const local=(v)=>{if(dayL&&v.d===dayKey)dayL.map.set(v.id,v);if(allL)allL.map.set(v.id,v)};
  const unlocal=id=>maps().forEach(L=>L.map.delete(id));
  const find=id=>{for(const L of maps())if(L.map.has(id))return L.map.get(id);return null};
  async function batched(ops){for(let i=0;i<ops.length;i+=400){const b=fs.batch();ops.slice(i,i+400).forEach(f=>f(b));fire(b.commit())}}
  return{
    async byDay(d){await ready;if(dayKey!==d){if(dayL)dayL.unsub();listeners.delete(dayL);dayKey=d;dayL=live(col().where("d","==",d))}await dayL.ready;return dayL.list()},
    async all(){await ready;if(!allL)allL=live(col());await allL.ready;return allL.list()},
    async allOnce(){await ready;const s=await col().get();return s.docs.map(x=>x.data())},
    async query(field,op,val){await ready;const s=await col().where(field,op,val).get();return s.docs.map(x=>x.data())},
    async lastDayBefore(d){await ready;const s=await col().where("d","<",d).orderBy("d","desc").limit(1).get();return s.empty?null:s.docs[0].data().d},
    async get(id){await ready;const v=find(id);if(v)return v;const s=await col().doc(id).get();return s.exists?s.data():undefined},
    async put(v){await ready;local(v);return fire(col().doc(v.id).set(v))},
    async update(id,patch){await ready;const o=find(id);if(o)local(Object.assign({},o,patch));return fire(col().doc(id).set(patch,{merge:true}))},
    async del(id){await ready;unlocal(id);return fire(col().doc(id).delete())},
    async putMany(vs){await ready;vs.forEach(local);return batched(vs.map(v=>b=>b.set(col().doc(v.id),v)))},
    async delMany(ids){await ready;ids.forEach(unlocal);return batched(ids.map(id=>b=>b.delete(col().doc(id))))},
  };
}
function kv(name){
  const doc=k=>fs.doc("users/"+uid+"/"+name+"/"+k);
  return{async get(k){await ready;const s=await doc(k).get();return s.exists?s.data().v:undefined},
         async set(k,v){await ready;return fire(doc(k).set({v}))}};
}
window.Cloud={ready,store,kv,status,signOut:()=>auth.signOut(),email:()=>auth.currentUser&&auth.currentUser.email,
  set onRemote(fn){onRemote=fn}};
})();
