/* 铝型材管理：今日清单 / 查错核对 / 型号查询 / 更多（底部切换）。数据和“录入”共用同一个云端账号。 */
(function () {
  const ST = ["已入库", "包装中", "刚生产"], CLS = { "已入库": "in", "包装中": "pk", "刚生产": "nw" };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").toUpperCase().replace(/[\s\-－_]/g, "");
  const n0 = n => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  const n1 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const kg = r => r.w / 6 * r.L * r.q;
  const pg = r => { const x = /第(\d+)张/.exec(r.p || ""); return x ? +x[1] : 0 };
  const md = d => d ? +d.slice(5, 7) + "/" + +d.slice(8, 10) : "";
  const s0 = r => ST.includes(r.s0) ? r.s0 : r.s;
  const rankOf = (r, i) => (ST.indexOf(r.s) + 1) * 100000 + (r.s !== s0(r) ? 0 : 50000) + i;
  const flagged = r => (r.n || "").startsWith("【需核对】");
  const R = Cloud.store("pandian_records"), KV = Cloud.kv("pandian_kv");
  const LS = { get: (k, d) => { try { return localStorage.getItem(k) || d } catch (e) { return d } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch (e) { } } };

  let tab = LS.get("qd_tab", "list"), sub = LS.get("qd_sub", "photo"), cmpF = "all", ckF = "all";
  let day = null, rows = [], ship = 0, yday = null, yrows = [], checks = null, openS = null, editId = null, qtext = "", hist = null, histDays = 14, busy = false, armImport = null;

  /* ---------- 外框 ---------- */
  const css = `
:root{--chg:#ffe699;--chg-ink:#5a4300;--lv-h:#ffc7ce;--lv-h-ink:#9c0006;--lv-m:#fff2cc;--lv-m-ink:#7a5800;--lv-l:#ededed;--lv-l-ink:#555}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--chg:#4a3d12;--chg-ink:#ffe699;--lv-h:#4a1c20;--lv-h-ink:#ffb3b8;--lv-m:#3d3313;--lv-m-ink:#f3d98a;--lv-l:#2b2b2b;--lv-l-ink:#bbb}}
body{padding-bottom:calc(84px + env(safe-area-inset-bottom,0px))}
body:not([data-tab="entry"]) .wrap>*:not(header.top):not(#qd):not(.banner){display:none!important}
body:not([data-tab="entry"]) #scanTop,body:not([data-tab="entry"]) #quickTop,body:not([data-tab="entry"]) #exportBtn{display:none}
body[data-tab="entry"] #qd{display:none}
body:not([data-tab="entry"]) header.top .sub:not(label){display:none}
.qd-msg:empty{display:none}
@media (max-width:700px){body:not([data-tab="entry"]) header.top h1{font-size:19px}body:not([data-tab="entry"]) header.top{gap:6px 10px}}
.qd-bar{position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--panel);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom,0px)}
.qd-bar .in{max-width:640px;margin:0 auto;display:grid;grid-template-columns:repeat(5,1fr)}
.qd-bar button{border:0;background:none;min-height:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:12px;color:var(--muted);font-weight:600;position:relative}
.qd-bar button svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.qd-bar button[aria-current="page"]{color:var(--accent)}
.qd-bar .dot{position:absolute;top:6px;left:calc(50% + 8px);min-width:18px;height:18px;border-radius:9px;background:var(--danger);color:#fff;font-size:11px;line-height:18px;padding:0 5px;font-family:var(--f-data)}
#qd{display:flex;flex-direction:column;gap:12px}
.qd-tool{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.qd-tool .sub{color:var(--muted);font-size:13px}
.qd-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.qd-card{border-radius:var(--r);padding:8px 12px;border:1px solid var(--line);background:var(--panel);min-width:0}
.qd-card.in{background:var(--st-in);color:var(--st-in-ink);border-color:transparent}.qd-card.pk{background:var(--st-pk);color:var(--st-pk-ink);border-color:transparent}.qd-card.nw{background:var(--st-new);color:var(--st-new-ink);border-color:transparent}
.qd-card .l{font-size:13px;font-weight:700;display:flex;justify-content:space-between;gap:4px}
.qd-card .b{font-family:var(--f-data);font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qd-card .s{font-family:var(--f-data);font-size:12px;opacity:.85;white-space:nowrap}
@media (max-width:700px){.qd-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.qd-card .b{font-size:18px}}
.qd-seg{display:flex;gap:4px;background:var(--soft);padding:4px;border-radius:10px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.qd-seg button{flex:1 0 auto;border:0;background:none;border-radius:7px;min-height:38px;padding:0 12px;font-weight:600;font-size:14px;color:var(--muted);white-space:nowrap}
.qd-seg button[aria-pressed="true"]{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.qd-tw{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);overflow:auto;max-height:calc(100vh - 300px);min-height:200px;-webkit-overflow-scrolling:touch}
.qd-t{border-collapse:separate;border-spacing:0;width:100%;font-family:var(--f-data);font-size:14px;font-variant-numeric:tabular-nums}
.qd-t th{position:sticky;top:0;z-index:3;background:#305496;color:#fff;font-family:var(--f-body);font-size:13px;font-weight:700;padding:8px;white-space:nowrap}
.qd-t td{padding:0 8px;height:42px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right;background:var(--panel)}
.qd-t .c1{position:sticky;left:0;z-index:2;width:44px;min-width:44px;text-align:center;color:var(--muted)}
.qd-t .c2{position:sticky;left:44px;z-index:2;text-align:left;font-weight:700;box-shadow:2px 0 0 var(--line)}
.qd-t th.c1,.qd-t th.c2{z-index:4;color:#fff}
.qd-t td.tl{text-align:left}.qd-t td.ct{text-align:center}
.qd-t td.nt{text-align:left;font-family:var(--f-body);font-size:13px;white-space:normal;min-width:220px;max-width:420px;line-height:1.35;padding-block:4px}
.qd-t td.nt.flag{color:#c00000;font-weight:700}
.qd-t tr.in td{background:var(--st-in)}.qd-t tr.pk td{background:var(--st-pk)}.qd-t tr.nw td{background:var(--st-new)}
.qd-t tr.chg td{background:var(--chg)}
.qd-t tr.grp td{background:var(--soft);font-family:var(--f-body);font-weight:700;text-align:left;height:36px;color:var(--ink)}
.qd-t tr.grp td.c1{background:var(--soft)}
.qd-t tr.kn td{background:var(--st-in)}.qd-t tr.kc td{background:var(--lv-m)}.qd-t tr.kg td{background:var(--lv-l)}.qd-t td.up{color:#2f7d3b;font-weight:700}.qd-t td.dn{color:#c00000;font-weight:700}
.qd-t td.L{color:var(--len);font-weight:700}.qd-t td.W{color:var(--wt);font-weight:700}.qd-t td.Q{font-weight:700}
.qd-st{border:1px solid currentColor;background:transparent;border-radius:999px;padding:2px 10px;min-height:32px;font-size:13px;font-weight:700;white-space:nowrap}
.qd-st .ch{display:block;font-size:11px;color:#c00000;font-weight:700;line-height:1.1}
.qd-opts{display:inline-flex;gap:4px;flex-wrap:nowrap}
.qd-opts button{border:1px solid var(--line);border-radius:6px;padding:2px 8px;min-height:36px;font-size:13px;font-weight:700;background:var(--panel)}
.qd-opts button.in{background:var(--st-in);color:var(--st-in-ink)}.qd-opts button.pk{background:var(--st-pk);color:var(--st-pk-ink)}.qd-opts button.nw{background:var(--st-new);color:var(--st-new-ink)}
.qd-empty{background:var(--panel);border:1px dashed var(--line);border-radius:var(--r);padding:28px 18px;text-align:center;color:var(--muted);display:flex;flex-direction:column;gap:12px;align-items:center}
.qd-empty b{color:var(--ink);font-size:17px}
.qd-msg{font-size:14px;min-height:20px}.qd-msg.err{color:var(--danger)}.qd-msg.ok{color:#2f7d3b}
.qd-confirm{background:var(--warn-bg);color:var(--warn-ink);border-radius:var(--r);padding:12px 14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.qd-confirm .t{flex:1 1 260px}
.qd-chips{display:flex;gap:6px;flex-wrap:wrap}
.qd-chips button{border:1px solid var(--line);background:var(--panel);border-radius:999px;min-height:36px;padding:0 12px;font-size:14px;font-weight:600}
.qd-chips button[aria-pressed="true"]{background:var(--ink);color:var(--panel);border-color:var(--ink)}
.qd-prog{display:flex;align-items:center;gap:10px;font-weight:700}
.qd-prog .bar{flex:1;height:10px;border-radius:5px;background:var(--soft);overflow:hidden}.qd-prog .bar i{display:block;height:100%;background:#3b9a4c}
.qd-ck{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
.qd-c{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:12px;display:flex;flex-direction:column;gap:8px;border-left-width:6px}
.qd-c.h{border-left-color:#e06666}.qd-c.m{border-left-color:#e0b000}.qd-c.l{border-left-color:#aaa}
.qd-c.done{opacity:.62}
.qd-c .top{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:13px;color:var(--muted)}
.qd-lv{border-radius:6px;padding:1px 8px;font-weight:800;font-size:13px}
.qd-lv.h{background:var(--lv-h);color:var(--lv-h-ink)}.qd-lv.m{background:var(--lv-m);color:var(--lv-m-ink)}.qd-lv.l{background:var(--lv-l);color:var(--lv-l-ink)}
.qd-c .spec{font-family:var(--f-data);font-size:18px;font-weight:700;display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}
.qd-c .spec .L{color:var(--len)}.qd-c .spec .W{color:var(--wt)}
.qd-c .why{font-size:14px}.qd-c .why b{display:block}
.qd-c .sug{font-size:14px;background:var(--soft);border-radius:8px;padding:6px 10px}
.qd-c .acts{display:flex;gap:6px;flex-wrap:wrap}
.qd-c .acts button{flex:1 1 auto;min-height:42px;border-radius:8px;border:1px solid var(--line);background:var(--panel);font-weight:700}
.qd-c .acts button[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.qd-ed{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.qd-ed label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
.qd-ed input{min-height:44px;border:2px solid var(--accent);border-radius:8px;padding:0 8px;font-family:var(--f-data);font-size:17px;background:var(--panel);color:var(--ink);width:100%}
.qd-q{display:flex;gap:8px}
.qd-q input{flex:1;min-height:52px;font-size:22px;font-weight:700;border:2px solid #bf8f00;background:#fff2cc;color:#c00000;border-radius:10px;padding:0 14px;font-family:var(--f-data);text-transform:uppercase}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .qd-q input{background:#3d3313;color:#ffb3b8}}
.qd-more{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.qd-more .it{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:14px;display:flex;flex-direction:column;gap:8px}
.qd-more .it h3{margin:0;font-size:16px}.qd-more .it p{margin:0;color:var(--muted);font-size:14px}
.qd-more .soon{font-size:12px;font-weight:700;color:var(--warn-ink);background:var(--warn-bg);border-radius:6px;padding:1px 8px;align-self:flex-start}
.qd-trend{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:12px}
.qd-trend svg{width:100%;height:auto;display:block}
`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const ICON = {
    entry: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13 7l4 4"/>',
    list: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    query: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
  };
  const TABS = [["entry", "录入"], ["list", "今日清单"], ["check", "查错核对"], ["query", "型号查询"], ["more", "更多"]];
  const bar = document.createElement("nav"); bar.className = "qd-bar"; bar.setAttribute("aria-label", "页面");
  bar.innerHTML = `<div class="in">${TABS.map(([k, t]) => `<button type="button" data-tab="${k}"><svg viewBox="0 0 24 24">${ICON[k]}</svg>${t}${k === "check" ? '<span class="dot" id="qdDot" hidden></span>' : ""}</button>`).join("")}</div>`;
  document.body.appendChild(bar);
  const box = document.createElement("section"); box.id = "qd"; box.setAttribute("aria-live", "polite");
  document.querySelector(".wrap header.top").insertAdjacentElement("afterend", box);
  const file = document.createElement("input"); file.type = "file"; file.accept = ".json,application/json"; file.hidden = true; document.body.appendChild(file);

  function setTab(t) {
    tab = t; LS.set("qd_tab", t); document.body.dataset.tab = t; openS = null; editId = null;
    for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-current", b.dataset.tab === t ? "page" : "false");
    if (t !== "entry") { render(); if (day) load() } else if (window.WC && WC.reload) WC.reload();
    window.scrollTo(0, 0);
  }
  bar.addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab) });

  /* ---------- 数据 ---------- */
  async function load() {
    day = $("day").value;
    try {
      const all = await R.byDay(day);
      ship = all.filter(r => r.s === "已出货").length;
      rows = all.filter(r => r.q > 0 && ST.includes(r.s)).sort((a, b) => (a.t || 0) - (b.t || 0));
      const yd = await R.lastDayBefore(day);
      if (yd !== yday) { yday = yd; yrows = yd ? (await R.query("d", "==", yd)).filter(r => r.q > 0 && ST.includes(r.s)) : [] }
      checks = (await KV.get("checks_" + day)) || null;
    } catch (e) { console.error(e); msg("读取云端数据失败，请检查网络后再试。", "err") }
    if (tab !== "entry") render(); paintDot();
  }
  let rt = null;
  Cloud.onChange(() => { clearTimeout(rt); rt = setTimeout(() => { if (editId || document.activeElement && document.activeElement.closest && document.activeElement.closest(".qd-ed")) return; load() }, 300) });
  $("day").addEventListener("change", () => { hist = null; load() });
  const ckList = () => (checks && Array.isArray(checks.list) ? checks.list : []).filter(c => rows.some(r => r.id === c.id));
  const ckRes = id => checks && checks.res && checks.res[id] || "";
  function paintDot() { const d = $("qdDot"); if (!d) return; const left = ckList().filter(c => c.lvl === "高" && !ckRes(c.id)).length; d.hidden = !left; d.textContent = left }

  let msgT = null;
  function msg(t, kind) { const m = $("qdMsg"); if (!m) return; m.textContent = t || ""; m.className = "qd-msg" + (kind ? " " + kind : ""); clearTimeout(msgT); if (kind === "ok") msgT = setTimeout(() => { if ($("qdMsg")) $("qdMsg").textContent = "" }, 6000) }

  /* ---------- 改状态 / 改数据（留修改记录） ---------- */
  async function setStatus(id, s) {
    const r = rows.find(x => x.id === id); if (!r || r.s === s) { openS = null; render(); return }
    const patch = { s }; if (!ST.includes(r.s0)) patch.s0 = r.s;
    patch.hist = (r.hist || []).concat([{ at: new Date().toISOString(), f: { s: r.s }, to: { s } }]).slice(-20);
    Object.assign(r, patch); openS = null; render(); paintDot();
    await R.update(id, patch);
  }
  async function saveEdit(id, vals) {
    const r = rows.find(x => x.id === id); if (!r) return;
    const patch = {}, from = {};
    for (const k of ["m", "L", "w", "q"]) if (vals[k] !== r[k]) { patch[k] = vals[k]; from[k] = r[k] }
    if (!Object.keys(patch).length) { editId = null; render(); return }
    patch.hist = (r.hist || []).concat([{ at: new Date().toISOString(), f: from, to: Object.assign({}, patch) }]).slice(-20);
    Object.assign(r, patch); editId = null;
    await setRes(id, "已改正", true); render();
    await R.update(id, patch);
    msg(`已改正：${Object.keys(from).map(k => ({ m: "型号", L: "长度", w: "支重", q: "支数" }[k]) + " " + from[k] + " → " + patch[k]).join("，")}`, "ok");
  }
  async function setRes(id, v, quiet) {
    if (!checks) return; checks.res = checks.res || {};
    if (checks.res[id] === v && !quiet) delete checks.res[id]; else checks.res[id] = v;
    paintDot(); if (!quiet) render();
    await KV.set("checks_" + day, checks);
  }

  /* ---------- 导入当天文件 ---------- */
  file.addEventListener("change", async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
    let data; try { data = JSON.parse(await f.text()) } catch (err) { msg("这个文件打不开，请确认是“车间盘点导入_MMDD.json”。", "err"); return }
    if (!data || data.app !== "chejian-pandian" || !Array.isArray(data.records)) { msg("这个文件不是车间盘点的导入文件。", "err"); return }
    const recs = data.records.filter(r => r && r.id && r.d && r.m);
    const days = [...new Set(recs.map(r => r.d))];
    if (days.length !== 1) { msg(`这个文件里有 ${days.length} 天的数据，像是“备份文件”。请到“更多 → 从备份恢复”。`, "err"); return }
    const d = data.day || days[0];
    const have = (await R.query("d", "==", d)).filter(r => r.s !== "已出货");
    armImport = { d, recs, checks: data.checks || [], catalog: data.catalog || [], have };
    if (d !== $("day").value) { $("day").value = d; $("day").dispatchEvent(new Event("change")) }
    if (!have.length) return doImport();
    render();
  });
  async function doImport() {
    const a = armImport; armImport = null; if (!a) return; busy = true; render();
    try {
      const keep = new Set(a.recs.map(r => r.id));
      const old = a.have.filter(r => !keep.has(r.id)).map(r => r.id);
      if (old.length) await R.delMany(old);
      await R.putMany(a.recs.map(r => Object.assign({}, r, { s0: ST.includes(r.s0) ? r.s0 : r.s })));
      const oldC = (await KV.get("checks_" + a.d)) || {}; const res = {};
      Object.entries(oldC.res || {}).forEach(([k, v]) => { if (keep.has(k)) res[k] = v });
      await KV.set("checks_" + a.d, { list: a.checks, res, at: new Date().toISOString(), n: a.recs.length });
      try { const W = window.WC; if (W && a.catalog.length) { const cat = W.cat(); const hv = new Set(cat.map(x => x.m + "|" + x.L + "|" + x.w)); let add = 0; a.catalog.forEach(x => { const k = x.m + "|" + x.L + "|" + x.w; if (x && x.m && !hv.has(k)) { cat.push(x); hv.add(k); add++ } }); if (add) await W.S.setCat(cat) } } catch (e) { }
      busy = false; await load(); if (window.WC && WC.reload) WC.reload();
      msg(`已导入 ${md(a.d)}：${a.recs.length} 行${a.have.length ? `（替换了原来的 ${a.have.length} 行）` : ""}，查错单 ${a.checks.length} 处。`, "ok");
    } catch (e) { busy = false; console.error(e); render(); msg("导入没有完成，请检查网络后再导入一次（重复导入不会多出数据）。", "err") }
  }

  /* ---------- 导出 Excel ---------- */
  function loadXL() { return new Promise((ok, bad) => { if (window.ExcelJS) return ok(window.ExcelJS); const s = document.createElement("script"); s.src = "./exceljs.min.js"; s.onload = () => ok(window.ExcelJS); s.onerror = () => bad(new Error("load")); document.head.appendChild(s) }) }
  async function share(blob, name) {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: name }); return "shared" } catch (e) { if (e && e.name === "AbortError") return "cancel" } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000); return "saved";
  }
  async function exportXlsx() {
    if (!rows.length) { msg("这一天没有数据，不能导出。", "err"); return }
    const b = $("qdExp"); if (b) { b.disabled = true; b.textContent = "正在生成…" }
    try {
      const XL = await loadXL();
      const buf = await QDX.build(XL, { day, rows, yday, yrows, checks: ckList().map(c => Object.assign({}, c, { res: ckRes(c.id) })) });
      const name = `铝型材清单_${day.slice(5, 7)}${day.slice(8, 10)}.xlsx`;
      const r = await share(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
      msg(r === "cancel" ? "已取消导出。" : `已生成 ${name}（${rows.length} 行）。`, r === "cancel" ? "" : "ok");
    } catch (e) { console.error(e); msg("导出失败，请再试一次。", "err") }
    if ($("qdExp")) { $("qdExp").disabled = false; $("qdExp").textContent = "导出 Excel" }
  }

  /* ---------- 公共小块 ---------- */
  function totalsHTML(list) {
    const by = s => list.filter(r => r.s === s), chg = list.filter(r => r.s !== s0(r)).length;
    const card = (cls, lab, l) => `<div class="qd-card ${cls}"><div class="l"><span>${lab}</span><span class="num">${l.length} 行</span></div><div class="b">${n0(l.reduce((a, r) => a + r.q, 0))} 支</div><div class="s">${n1(l.reduce((a, r) => a + kg(r), 0))} kg</div></div>`;
    return `<div class="qd-cards">${ST.map(s => card(CLS[s], s, by(s))).join("")}${card("", "合计" + (chg ? ` · <span style="color:#c00000">改过 ${chg}</span>` : ""), list)}</div>`;
  }
  function stCell(r) {
    if (openS === r.id) return `<span class="qd-opts">${ST.map(s => `<button type="button" class="${CLS[s]}" data-ss="${s}" data-id="${r.id}">${s}</button>`).join("")}${r.s !== s0(r) ? `<button type="button" data-ss="${s0(r)}" data-id="${r.id}">恢复</button>` : ""}<button type="button" data-ss="" data-id="${r.id}">✕</button></span>`;
    return `<button type="button" class="qd-st" data-open="${r.id}">${r.s}${r.s !== s0(r) ? `<span class="ch">◆ 原 ${s0(r)}</span>` : ""}</button>`;
  }
  const rowCls = r => r.s !== s0(r) ? "chg" : CLS[r.s];
  function rowHTML(r, i) {
    return `<tr class="${rowCls(r)}"><td class="c1">${i + 1}</td><td class="c2">${esc(r.m)}</td><td class="ct">${stCell(r)}</td><td class="ct">${pg(r) ? "第" + pg(r) + "张" : ""}</td><td class="L">${r.L}</td><td class="W">${r.w}</td><td class="Q">${n0(r.q)}</td><td>${n1(kg(r))}</td><td class="nt${flagged(r) ? " flag" : ""}">${esc(r.n)}</td></tr>`;
  }
  const HEAD = `<tr><th class="c1">序</th><th class="c2">型号</th><th>状态</th><th>页码</th><th>长度</th><th>支重</th><th>支数</th><th>重量kg</th><th>备注</th></tr>`;

  /* ---------- 页面：今日清单 ---------- */
  function viewList() {
    const tool = `<div class="qd-tool"><button type="button" class="btn primary" id="qdImp">导入当天文件</button><button type="button" class="btn" id="qdExp">导出 Excel</button>
      <span class="sub">${day ? md(day) : ""}${rows.length ? ` · ${rows.length} 行` : ""}${yday ? ` · 和 ${md(yday)} 比` : ""}${ship ? ` · 另有已出货 ${ship} 行（不算在内）` : ""}</span></div>`;
    const conf = armImport ? `<div class="qd-confirm"><div class="t"><b>${md(armImport.d)} 已经有 ${armImport.have.length} 行数据。</b><br>导入会用文件里的 ${armImport.recs.length} 行替换掉它们（查错单的核对结果会保留）。</div><button type="button" class="btn primary" id="qdImpOk">替换</button><button type="button" class="btn" id="qdImpNo">取消</button></div>` : "";
    const m = `<div class="qd-msg" id="qdMsg"></div>`;
    if (busy) return tool + m + `<div class="qd-empty"><b>正在导入…</b>请不要关掉 App。</div>`;
    if (!rows.length) return tool + conf + m + `<div class="qd-empty"><b>${md(day)} 还没有清单</b><span>拍照发给 Claude，拿到“车间盘点导入_MMDD.json”以后，点上面的“导入当天文件”选它就行。</span></div>`;
    const seg = `<div class="qd-seg" id="qdSeg">${[["photo", "照片顺序"], ["status", "按状态排列"], ["model", "按型号汇总"], ["cmp", "与昨天对比"]].map(([k, t]) => `<button type="button" data-sub="${k}" aria-pressed="${sub === k}">${t}</button>`).join("")}</div>`;
    let body = "";
    if (sub === "photo") body = `<div class="qd-tw"><table class="qd-t"><thead>${HEAD}</thead><tbody>${rows.map(rowHTML).join("")}</tbody></table></div>`;
    else if (sub === "status") {
      const idx = new Map(rows.map((r, i) => [r.id, i]));
      const ord = rows.slice().sort((a, b) => rankOf(a, idx.get(a.id)) - rankOf(b, idx.get(b.id)));
      let html = "", cur = null;
      ord.forEach(r => { if (r.s !== cur) { cur = r.s; const l = rows.filter(x => x.s === cur); html += `<tr class="grp"><td class="c1"></td><td colspan="8">${cur} · ${l.length} 行 · ${n0(l.reduce((a, x) => a + x.q, 0))} 支 · ${n1(l.reduce((a, x) => a + kg(x), 0))} kg</td></tr>` } html += rowHTML(r, idx.get(r.id)) });
      body = `<div class="qd-tw"><table class="qd-t"><thead>${HEAD}</thead><tbody>${html}</tbody></table></div><div class="sub" style="color:var(--muted);font-size:13px">改过状态的行（黄色）排在新状态那一组的最前面。点状态可以改，改错了点“恢复”。</div>`;
    } else if (sub === "model") {
      const g = new Map(); rows.forEach(r => { const k = r.m + "|" + r.L + "|" + r.w; const a = g.get(k) || { m: r.m, L: r.L, w: r.w, q: { "已入库": 0, "包装中": 0, "刚生产": 0 }, kg: 0 }; a.q[r.s] += r.q; a.kg += kg(r); g.set(k, a) });
      const ks = [...g.values()].sort((a, b) => a.m < b.m ? -1 : a.m > b.m ? 1 : a.L - b.L || a.w - b.w);
      body = `<div class="qd-tw"><table class="qd-t"><thead><tr><th class="c1">#</th><th class="c2">型号</th><th>长度</th><th>支重</th><th>已入库</th><th>包装中</th><th>刚生产</th><th>合计</th><th>重量kg</th></tr></thead><tbody>${ks.map((a, i) => { const t = a.q["已入库"] + a.q["包装中"] + a.q["刚生产"]; return `<tr><td class="c1">${i + 1}</td><td class="c2">${esc(a.m)}</td><td class="L">${a.L}</td><td class="W">${a.w}</td>${ST.map(s => `<td style="background:var(--st-${CLS[s] === "nw" ? "new" : CLS[s]})">${a.q[s] ? n0(a.q[s]) : ""}</td>`).join("")}<td class="Q">${n0(t)}</td><td>${n1(a.kg)}</td></tr>` }).join("")}</tbody></table></div>`;
    } else body = cmpHTML();
    return tool + conf + m + totalsHTML(rows) + seg + body;
  }
  function cmpRows() {
    const kk = r => norm(r.m) + "|" + (+r.L) + "|" + (+r.w);
    const yk = new Map(); yrows.forEach(r => { const k = kk(r); const a = yk.get(k) || { q: 0, s: new Set(), m: r.m, L: +r.L, w: +r.w }; a.q += r.q; a.s.add(r.s); yk.set(k, a) });
    const tk = new Map(); rows.forEach((r, i) => { const k = kk(r); const a = tk.get(k) || { q: 0, s: new Set(), m: r.m, L: +r.L, w: +r.w, i, p: pg(r) }; a.q += r.q; a.s.add(r.s); tk.set(k, a) });
    const js = s => [...s].sort().join("/"), out = [];
    tk.forEach((a, k) => { const y = yk.get(k); const kind = !y ? "新增" : (a.q !== y.q || js(a.s) !== js(y.s)) ? "有变化" : "相同"; out.push({ kind, m: a.m, L: a.L, w: a.w, yq: y ? y.q : null, ys: y ? js(y.s) : "", tq: a.q, ts: js(a.s), o: a.i, p: "第" + a.p + "张" }) });
    yk.forEach((y, k) => { if (!tk.has(k)) out.push({ kind: "今天没有", m: y.m, L: y.L, w: y.w, yq: y.q, ys: js(y.s), tq: 0, ts: "", o: 1e6 + out.length, p: "" }) });
    return out.sort((a, b) => a.o - b.o);
  }
  function cmpHTML() {
    if (!yday) return `<div class="qd-empty"><b>没有更早的数据可以比</b></div>`;
    const all = cmpRows(), cnt = k => all.filter(x => x.kind === k).length;
    const list = cmpF === "all" ? all : all.filter(x => x.kind === cmpF);
    const KC = { "新增": "kn", "有变化": "kc", "今天没有": "kg", "相同": "" };
    const ex = x => { if (x.kind === "新增") return "昨天没有这个规格"; if (x.kind === "今天没有") return "昨天有，今天单上没有"; if (x.kind === "相同") return "一样"; const d = x.tq - x.yq, p = []; if (d) p.push((d > 0 ? "多 " : "少 ") + n0(Math.abs(d)) + " 支"); if (x.ys !== x.ts) p.push(`状态 ${x.ys}→${x.ts}`); return p.join("；") };
    return `<div class="qd-chips" id="qdCmpF">${[["all", "全部", all.length], ["有变化", "有变化", cnt("有变化")], ["新增", "新增", cnt("新增")], ["今天没有", "今天没有", cnt("今天没有")], ["相同", "相同", cnt("相同")]].map(([k, t, c]) => `<button type="button" data-cf="${k}" aria-pressed="${cmpF === k}">${t} ${c}</button>`).join("")}</div>
      <div class="sub" style="color:var(--muted);font-size:13px">绿色 = 新增，黄色 = 有变化，灰色 = 今天没有，白色 = 相同（按“型号+长度+支重”合计比）</div>
      <div class="qd-tw"><table class="qd-t"><thead><tr><th class="c1">#</th><th class="c2">型号</th><th>长度</th><th>支重</th><th>${md(yday)}</th><th>今天</th><th>变化</th><th>说明</th><th>页码</th></tr></thead><tbody>${list.map((x, i) => { const d = x.tq - (x.yq || 0); return `<tr class="${KC[x.kind]}"><td class="c1">${i + 1}</td><td class="c2">${esc(x.m)}</td><td class="L">${x.L}</td><td class="W">${x.w}</td><td>${x.yq === null ? "" : n0(x.yq)}</td><td class="Q">${x.kind === "今天没有" ? "" : n0(x.tq)}</td><td class="${d > 0 ? "up" : d < 0 ? "dn" : ""}">${d > 0 ? "+" : ""}${n0(d)}</td><td class="nt">${esc(ex(x))}</td><td class="ct">${x.p}</td></tr>` }).join("")}</tbody></table></div>`;
  }

  /* ---------- 页面：查错核对 ---------- */
  function viewCheck() {
    const m = `<div class="qd-msg" id="qdMsg"></div>`;
    if (!rows.length) return m + `<div class="qd-empty"><b>${md(day)} 还没有清单</b><span>先在“今日清单”导入当天文件。</span></div>`;
    const L = ckList();
    if (!L.length) return m + `<div class="qd-empty"><b>${checks ? "今天没有发现可疑的地方" : "这一天没有查错单"}</b><span>${checks ? "" : "查错单跟着导入文件一起来。手动录入的日子没有查错单。"}</span></div>`;
    const done = L.filter(c => ckRes(c.id) && ckRes(c.id) !== "待查").length, pct = Math.round(done / L.length * 100);
    const cnt = l => L.filter(c => c.lvl === l).length;
    const list = ckF === "all" ? L : ckF === "todo" ? L.filter(c => !ckRes(c.id) || ckRes(c.id) === "待查") : L.filter(c => c.lvl === ckF);
    const idx = new Map(rows.map((r, i) => [r.id, i])), LV = { "高": "h", "中": "m", "低": "l" };
    const card = c => {
      const r = rows[idx.get(c.id)], res = ckRes(c.id), lv = LV[c.lvl] || "l";
      const ed = editId === c.id ? `<div class="qd-ed" data-ed="${c.id}"><label>型号<input id="qe_m" value="${esc(r.m)}" autocapitalize="characters" spellcheck="false"></label><label>长度(米)<input id="qe_L" inputmode="decimal" value="${r.L}"></label><label>支重<input id="qe_w" inputmode="decimal" value="${r.w}"></label><label>支数<input id="qe_q" inputmode="numeric" value="${r.q}"></label></div><div class="acts"><button type="button" class="btn primary" data-save="${c.id}" aria-pressed="true">保存并标“已改正”</button><button type="button" data-cancel="1">取消</button></div>` :
        `<div class="acts">${["没错", "已改正", "待查"].map(v => `<button type="button" data-res="${v}" data-id="${c.id}" aria-pressed="${res === v}">${v}</button>`).join("")}<button type="button" data-edit="${c.id}">改数据</button></div>`;
      return `<div class="qd-c ${lv}${res && res !== "待查" ? " done" : ""}"><div class="top"><span><span class="qd-lv ${lv}">${c.lvl}</span> 明细 ${idx.get(c.id) + 1} · ${r.p || ""} · ${r.s}</span><span>${res ? "✓ " + res : ""}</span></div>
        <div class="spec"><span>${esc(r.m)}</span><span class="L">${r.L}米</span><span class="W">${r.w}</span><span>${n0(r.q)} 支</span></div>
        <div class="why"><b>${esc(c.kind)}</b>${esc(c.why || "")}</div>${c.sug ? `<div class="sug">${esc(c.sug)}</div>` : ""}${ed}</div>`;
    };
    return m + `<div class="qd-prog"><span>已核对 ${done} / ${L.length}</span><span class="bar"><i style="width:${pct}%"></i></span></div>
      <div class="qd-chips" id="qdCkF">${[["all", "全部", L.length], ["todo", "未核对", L.length - done], ["高", "高", cnt("高")], ["中", "中", cnt("中")], ["低", "低", cnt("低")]].map(([k, t, c]) => `<button type="button" data-ck="${k}" aria-pressed="${ckF === k}">${t} ${c}</button>`).join("")}</div>
      <div class="qd-ck">${list.map(card).join("") || `<div class="qd-empty"><b>这一类都核对完了</b></div>`}</div>`;
  }

  /* ---------- 页面：型号查询 ---------- */
  function viewQuery() {
    const k = norm(qtext), hit = k ? rows.map((r, i) => [r, i]).filter(([r]) => norm(r.m).includes(k)) : [];
    let out = `<div class="qd-q"><input id="qdQ" placeholder="输入型号，如 8004、QG7801" value="${esc(qtext)}" autocapitalize="characters" spellcheck="false" autocomplete="off" enterkeyhint="search"></div>
      <div class="sub" style="color:var(--muted);font-size:13px">可以只输一部分，不分大小写，有没有“-”都行。${k ? `找到 <b>${hit.length}</b> 行（${md(day)}）` : ""}</div>`;
    if (!k) return out;
    if (!hit.length) return out + `<div class="qd-empty"><b>${md(day)} 没找到这个型号</b><span>换个写法试试，或者看最近几天：</span><button type="button" class="btn" id="qdHist">看最近 ${histDays} 天</button></div>` + histHTML(k);
    out += totalsHTML(hit.map(x => x[0]));
    out += `<div class="qd-tw" style="max-height:none"><table class="qd-t"><thead>${HEAD}</thead><tbody>${hit.map(([r, i]) => rowHTML(r, i)).join("")}</tbody></table></div>`;
    out += hist ? histHTML(k) : `<div><button type="button" class="btn" id="qdHist">看这个型号最近 ${histDays} 天的走势</button></div>`;
    return out;
  }
  function histHTML(k) {
    if (!hist) return "";
    if (hist === "loading") return `<div class="qd-trend">正在读取最近 ${histDays} 天…</div>`;
    const days = [...new Set(hist.map(r => r.d))].sort();
    const by = days.map(d => { const l = hist.filter(r => r.d === d && norm(r.m).includes(k)); const o = { d }; ST.forEach(s => o[s] = l.filter(r => r.s === s).reduce((a, r) => a + r.q, 0)); o.t = ST.reduce((a, s) => a + o[s], 0); return o });
    if (!by.some(o => o.t)) return `<div class="qd-trend">最近 ${histDays} 天也没有这个型号。</div>`;
    const W = 640, H = 180, pl = 56, pb = 24, mx = Math.max(...by.map(o => o.t)) || 1, bw = (W - pl - 8) / by.length;
    const C = { "已入库": "#7fb069", "包装中": "#6fa8dc", "刚生产": "#f6b26b" };
    let bars = ""; by.forEach((o, i) => { let y = H - pb; ST.forEach(s => { const h = o[s] / mx * (H - pb - 10); if (h > 0) { y -= h; bars += `<rect x="${pl + i * bw + 2}" y="${y}" width="${Math.max(2, bw - 4)}" height="${h}" fill="${C[s]}"><title>${md(o.d)} ${s} ${n0(o[s])} 支</title></rect>` } }); bars += `<text x="${pl + i * bw + bw / 2}" y="${H - 6}" font-size="11" text-anchor="middle" fill="currentColor">${md(o.d)}</text>` });
    const ax = [0, .5, 1].map(f => `<text x="${pl - 6}" y="${H - pb - f * (H - pb - 10) + 4}" font-size="11" text-anchor="end" fill="currentColor">${n0(mx * f)}</text><line x1="${pl}" x2="${W - 4}" y1="${H - pb - f * (H - pb - 10)}" y2="${H - pb - f * (H - pb - 10)}" stroke="currentColor" stroke-opacity=".15"/>`).join("");
    return `<div class="qd-trend"><b>最近 ${histDays} 天（支）</b> <span style="font-size:13px;color:var(--muted)">绿 已入库 · 蓝 包装中 · 橙 刚生产</span><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每天支数">${ax}${bars}</svg>
      <div class="qd-tw" style="max-height:none;margin-top:8px"><table class="qd-t"><thead><tr><th class="c1">#</th><th class="c2">日期</th><th>已入库</th><th>包装中</th><th>刚生产</th><th>合计</th></tr></thead><tbody>${by.slice().reverse().map((o, i) => `<tr><td class="c1">${i + 1}</td><td class="c2">${md(o.d)}</td>${ST.map(s => `<td>${o[s] ? n0(o[s]) : ""}</td>`).join("")}<td class="Q">${n0(o.t)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  async function loadHist() {
    hist = "loading"; render();
    try { const d0 = new Date(day + "T12:00:00"); d0.setDate(d0.getDate() - histDays + 1); const start = d0.toISOString().slice(0, 10); hist = (await R.query("d", ">=", start)).filter(r => r.d <= day && r.q > 0 && ST.includes(r.s)) }
    catch (e) { hist = null; msg("读取最近几天失败。", "err") }
    render();
  }

  /* ---------- 页面：更多 ---------- */
  function viewMore() {
    const ch = window.CHUHUO_URL || "./chuhuo/";
    const it = (t, p, btn, soon) => `<div class="it"><h3>${t}</h3>${soon ? `<span class="soon">${soon}</span>` : ""}<p>${p}</p>${btn || ""}</div>`;
    return `<div class="qd-msg" id="qdMsg"></div><div class="qd-more">
      ${it("库存看板", "每天库存走势、各状态占比、出货（估）、支重区间。", "", "第二步做")}
      ${it("产品大数据 / 型号库", "每个型号的库存、出货（估）、可卖天数、趋势；型号标准库审核。", "", "第三步做")}
      ${it("出货", "分配客户和加工厂、提货单、提货后自动扣库存。以后接进这里。", `<a class="btn" href="${ch}" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center">打开现有的出货 App</a>`, "预留入口")}
      ${it("拍照识别", "在 App 里直接拍手写单识别。需要 Claude API 密钥（按用量付费），以后再开。", `<button type="button" class="btn" id="qdScan">打开拍照识别</button>`)}
      ${it("型号库", "录入时下拉用的型号、长度、支重。", `<button type="button" class="btn" id="qdCat">打开型号库</button>`)}
      ${it("备份 / 恢复", "把云端全部数据存成一个文件，或者从备份文件恢复。", `<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="qdBak">备份全部数据</button><button type="button" class="btn" id="qdRes">从备份恢复</button></div>`)}
      ${it("账号", esc("当前账号：" + (Cloud.email() || "")), `<button type="button" class="btn" id="qdOut">退出登录</button>`)}
    </div>`;
  }

  /* ---------- 渲染 + 事件 ---------- */
  function render() {
    if (tab === "entry") return;
    const keepQ = document.activeElement && document.activeElement.id === "qdQ", sel = keepQ ? document.activeElement.selectionStart : 0;
    const old = $("qdMsg"), om = old ? [old.textContent, old.className] : null;
    const tw = box.querySelector(".qd-tw"), sx = tw ? tw.scrollLeft : 0, sy = tw ? tw.scrollTop : 0;
    box.innerHTML = tab === "list" ? viewList() : tab === "check" ? viewCheck() : tab === "query" ? viewQuery() : viewMore();
    if (om && $("qdMsg")) { $("qdMsg").textContent = om[0]; $("qdMsg").className = om[1] }
    const tw2 = box.querySelector(".qd-tw"); if (tw2) { tw2.scrollLeft = sx; tw2.scrollTop = sy }
    if (keepQ && $("qdQ")) { $("qdQ").focus(); try { $("qdQ").setSelectionRange(sel, sel) } catch (e) { } }
    if (editId && $("qe_q")) $("qe_q").focus();
  }
  box.addEventListener("click", e => {
    const t = e.target;
    const b = t.closest("button, a"); if (!b) return;
    if (b.id === "qdImp") { file.click(); return }
    if (b.id === "qdImpOk") { doImport(); return }
    if (b.id === "qdImpNo") { armImport = null; render(); msg("已取消导入，原来的数据没有动。"); return }
    if (b.id === "qdExp") { exportXlsx(); return }
    if (b.dataset.sub) { sub = b.dataset.sub; LS.set("qd_sub", sub); openS = null; render(); return }
    if (b.dataset.cf) { cmpF = b.dataset.cf; render(); return }
    if (b.dataset.ck) { ckF = b.dataset.ck; render(); return }
    if (b.dataset.open) { openS = b.dataset.open; render(); return }
    if (b.dataset.ss !== undefined && b.dataset.id) { if (!b.dataset.ss) { openS = null; render() } else setStatus(b.dataset.id, b.dataset.ss); return }
    if (b.dataset.res) { setRes(b.dataset.id, b.dataset.res); return }
    if (b.dataset.edit) { editId = b.dataset.edit; render(); return }
    if (b.dataset.cancel) { editId = null; render(); return }
    if (b.dataset.save) {
      const v = { m: $("qe_m").value.trim().toUpperCase().replace(/－/g, "-").replace(/\s+/g, ""), L: parseFloat($("qe_L").value), w: parseFloat($("qe_w").value), q: parseInt(String($("qe_q").value).replace(/[^\d]/g, ""), 10) };
      if (!v.m || !(v.L > 0) || !(v.w > 0) || !(v.q >= 0)) { msg("型号、长度、支重、支数都要填对。", "err"); return }
      saveEdit(b.dataset.save, v); return;
    }
    if (b.id === "qdHist") { loadHist(); return }
    if (b.id === "qdScan") { setTab("entry"); const s = $("scanTop"); if (s) s.click(); return }
    if (b.id === "qdCat") { const c = $("catBtn"); if (c) c.click(); return }
    if (b.id === "qdBak") { const c = $("backupBtn"); if (c) { c.click(); msg("正在生成备份…") } return }
    if (b.id === "qdRes") { const c = $("restoreBtn"); if (c) c.click(); return }
    if (b.id === "qdOut") { Cloud.signOut(); return }
  });
  box.addEventListener("input", e => { if (e.target.id === "qdQ") { qtext = e.target.value; hist = hist && hist !== "loading" ? hist : null; render() } });
  box.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.closest(".qd-ed")) { const s = box.querySelector("[data-save]"); if (s) s.click() } if (e.key === "Escape" && editId) { editId = null; render() } });

  /* ---------- 开始 ---------- */
  (async () => { try { await Cloud.ready } catch (e) { } setTab(tab); load() })();
  window.QD = { load, setTab, state: () => ({ day, rows, yday, yrows, checks }) };
})();
