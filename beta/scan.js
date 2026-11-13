/* 拍照识别：把手写盘点单照片交给 Claude 识别，核对后存进当天记录。
   依赖 index.html 暴露的 window.WC（数据层和工具函数）和全局 Cloud。 */
(function(){
const W=()=>window.WC;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt0=n=>Number(n||0).toLocaleString("zh-CN",{maximumFractionDigits:0});
const norm=s=>String(s||"").toUpperCase().replace(/[\s\-－_]/g,"");
const clean=s=>String(s||"").toUpperCase().replace(/\s+/g,"").replace(/－/g,"-");
const ST=["已入库","包装中","刚生产"];
const MODES=[
  {v:"已入库",t:"已入库"},{v:"包装中",t:"包装中"},{v:"刚生产",t:"刚生产"},
  {v:"包装中|刚生产",t:"线上包装中 · 线下刚生产"},{v:"已入库|包装中",t:"线上已入库 · 线下包装中"},{v:"已入库|刚生产",t:"线上已入库 · 线下刚生产"}];
const MODELS=[{v:"claude-sonnet-5-5",t:"标准（Sonnet，便宜快）"},{v:"claude-opus-5-5",t:"更准（Opus，贵一些）"}];
const CONFIRMED="GC148（不是GL148）、GC149、GC150、GC151、GC26-01、GC22-65、GC22-66、GC25-28、GC25-66、GC19-40BA、5021CX-1、5020CX-1、8020CX、8020CX-2、8021CX、8002CX、8003CX-2、8006CX、5006CX-1、1001G5C（不是1001G5L）、1020C2、SJ-L30C、1015C、1015C2、1015C2B、7001C、7004C、7006C、8004BBX、HS801C、QG7801C、QG7802C";
const KV=()=>Cloud.kv("pandian_kv");
let key=null,model="claude-sonnet-5-5",photos=[],rows=[],busy=false,stopFlag=false;
try{const m=localStorage.getItem("wc_scan_model");if(MODELS.some(x=>x.v===m))model=m}catch(e){}

/* ---------- styles ---------- */
const css=`#scOv{position:fixed;inset:0;z-index:900;background:var(--bg);overflow:auto;-webkit-overflow-scrolling:touch}
#scOv .sc-wrap{max-width:1100px;margin:0 auto;padding:max(12px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) 120px max(14px,env(safe-area-inset-left));display:flex;flex-direction:column;gap:12px}
#scOv h2{margin:0;font-size:20px}
#scOv .sc-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#scOv .sc-top .grow{flex:1}
#scOv .sc-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}
#scOv .sc-sub{color:var(--muted);font-size:13px}
#scOv input[type=text],#scOv input[type=password],#scOv select{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:8px 10px;min-height:44px;font-size:16px}
#scOv .sc-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
#scOv .sc-ph{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg);display:flex;flex-direction:column}
#scOv .sc-ph img{width:100%;height:150px;object-fit:cover;display:block}
#scOv .sc-ph .b{padding:6px;display:flex;flex-direction:column;gap:6px;font-size:13px}
#scOv .sc-ph select{min-height:38px;font-size:14px;width:100%}
#scOv .sc-ph .st{font-weight:700}
#scOv .sc-ph .st.ok{color:#3b9a4c}#scOv .sc-ph .st.err{color:var(--danger)}
#scOv .sc-ph .x{border:0;background:transparent;color:var(--danger);font-size:13px;text-align:right}
#scOv .sc-bar{position:fixed;left:0;right:0;bottom:0;background:var(--panel);border-top:1px solid var(--line);padding:10px max(14px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left));display:flex;gap:8px;align-items:center;flex-wrap:wrap;z-index:2}
#scOv .sc-bar .info{flex:1;min-width:160px;font-size:14px}
#scOv .sc-msg{font-size:14px;min-height:20px}#scOv .sc-msg.err{color:var(--danger)}
#scOv .sc-tbl{overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
#scOv table{border-collapse:collapse;width:100%;font-size:14px}
#scOv th{position:sticky;top:0;background:var(--accent);color:var(--accent-ink);font-weight:600;padding:6px;white-space:nowrap;z-index:1}
#scOv td{border-bottom:1px solid var(--soft);padding:3px 4px;vertical-align:middle}
#scOv td input,#scOv td select{border:1px solid transparent;background:transparent;color:var(--ink);border-radius:6px;padding:4px 6px;min-height:36px;font-size:15px;width:100%;font-family:var(--f-data,inherit)}
#scOv td input:focus,#scOv td select:focus{border-color:var(--accent);background:var(--bg)}
#scOv td.c-L input{width:62px}#scOv td.c-w input{width:72px}#scOv td.c-q input{width:84px;text-align:right}#scOv td.c-m input{min-width:120px}
#scOv td.c-n input{min-width:200px}#scOv td.c-s select{min-width:86px}
#scOv tr.scflag td{background:var(--warn-bg)}
#scOv tr.pg td{background:var(--soft);font-weight:700;font-size:13px;padding:6px 8px}
#scOv tr.pg button{border:1px solid var(--line);background:var(--panel);border-radius:6px;padding:2px 10px;min-height:30px;font-size:13px;margin-left:8px}
#scOv td.del button{border:0;background:transparent;color:var(--danger);font-size:18px;min-height:36px;padding:0 8px}
#scOv .tag{font-size:12px;border-radius:999px;padding:1px 8px;background:var(--warn-bg);color:var(--warn-ink);font-weight:700}
#scImg{position:fixed;inset:0;z-index:950;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;overflow:auto}
#scImg img{max-width:100%;max-height:100%}`;
const st=document.createElement("style");st.textContent=css;document.head.appendChild(st);

/* ---------- overlay ---------- */
function open(){
  if($("scOv"))return;
  const ov=document.createElement("div");ov.id="scOv";ov.setAttribute("role","dialog");ov.setAttribute("aria-label","拍照识别");
  ov.innerHTML=`<div class="sc-wrap"><div class="sc-top"><h2>📷 拍照识别</h2><span class="sc-sub" id="scDay"></span><span class="grow"></span><button type="button" class="btn" id="scClose">关闭</button></div><div id="scBody"></div></div><div class="sc-bar" id="scBar"></div>`;
  document.body.appendChild(ov);document.body.style.overflow="hidden";
  $("scClose").onclick=close;
  $("scDay").textContent="盘点日期："+W().day()+"（存进这一天）";
  init();
}
function close(){if(busy&&!confirm("正在识别，确定关闭吗？"))return;stopFlag=true;const ov=$("scOv");if(ov)ov.remove();document.body.style.overflow="";photos.forEach(p=>p.url&&URL.revokeObjectURL(p.url));photos=[];rows=[];busy=false}
const draftKey=()=>"wc_scan_draft_"+W().day();
function saveDraft(){try{localStorage.setItem(draftKey(),JSON.stringify({rows,photos:photos.map(p=>({name:p.name,mode:p.mode,state:p.state}))}))}catch(e){}}
function clearDraft(){try{localStorage.removeItem(draftKey())}catch(e){}}

async function init(){
  $("scBody").innerHTML=`<div class="sc-card"><div class="sc-sub">正在读取设置…</div></div>`;$("scBar").innerHTML="";
  try{key=await KV().get("anthropic_key")}catch(e){key=null}
  let draft=null;try{draft=JSON.parse(localStorage.getItem(draftKey())||"null")}catch(e){}
  if(draft&&draft.rows&&draft.rows.length){
    $("scBody").innerHTML=`<div class="sc-card"><b>上次这一天有一批识别结果还没存进去（${draft.rows.length} 行）。</b><div class="sc-top"><button type="button" class="btn primary" id="scResume">继续核对</button><button type="button" class="btn" id="scDrop">丢掉，重新开始</button></div></div>`;
    $("scResume").onclick=()=>{rows=draft.rows;photos=(draft.photos||[]).map(p=>Object.assign({},p,{url:null}));showReview()};
    $("scDrop").onclick=()=>{clearDraft();showSetup()};return}
  showSetup();
}

/* ---------- step 1: key + photos ---------- */
function showSetup(){
  const body=$("scBody");
  body.innerHTML=`
  <div class="sc-card" id="scKeyCard">${key?`<div>识别服务：<b>已设置</b> <span class="sc-sub">（密钥存在你自己的云端账号里）</span> <button type="button" class="btn" id="scKeyEdit" style="min-height:34px;padding:2px 10px">更换密钥</button></div>`:keyForm()}
    <label class="sc-sub" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">识别模式 <select id="scModel">${MODELS.map(m=>`<option value="${m.v}"${m.v===model?" selected":""}>${m.t}</option>`).join("")}</select></label></div>
  <div class="sc-card">
    <div><b>1. 选照片</b> <span class="sc-sub">按单子的顺序选（第1张、第2张…）。可以拍照，也可以从相册选，一次选多张。</span></div>
    <div class="sc-top"><button type="button" class="btn primary" id="scPick">📷 拍照 / 选照片</button><input type="file" id="scFile" accept="image/*" multiple hidden>
      ${photos.length?`<button type="button" class="btn" id="scClear">清空照片</button>`:""}</div>
    <div class="sc-sub">2. 给每张选状态。一张单上有横线分开、上下状态不同的，选“线上…·线下…”。</div>
    <div class="sc-photos" id="scPhotos"></div>
  </div>`;
  if(!key)bindKeyForm();else $("scKeyEdit").onclick=()=>{$("scKeyCard").insertAdjacentHTML("afterbegin",keyForm());bindKeyForm()};
  $("scModel").onchange=e=>{model=e.target.value;try{localStorage.setItem("wc_scan_model",model)}catch(err){}};
  $("scPick").onclick=()=>$("scFile").click();
  $("scFile").onchange=e=>{const fs=[...e.target.files];e.target.value="";
    fs.forEach(f=>{const last=photos.length?photos[photos.length-1].mode:"已入库";photos.push({file:f,name:f.name,url:URL.createObjectURL(f),mode:last,state:"待识别"})});showSetup()};
  if($("scClear"))$("scClear").onclick=()=>{photos.forEach(p=>p.url&&URL.revokeObjectURL(p.url));photos=[];showSetup()};
  renderPhotos();setupBar();
}
function keyForm(){return `<div id="scKeyForm" style="display:flex;flex-direction:column;gap:8px">
  <div><b>第一次使用：粘贴 Anthropic API 密钥</b><div class="sc-sub">在 console.anthropic.com → API Keys 新建一个，复制后粘贴到这里。只需要填一次，电脑、iPad、手机共用。建议在 console 里设一个每月花费上限。</div></div>
  <div class="sc-top"><input type="password" id="scKeyIn" placeholder="sk-ant-…" autocomplete="off" style="flex:1;min-width:220px"><button type="button" class="btn primary" id="scKeySave">保存</button></div><div class="sc-msg" id="scKeyMsg"></div></div>`}
function bindKeyForm(){
  $("scKeySave").onclick=async()=>{const v=$("scKeyIn").value.trim();
    if(!/^sk-ant-/.test(v)){$("scKeyMsg").textContent="密钥应该以 sk-ant- 开头，请检查一下。";$("scKeyMsg").className="sc-msg err";return}
    $("scKeySave").disabled=true;$("scKeyMsg").className="sc-msg";$("scKeyMsg").textContent="正在检查密钥…";
    const ok=await testKey(v);
    if(ok!==true){$("scKeyMsg").textContent=ok;$("scKeyMsg").className="sc-msg err";$("scKeySave").disabled=false;return}
    try{await KV().set("anthropic_key",v)}catch(e){}
    key=v;showSetup();}
}
async function testKey(k){
  try{const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:hdr(k),body:JSON.stringify({model,max_tokens:5,messages:[{role:"user",content:"hi"}]})});
    if(r.ok)return true;if(r.status===401)return "密钥不对，请重新复制粘贴。";if(r.status===400){const j=await r.json().catch(()=>({}));if(/credit|balance/i.test(JSON.stringify(j)))return "密钥是对的，但账户余额不足，请先在 console.anthropic.com 充值。"}
    if(r.status===429||r.status>=500)return true;
    return "检查失败（"+r.status+"），请稍后再试。";
  }catch(e){return "连不上识别服务，请检查网络。"}
}
const hdr=k=>({"content-type":"application/json","x-api-key":k,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"});
function renderPhotos(){
  const box=$("scPhotos");if(!box)return;
  box.innerHTML=photos.map((p,i)=>`<div class="sc-ph"><img src="${p.url||""}" alt="第${i+1}张" data-big="${i}"><div class="b"><b>第${i+1}张</b>
    <select data-mode="${i}">${MODES.map(m=>`<option value="${m.v}"${m.v===p.mode?" selected":""}>${m.t}</option>`).join("")}</select>
    <span class="st ${p.state==="完成"?"ok":/失败/.test(p.state)?"err":""}">${esc(p.state)}</span>
    ${busy?"":`<button type="button" class="x" data-rm="${i}">移除</button>`}</div></div>`).join("")||`<div class="sc-sub">还没有照片。</div>`;
  box.onchange=e=>{const s=e.target.closest("[data-mode]");if(s)photos[+s.dataset.mode].mode=s.value};
  box.onclick=e=>{const r=e.target.closest("[data-rm]");if(r){const p=photos.splice(+r.dataset.rm,1)[0];p.url&&URL.revokeObjectURL(p.url);showSetup();return}
    const b=e.target.closest("[data-big]");if(b)bigImg(photos[+b.dataset.big])};
}
function setupBar(){
  $("scBar").innerHTML=`<span class="info" id="scInfo">${photos.length?`${photos.length} 张照片`:"先选照片"}</span><span class="sc-msg" id="scMsg"></span>
    <button type="button" class="btn primary" id="scGo"${photos.length&&key&&!busy?"":" disabled"}>开始识别</button>`;
  $("scGo").onclick=run;
}
function bigImg(p){if(!p||!p.url)return;const d=document.createElement("div");d.id="scImg";d.innerHTML=`<img src="${p.url}" alt="">`;d.onclick=()=>d.remove();document.body.appendChild(d)}

/* ---------- step 2: recognise ---------- */
function resize(file,max=1568){
  return new Promise((ok,bad)=>{const img=new Image();const u=URL.createObjectURL(file);
    img.onload=()=>{let w=img.naturalWidth,h=img.naturalHeight;const s=Math.min(1,max/Math.max(w,h));w=Math.round(w*s);h=Math.round(h*s);
      const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(img,0,0,w,h);URL.revokeObjectURL(u);
      ok(c.toDataURL("image/jpeg",0.88).split(",")[1])};
    img.onerror=()=>{URL.revokeObjectURL(u);bad(new Error("img"))};img.src=u});
}
function sysPrompt(){
  const known=[...new Set((W().cat()||[]).map(c=>c.m))].slice(0,800).join("、");
  return `你在帮一家铝型材厂把手写的车间盘点单照片录成数据。
每一行的写法是：长度(米) 型号 支重 支数，例如“3米 QG7801A 0.172 8400”。
- 长度：如“3米”“2.45米”“5.99米”，只取数字。
- 型号：照抄，统一大写，保留横杠。写单人的“C”很容易被看成“L”，型号里的C默认按C读，“CX”不要读成“LX”。
- 支重：6米一支的理论支重，一般在0.1到2.3之间。
- 支数：整数。
读的顺序：每张单分左右两栏，先从上到下读完左栏，再从上到下读右栏，严格按纸上的顺序，不要排序、不要合并。
特殊情况：
- 划改：数字或型号被划掉、旁边写了新的，按改后的录入，备注写“原数已划改为XXXX”或“支重原写已划改为X”。
- 整行划掉：不录入，在相邻一行的备注写“下一行/上一行整行划掉，未录入”。
- 同一行两组数（如两个支重各配一个支数，或“1150+2500”、“2755/1355”这种一个支重配两个支数）：拆成多行，备注写“原表同一行两组…”。
- 支数前后的“棒”“y”“挑”等标记：不计入数量，写进备注，如“数量后写“棒””。
- 页面上的文字（“已完成”“正包中”“未进炉”“X框刚进炉”等）：写进 page_notes，也写进最接近的那一行的备注。
- 单子上如果有一条横线把页面分成上下两部分，has_divider=true，线下的行 below_line=true。
- 拿不准（字迹不清、可能是别的字/数）：按最可能的读法录入，check=true，备注写清两种可能，如“支重看着像0.15，也可能是0.115”。宁可多标，不要漏标。
用户确认过的型号写法：${CONFIRMED}。
用户以前出现过的型号（读到相似的写法时优先对照这些）：${known}
把这张照片上的所有行都录进 record_sheet 工具，一行都不要漏。`;
}
const TOOL={name:"record_sheet",description:"记录一张盘点单照片上读到的所有行",input_schema:{type:"object",properties:{
  rows:{type:"array",items:{type:"object",properties:{L:{type:"number",description:"长度(米)"},m:{type:"string",description:"型号"},w:{type:"number",description:"6米理论支重"},q:{type:"integer",description:"支数"},
    n:{type:"string",description:"备注"},check:{type:"boolean",description:"拿不准、需要人工核对"},below_line:{type:"boolean",description:"在页面分隔横线的下面"}},required:["L","m","w","q","check"]}},
  has_divider:{type:"boolean"},page_notes:{type:"string"}},required:["rows"]}};
async function callApi(b64){
  const body={model,max_tokens:8000,system:sysPrompt(),tools:[TOOL],tool_choice:{type:"tool",name:"record_sheet"},
    messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:"image/jpeg",data:b64}},{type:"text",text:"请录入这张盘点单。"}]}]};
  for(let attempt=0;attempt<3;attempt++){
    let r;try{r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:hdr(key),body:JSON.stringify(body)})}catch(e){if(attempt<2){await new Promise(s=>setTimeout(s,3000));continue}throw new Error("网络连不上")}
    if(r.ok){const j=await r.json();const t=(j.content||[]).find(c=>c.type==="tool_use");if(!t)throw new Error("没有读到结果");return t.input}
    if(r.status===401)throw new Error("密钥不对，请点“更换密钥”");
    if((r.status===429||r.status>=500)&&attempt<2){await new Promise(s=>setTimeout(s,(attempt+1)*8000));continue}
    const j=await r.json().catch(()=>({}));const m=JSON.stringify(j);
    if(/credit|balance/i.test(m))throw new Error("账户余额不足，请到 console.anthropic.com 充值");
    throw new Error("识别失败（"+r.status+"）");
  }
}
async function run(){
  if(busy)return;busy=true;stopFlag=false;rows=[];
  const info=()=>{const n=photos.filter(p=>p.state==="完成").length;$("scInfo").textContent=`正在识别… ${n}/${photos.length} 张（每张大约十几秒到半分钟，请别关掉）`};
  $("scGo").disabled=true;photos.forEach(p=>p.state="待识别");renderPhotos();info();
  const out=new Array(photos.length);
  let next=0;
  async function worker(){while(next<photos.length&&!stopFlag){const i=next++;const p=photos[i];p.state="识别中…";renderPhotos();
      try{const b=await resize(p.file);out[i]=await callApi(b);p.state="完成"}catch(e){p.state="失败："+e.message;out[i]=null}
      renderPhotos();info()}}
  await Promise.all([worker(),worker()]);
  busy=false;if(stopFlag)return;
  const failed=photos.map((p,i)=>out[i]?null:i+1).filter(Boolean);
  photos.forEach((p,i)=>{const res=out[i];if(!res)return;const modes=p.mode.split("|");
    (res.rows||[]).forEach(r=>{const s=modes.length>1&&r.below_line?modes[1]:modes[0];
      const n=String(r.n||"").trim();
      rows.push({pg:i+1,s,L:+r.L||0,m:clean(r.m),w:+r.w||0,q:parseInt(r.q,10)||0,n,check:!!r.check})})});
  if(failed.length&&!rows.length){$("scMsg").textContent="识别失败："+photos.find(p=>/失败/.test(p.state)).state.replace("失败：","");$("scMsg").className="sc-msg err";setupBar();return}
  await annotate();saveDraft();showReview(failed);
}
/* compare with previous day + duplicates */
async function annotate(){
  rows.forEach(r=>{r.n=String(r.n||"").replace(/；?(★新型号[^；]*|★新规格[^；]*|▲比昨天多[^；]*|▼比昨天少[^；]*)/g,"").replace(/^；/,"")});
  let prev=[],pd=null;try{pd=await W().S.lastDayBefore(W().day());if(pd)prev=(await W().S.dayOnce(pd)).filter(r=>r.q>0&&r.s!=="已出货")}catch(e){}
  const k=r=>norm(r.m)+"|"+(+r.L)+"|"+(+r.w);
  const yk=new Map(),ym=new Map();prev.forEach(r=>{yk.set(k(r),(yk.get(k(r))||0)+r.q);const a=ym.get(norm(r.m))||new Set();a.add((+r.L)+"米/"+(+r.w));ym.set(norm(r.m),a)});
  const tk=new Map();rows.forEach(r=>tk.set(k(r),(tk.get(k(r))||0)+r.q));
  const seen=new Set(),four=new Map();
  rows.forEach(r=>{const kk=k(r);
    const f=kk+"|"+r.q;if(four.has(f)&&four.get(f)!==r.pg){r.check=true;r.n=[r.n,`第${four.get(f)}张也有同样一行，请确认是否重复`].filter(Boolean).join("；")}else four.set(f,r.pg);
    if(seen.has(kk)||!pd)return;seen.add(kk);
    let c="";const y=yk.get(kk),t=tk.get(kk);
    if(y==null)c=ym.has(norm(r.m))?`★新规格（${pd.slice(5)}同型号只有 ${[...ym.get(norm(r.m))].join("、")}）`:"★新型号";
    else if(t>y)c=`▲比昨天多 ${fmt0(t-y)}（昨天 ${fmt0(y)}）`;else if(t<y)c=`▼比昨天少 ${fmt0(y-t)}（昨天 ${fmt0(y)}）`;
    if(c)r.n=[r.n,c].filter(Boolean).join("；")});
  rows._pd=pd;
}

/* ---------- step 3: review ---------- */
function showReview(failed){
  failed=failed||[];
  const body=$("scBody");
  const pages=[...new Set(rows.map(r=>r.pg))].sort((a,b)=>a-b);
  let html=`<div class="sc-card"><div><b>请对照照片核对。</b> <span class="sc-sub">黄底的行是拿不准的，备注里写了原因。每一格都可以直接改；点“看照片”放大原图。核对完点最下面的“确认存入”。</span></div>
    ${failed.length?`<div class="sc-msg err">第 ${failed.join("、")} 张没有识别成功，可以关掉后单独再拍一次。</div>`:""}</div>
    <div class="sc-tbl"><table><thead><tr><th>#</th><th>状态</th><th>长度(米)</th><th>型号</th><th>支重</th><th>支数</th><th>备注</th><th></th></tr></thead><tbody>`;
  let i=0;
  pages.forEach(pg=>{const ph=photos[pg-1];html+=`<tr class="pg"><td colspan="8">第${pg}张 · ${rows.filter(r=>r.pg===pg).length} 行${ph&&ph.url?`<button type="button" data-big="${pg-1}">看照片</button>`:""}<button type="button" data-add="${pg}">＋ 加一行</button></td></tr>`;
    rows.forEach((r,ri)=>{if(r.pg!==pg)return;i++;
      html+=`<tr class="${r.check?"scflag":""}" data-ri="${ri}"><td>${i}</td>
        <td class="c-s"><select data-f="s">${ST.map(s=>`<option${s===r.s?" selected":""}>${s}</option>`).join("")}</select></td>
        <td class="c-L"><input data-f="L" inputmode="decimal" value="${r.L}"></td>
        <td class="c-m"><input data-f="m" value="${esc(r.m)}" autocapitalize="characters" spellcheck="false"></td>
        <td class="c-w"><input data-f="w" inputmode="decimal" value="${r.w}"></td>
        <td class="c-q"><input data-f="q" inputmode="numeric" value="${r.q}"></td>
        <td class="c-n"><input data-f="n" value="${esc(r.n)}"></td>
        <td class="del"><button type="button" data-del="${ri}" aria-label="删除这一行">✕</button></td></tr>`})});
  html+=`</tbody></table></div>`;
  body.innerHTML=html;
  const tb=body.querySelector("tbody");
  tb.addEventListener("input",e=>{const inp=e.target.closest("[data-f]");if(!inp)return;const r=rows[+inp.closest("tr").dataset.ri],f=inp.dataset.f;
    r[f]=f==="m"?clean(inp.value):f==="q"?(parseInt(inp.value.replace(/[^\d]/g,""),10)||0):f==="L"||f==="w"?(parseFloat(inp.value)||0):inp.value;saveDraft();reviewBar()});
  tb.addEventListener("change",e=>{const inp=e.target.closest("select[data-f]");if(inp){rows[+inp.closest("tr").dataset.ri].s=inp.value;saveDraft()}});
  tb.addEventListener("click",e=>{
    const d=e.target.closest("[data-del]");if(d){rows.splice(+d.dataset.del,1);saveDraft();showReview(failed);return}
    const a=e.target.closest("[data-add]");if(a){const pg=+a.dataset.add;let at=-1;rows.forEach((r,ri)=>{if(r.pg===pg)at=ri});const base=rows[at]||{s:"已入库"};
      rows.splice(at+1,0,{pg,s:base.s,L:3,m:"",w:0,q:0,n:"手动补的行",check:true});saveDraft();showReview(failed);return}
    const b=e.target.closest("[data-big]");if(b)bigImg(photos[+b.dataset.big])});
  reviewBar();
}
function reviewBar(){
  const n=rows.length,q=rows.reduce((s,r)=>s+(r.q||0),0),c=rows.filter(r=>r.check).length;
  const bad=rows.filter(r=>!r.m||!(r.L>0)||!(r.w>0)||!(r.q>0)).length;
  $("scBar").innerHTML=`<span class="info">${n} 行 · ${fmt0(q)} 支${c?` · <span class="tag">${c} 处需核对</span>`:""}${bad?` · <b style="color:var(--danger)">${bad} 行有空格</b>`:""}</span>
    <span class="sc-msg" id="scMsg"></span>
    <button type="button" class="btn" id="scRe">重新选照片</button><button type="button" class="btn primary" id="scSave"${n&&!bad?"":" disabled"}>确认存入 ${esc(W().day().slice(5))}</button>`;
  $("scRe").onclick=()=>{if(!confirm("回到选照片？这次的识别结果会丢掉。"))return;clearDraft();rows=[];photos.forEach(p=>p.state="待识别");showSetup()};
  $("scSave").onclick=save;
}
let saveArm=false;
async function save(){
  const day=W().day(),existing=W().recs();
  if(existing.length&&!saveArm){saveArm=true;$("scMsg").className="sc-msg err";$("scMsg").textContent=`${day.slice(5)} 已经有 ${existing.length} 行记录。再点一次“确认存入”会把这 ${rows.length} 行加在后面。`;$("scSave").textContent="再点一次，加在后面";setTimeout(()=>saveArm=false,8000);return}
  saveArm=false;$("scSave").disabled=true;$("scMsg").className="sc-msg";$("scMsg").textContent="正在保存…";
  const t0=Math.max(Date.now(),...existing.map(r=>(r.t||0)+1));
  const recs=rows.map((r,i)=>({d:day,m:r.m,L:r.L,w:r.w,q:r.q,s:r.s,n:(r.check&&!/^【需核对】/.test(r.n)?"【需核对】":"")+(r.n||""),p:`第${r.pg}张`,t:t0+i}));
  try{
    await W().S.addMany(recs);
    const cat=W().cat().slice(),have=new Set(cat.map(c=>c.m+"|"+c.L+"|"+c.w));let add=0;
    recs.forEach(r=>{const k=r.m+"|"+r.L+"|"+r.w;if(!have.has(k)){have.add(k);cat.push({m:r.m,L:r.L,w:r.w});add++}});
    if(add){await W().S.setCat(cat);W().setCat(cat)}
    clearDraft();const n=recs.length,q=recs.reduce((s,r)=>s+r.q,0);close();await W().reload();
    W().say(`已存入 ${n} 行，共 ${fmt0(q)} 支。黄底红字的备注请对照原件再看一遍；要 Excel 点“导出 Excel”。`);
  }catch(e){$("scMsg").className="sc-msg err";$("scMsg").textContent="保存失败，请检查网络后再点一次。";$("scSave").disabled=false}
}

/* ---------- entry ---------- */
function bind(){const b=$("scanTop");if(b)b.onclick=open}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind);else bind();
})();
