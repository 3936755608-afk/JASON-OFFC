/* 语音盘点测试页：三种听写方式（连续听 / 按一下说一句 / 键盘听写）+ 大字显示 + 耳机播报 + 改上一条。
   记录只存在这台手机（localStorage），可以导出 Excel 发回来，用来调识别。 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n0 = n => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  const n1 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
  let entries = LS.get("yy_entries", []), mode = LS.get("yy_mode", "cont"), status = LS.get("yy_status", "已入库"), undoStack = [], editId = null;
  let lib = VP.makeLib(window.BASE_CATALOG || []), libSrc = "基础型号库";
  const diag = { sr: !!(window.SpeechRecognition || window.webkitSpeechRecognition), standalone: !!(navigator.standalone || matchMedia("(display-mode: standalone)").matches), ua: navigator.userAgent, starts: 0, results: 0, errors: [], tts: "speechSynthesis" in window };
  function paintDiag() { $("diag").textContent = `语音识别：${diag.sr ? "有" : "没有（这个浏览器不支持）"}\n主屏幕 App 模式：${diag.standalone ? "是" : "否（在 Safari 里打开）"}\n朗读：${diag.tts ? "有" : "没有"}，中文声音 ${(speechSynthesis.getVoices ? speechSynthesis.getVoices() : []).filter(v => /zh/i.test(v.lang)).length} 个\n开始听 ${diag.starts} 次，识别到 ${diag.results} 句\n型号库：${libSrc}，${lib.size} 个型号\n最近错误：${diag.errors.slice(-6).join(" | ") || "无"}\n${diag.ua}` }

  // 型号库：登录后读 App 里的型号库（和录入页同一份）；读不到就用基础型号库
  (async () => { try { await Cloud.ready; const c = await Cloud.kv("pandian_kv").get("catalog"); if (Array.isArray(c) && c.length) { lib = VP.makeLib(c.concat(window.BASE_CATALOG || [])); libSrc = "App 型号库" } } catch (e) { diag.errors.push("读型号库：" + (e.code || e.message)) } paintLib(); paintDiag() })();
  function paintLib() { $("lib").textContent = `型号库 ${lib.size} 个型号（${libSrc}）` }

  /* ---------- 播报 ---------- */
  let speaking = false;
  function say(text, then) {
    if (!$("tts").checked || !diag.tts || !text) { then && then(); return }
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = "zh-CN"; u.rate = +$("rate").value;
      const v = speechSynthesis.getVoices().find(x => /zh[-_]CN/i.test(x.lang)); if (v) u.voice = v;
      speaking = true; let done = false; const fin = () => { if (done) return; done = true; speaking = false; then && then() };
      u.onend = fin; u.onerror = fin; setTimeout(fin, 600 + text.length * 260); speechSynthesis.speak(u) } catch (e) { speaking = false; then && then() }
  }
  // 耳机里只说短话：没问题报“型号，支数，已记录”；有问题报最要紧的一句
  function shortFlag(f) { if (/按型号库改成/.test(f)) return "型号按库改成" + f.split("改成 ")[1]; if (/不确定/.test(f)) return "型号没听清，请重说"; if (/型号库里没有“/.test(f)) return "型号库里没有，请核对"; if (/几种支重/.test(f)) return "请说支重"; if (/在库里没有/.test(f)) return "支重和库里不一样"; if (/没有 .* 米/.test(f)) return "库里没有这个长度"; return f.replace(/[“”]/g, "") }
  const sayRec = e => e.flags.length ? `${e.m ? e.m + "，" : ""}${e.q ? e.q + "支，" : ""}${shortFlag(e.flags[0])}` : `${e.m}，${e.q}支，已记录`;

  /* ---------- 识别 ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, want = false, gotFinal = false, recT0 = 0;
  // 看门狗：连续听时，如果 iPhone 自己停了又没重新开始，3 秒内自动接上
  setInterval(() => { if (want && mode === "cont" && !rec && !speaking) { diag.errors.push("自动接上"); startRec() } }, 3000);
  // 屏幕常亮（iPhone iOS 16.4 以上支持）
  let wake = null; async function keepAwake(on) { try { if (on && "wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null }) } else if (!on && wake) { await wake.release(); wake = null } } catch (e) { diag.errors.push("常亮：" + e.name) } }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && want) keepAwake(true) });
  function startRec() {
    if (!SR) { live("这个浏览器没有语音识别。请用“键盘听写”。", true); return }
    if (speaking) return;
    try { if (rec) { rec.onend = null; rec.abort() } } catch (e) { }
    rec = new SR(); rec.lang = "zh-CN"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 3; gotFinal = false;
    rec.onresult = ev => { let fin = null, intr = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) fin = [...r].map(a => a.transcript); else intr += r[0].transcript }
      if (intr) live(intr); if (fin && !gotFinal) { gotFinal = true; diag.results++; handle(fin) } };
    rec.onerror = ev => { diag.errors.push(ev.error); paintDiag(); if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { want = false; paintCtl(); live("没有麦克风或语音识别权限。iPhone：设置 → Safari → 麦克风 允许；设置 → 通用 → 键盘 → 打开“启用听写”。", true) } };
    rec.onend = () => { rec = null; if (want && mode === "cont" && !speaking) setTimeout(() => { if (want && !speaking && !rec) startRec() }, 250); paintCtl() };
    try { rec.start(); recT0 = Date.now(); diag.starts++; paintDiag() } catch (e) { diag.errors.push("start:" + e.message); paintDiag() }
    paintCtl();
  }
  function stopRec() { want = false; try { if (rec) { rec.onend = null; rec.abort() } } catch (e) { } rec = null; paintCtl() }
  function afterSpeak() { if (want && mode === "cont") startRec(); paintCtl() }
  function live(t, fin) { $("live").textContent = t || ""; $("live").className = "live" + (fin ? " final" : "") }

  /* ---------- 处理一句话 ---------- */
  function save() { LS.set("yy_entries", entries) }
  function handle(alts) {
    alts = [].concat(alts).filter(Boolean); if (!alts.length) return; live(alts[0], true);
    // 几个候选里挑问题最少的那个
    let best = null; for (const a of alts) { const p = VP.parse(a); if (p.cmd) { best = { a, p }; break } const r = lib.resolve(p.rec); if (!best || (best.r && r.flags.length < best.r.flags.length)) best = { a, p, r } }
    const { a, p } = best; let speak = "";
    // 上一条有问题（例如“请说支重”），这句只说了支重/长度/支数、没说型号 → 当作补上一条
    if (!p.cmd && p.rec && !p.rec.m && entries[0] && entries[0].flags && entries[0].flags.length && ["L", "w", "q"].some(k => p.rec[k] != null)) { p.cmd = "fix"; p.p = {}; ["L", "w", "q"].forEach(k => { if (p.rec[k] != null) p.p[k] = p.rec[k] }) }
    if (p.cmd === "fix") { const e = entries[0]; if (!e) speak = "还没有记录"; else { undoStack.push({ k: "fix", id: e.id, before: JSON.parse(JSON.stringify(e)) }); const r = lib.resolve(Object.assign({ m: e.m, L: e.L, w: e.autoW && p.p.L != null ? null : e.w, q: e.q }, p.p)); Object.assign(e, pick(r), { fixed: (e.fixed || 0) + 1, fixRaw: (e.fixRaw ? e.fixRaw + "；" : "") + a, need: e.need || !!r.flags.length, ok: !r.flags.length }); save(); showCard(e); speak = "已改，" + sayRec(e).replace(/，?已记录$/, "") } }
    else if (p.cmd === "del") { const e = entries.shift(); if (e) { undoStack.push({ k: "del", e }); save(); speak = "已删除上一条" } else speak = "没有可以删的"; showCard(entries[0]) }
    else if (p.cmd === "undo") { const u = undoStack.pop(); if (!u) speak = "没有可以撤销的"; else { if (u.k === "add") entries = entries.filter(x => x.id !== u.id); else if (u.k === "del") entries.unshift(u.e); else if (u.k === "fix") { const i = entries.findIndex(x => x.id === u.id); if (i >= 0) entries[i] = u.before } save(); speak = "已撤销"; showCard(entries[0]) } }
    else if (p.cmd === "status") { setStatus(p.s); speak = "已切换" + p.s }
    else if (p.cmd === "pause") { stopRec(); speak = "已暂停" }
    else if (p.cmd === "end") { stopRec(); const n = pending().length; speak = n ? `还有${n}条要确认，确认后再结束` : `盘点结束，共${entries.length}条，正在导出`; if (!n) setTimeout(finish, 300); else markPending() }
    else if (p.cmd === "ok") { const e = entries[0]; if (e && e.need && !e.ok && !(e.m && e.L > 0 && e.w > 0 && e.q > 0)) speak = "上一条还没补全，不能确认"; else if (e && e.need && !e.ok) { e.ok = true; save(); showCard(e); speak = "已确认" } else speak = "上一条不用确认" }
    else { const r = best.r || lib.resolve(p.rec), e = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), raw: a, alts: alts.slice(0, 3), s: status }, pick(r)); e.ms = recT0 ? Date.now() - recT0 : null; entries.unshift(e); dupCheck(e); undoStack.push({ k: "add", id: e.id }); save(); showCard(e); speak = sayRec(e) }
    paintList(); if (mode === "cont" && want) { try { if (rec) { rec.onend = null; rec.abort() } } catch (x) { } } say(speak, afterSpeak);
  }
  // 有问题的记录 need=true：必须人工确认（点“确认”、点候选、改好，或说“确认”）才算数；没确认的不能导出成正式结果
  const pick = r => ({ m: r.m, L: r.L ?? null, w: r.w ?? null, q: r.q ?? null, kg: r.kg, flags: r.flags, cands: r.cands, wOpts: r.wOpts || null, autoW: !!r.autoW, need: !!(r.flags && r.flags.length), ok: false });
  const pending = () => entries.filter(e => e.need && !e.ok);
  function dupCheck(e) { const p = entries[1]; if (p && p.m === e.m && p.L === e.L && p.w === e.w && p.q === e.q && e.t - p.t < 120000) { e.flags = (e.flags || []).concat("和上一条完全一样，是不是说重复了？"); e.need = true } }

  /* ---------- 画面 ---------- */
  function showCard(e) {
    if (!e) { $("cardBox").innerHTML = ""; return }
    const fl = e.flags && e.flags.length;
    $("cardBox").innerHTML = `<div class="card${e.need && !e.ok ? " flag" : ""}"><div class="m">${esc(e.m || "？")}</div>
      <div><div class="k">长度(米)</div><div class="v L">${e.L ?? "？"}</div></div><div><div class="k">支重${e.autoW ? "（库里带出）" : ""}</div><div class="v W">${e.w ?? "？"}</div></div>
      <div><div class="k">支数</div><div class="v Q">${e.q != null ? n0(e.q) : "？"}</div></div><div><div class="k">理论重量</div><div class="v">${e.kg ? n1(e.kg) + " kg" : "—"}</div></div>
      ${fl ? `<div class="flags">⚠ ${e.flags.map(esc).join("；")}</div>` : ""}
      ${fl && e.cands && e.cands.length > 1 ? `<div class="chips">${e.cands.map(c => `<button type="button" data-cm="${esc(c)}" data-id="${e.id}">${esc(c)}</button>`).join("")}</div>` : ""}
      ${e.wOpts ? `<div class="chips">${e.wOpts.map(w => `<button type="button" data-cw="${w}" data-id="${e.id}">支重 ${w}</button>`).join("")}</div>` : ""}
      ${e.need ? (e.ok ? `<div class="flags" style="color:var(--ok)">✓ 已人工确认</div>` : `<div class="chips"><button type="button" data-ok="${e.id}" style="background:#c00000;color:#fff;border-color:#c00000">✓ 核对过了，确认这条</button></div>`) : ""}
      <div class="raw">听到：“${esc(e.raw)}”${e.fixRaw ? "　改：" + esc(e.fixRaw) : ""} · ${esc(e.s)}</div></div>`;
  }
  function paintList() {
    const fl = pending().length, fx = entries.filter(e => e.fixed || e.hand).length, kg = entries.reduce((s, e) => s + (e.kg || 0), 0), qs = entries.reduce((s, e) => s + (e.q || 0), 0);
    $("stat").innerHTML = `<span>已盘 <b>${entries.length}</b> 笔<span class="sub">（测试目标 20）</span></span><span>累计 <b>${n0(qs)}</b> 支</span><span><b>${n1(kg)}</b> kg</span><span>待确认 <b class="${fl ? "bad" : "ok"}">${fl}</b></span><span class="sub">改过 ${fx}</span>`;
    $("list").innerHTML = entries.length ? `<table><thead><tr><th>#</th><th>型号</th><th>长度</th><th>支重</th><th>支数</th><th>状态</th><th>听到的话</th></tr></thead><tbody>${entries.map((e, i) => `<tr class="click${e.need && !e.ok ? " flag" : ""}" data-ed="${e.id}"><td>${entries.length - i}</td><td class="tl"><b>${esc(e.m)}</b></td><td>${e.L ?? ""}</td><td>${e.w ?? ""}</td><td><b>${e.q != null ? n0(e.q) : ""}</b></td><td>${esc(e.s)}${e.need ? (e.ok ? " ✓" : " ⚠") : ""}</td><td class="tl" style="color:var(--muted)">${esc(e.raw)}</td></tr>`).join("")}</tbody></table>` : `<div class="sub" style="padding:14px">还没有记录。</div>`;
    const x = entries.find(v => v.id === editId);
    $("edBox").innerHTML = x ? `<div class="ed"><input id="e_m" value="${esc(x.m)}" style="text-transform:uppercase"><input id="e_L" inputmode="decimal" value="${x.L ?? ""}"><input id="e_w" inputmode="decimal" value="${x.w ?? ""}"><input id="e_q" inputmode="numeric" value="${x.q ?? ""}"></div><div class="row"><button type="button" class="btn" data-esave="${x.id}" style="background:var(--accent);color:var(--accent-ink)">保存</button><button type="button" class="btn" data-ecancel="1">取消</button><button type="button" class="btn danger" data-edel="${x.id}">删除这条</button></div>` : "";
  }
  function paintCtl() {
    for (const b of $("modes").children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    if (mode === "dict") $("ctl").innerHTML = `<input class="dict" id="dict" placeholder="点这里，再点键盘上的 🎤 说一句" autocomplete="off" enterkeyhint="done"><div class="sub">说完会自动记录（停 1.5 秒），也可以按“完成”。iPhone 键盘听写最稳，没网也能用。</div>`;
    else if (mode === "ptt") $("ctl").innerHTML = `<button type="button" class="big${rec ? " on" : ""}" id="go">${rec ? "正在听…说完自动记录" : "🎤 按一下，说一句"}</button>`;
    else $("ctl").innerHTML = `<button type="button" class="big${want ? " on" : ""}" id="go">${want ? "■ 正在连续听（点一下暂停）" : "🎤 开始语音盘点"}</button>`;
  }
  function setStatus(s) { status = s; LS.set("yy_status", s); for (const b of $("sts").children) b.setAttribute("aria-pressed", String(b.dataset.s === s)) }

  /* ---------- 事件 ---------- */
  $("modes").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (!b) return; stopRec(); mode = b.dataset.mode; LS.set("yy_mode", mode); paintCtl() });
  $("sts").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) setStatus(b.dataset.s) });
  $("ctl").addEventListener("click", e => { if (e.target.id !== "go") return;
    if (mode === "cont") { if (want) { stopRec(); keepAwake(false); live("") } else { want = true; keepAwake(true); say("开始盘点", () => startRec()); paintCtl() } }
    else if (mode === "ptt") { if (rec) stopRec(); else { want = false; startRec() } } });
  let dT = null;
  $("ctl").addEventListener("input", e => { if (e.target.id !== "dict") return; clearTimeout(dT); dT = setTimeout(() => { const v = e.target.value.trim(); if (v) { e.target.value = ""; handle([v]) } }, 1500) });
  $("ctl").addEventListener("keydown", e => { if (e.target.id === "dict" && e.key === "Enter") { e.preventDefault(); clearTimeout(dT); const v = e.target.value.trim(); if (v) { e.target.value = ""; handle([v]) } } });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-cm],[data-cw],[data-ed],[data-esave],[data-ecancel],[data-edel],[data-ok]"); if (!b) return; const ds = b.dataset;
    const find = id => entries.find(x => x.id === id);
    if (ds.ok) { const x = find(ds.ok); if (!x) return; if (!x.m || !(x.L > 0) || !(x.w > 0) || !(x.q > 0)) { say("先把这条补全"); alert("这条型号、长度、支重、支数还没全，点下面列表里这一行补全后再确认。"); editId = x.id; paintList(); return } x.ok = true; save(); showCard(x); paintList(); const nx = pending()[0]; if (nx) showCard(nx); return }
    if (ds.cm) { const x = find(ds.id); if (!x) return; const r = lib.resolve({ m: ds.cm, L: x.L, w: x.autoW ? null : x.w, q: x.q }); Object.assign(x, pick(r), { hand: true, need: true, ok: !r.flags.length }); save(); showCard(x); paintList(); say(`${x.m}，${x.q || ""}支`) }
    else if (ds.cw) { const x = find(ds.id); if (!x) return; const r = lib.resolve({ m: x.m, L: x.L, w: +ds.cw, q: x.q }); Object.assign(x, pick(r), { hand: true, need: true, ok: !r.flags.length }); save(); showCard(x); paintList() }
    else if (ds.ed) { editId = ds.ed; paintList(); showCard(find(ds.ed)) }
    else if (ds.ecancel) { editId = null; paintList() }
    else if (ds.edel) { entries = entries.filter(x => x.id !== ds.edel); editId = null; save(); paintList(); showCard(entries[0]) }
    else if (ds.esave) { const x = find(ds.esave); if (!x) return; const r = lib.resolve({ m: $("e_m").value.trim().toUpperCase(), L: parseFloat($("e_L").value) || null, w: parseFloat($("e_w").value) || null, q: parseInt($("e_q").value, 10) || null }); Object.assign(x, pick(r), { hand: true, need: x.need || !!r.flags.length, ok: true }); /* 人手改过 = 人工确认 */ editId = null; save(); paintList(); showCard(x) }
  });
  $("clr").addEventListener("click", () => { if ($("clr").dataset.arm !== "1") { $("clr").dataset.arm = "1"; $("clr").textContent = "再点一次确认清空"; return } entries = []; undoStack = []; save(); $("clr").dataset.arm = ""; $("clr").textContent = "清空测试记录"; paintList(); showCard(null) });
  function markPending() { const p = pending(); if (p.length) { editId = null; showCard(p[p.length - 1]); paintList(); window.scrollTo(0, 0) } }
  $("exp").addEventListener("click", () => finish());
  // 盘点完成：有待确认的先确认；然后导出 Excel（明细按说的顺序 + 按规格汇总 + 按状态汇总 + 测试信息）
  async function finish() {
    const pend = pending(); if (pend.length) { say(`还有${pend.length}条要确认`); markPending(); alert(`还有 ${pend.length} 条标黄的记录没确认。请逐条核对后点“确认这条”，再导出。`); return }
    if (!entries.length) { alert("还没有记录。"); return }
    try { await new Promise((ok, bad) => { if (window.ExcelJS) return ok(); const s = document.createElement("script"); s.src = "../exceljs.min.js"; s.onload = ok; s.onerror = bad; document.head.appendChild(s) });
      const wb = new ExcelJS.Workbook(), H = { bold: true, color: { argb: "FFFFFFFF" } }, fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF305496" } };
      const head = (ws, cols) => { const r = ws.addRow(cols); r.eachCell(c => { c.font = H; c.fill = fill }) };
      const list = entries.slice().reverse();
      const ws = wb.addWorksheet("明细"); head(ws, ["#", "时间", "型号", "长度(米)", "理论支重", "支数", "理论重量kg", "状态", "听到的话", "其他候选", "提示", "人工确认", "改过", "识别用时(秒)"]);
      list.forEach((e, i) => { const r = ws.addRow([i + 1, new Date(e.t).toLocaleTimeString("zh-CN"), e.m, e.L, e.w, e.q, null, e.s, e.raw, (e.alts || []).slice(1).join(" | "), (e.flags || []).join("；"), e.need ? "已确认" : "", [e.fixRaw, e.hand ? "手改" : ""].filter(Boolean).join("；"), e.ms ? +(e.ms / 1000).toFixed(1) : null]);
        r.getCell(7).value = { formula: `E${r.number}/6*D${r.number}*F${r.number}`, result: e.kg || 0 }; r.getCell(7).numFmt = "#,##0.0"; if (e.need) r.getCell(11).font = { color: { argb: "FFC00000" }, bold: true } });
      const tr = ws.addRow(["合计", "", "", "", "", { formula: `SUM(F2:F${list.length + 1})`, result: list.reduce((s, e) => s + (e.q || 0), 0) }, { formula: `SUM(G2:G${list.length + 1})`, result: list.reduce((s, e) => s + (e.kg || 0), 0) }]); tr.font = { bold: true };
      [5, 10, 14, 9, 9, 9, 11, 8, 34, 26, 36, 9, 20, 10].forEach((w, i) => ws.getColumn(i + 1).width = w); ws.views = [{ state: "frozen", ySplit: 1 }];
      // 按规格汇总：同型号、不同长度或支重分开算
      const g = new Map(); list.forEach(e => { const k = e.m + "|" + e.L + "|" + e.w + "|" + e.s; const x = g.get(k) || { m: e.m, L: e.L, w: e.w, s: e.s, q: 0, kg: 0, n: 0 }; x.q += e.q || 0; x.kg += e.kg || 0; x.n++; g.set(k, x) });
      const ws2 = wb.addWorksheet("按规格汇总"); head(ws2, ["型号", "长度(米)", "理论支重", "状态", "笔数", "支数", "理论重量kg"]);
      [...g.values()].sort((a, b) => a.m < b.m ? -1 : a.m > b.m ? 1 : a.L - b.L || a.w - b.w).forEach(x => { const r = ws2.addRow([x.m, x.L, x.w, x.s, x.n, x.q, +x.kg.toFixed(2)]); r.getCell(7).numFmt = "#,##0.0" });
      [14, 9, 9, 8, 6, 9, 11].forEach((w, i) => ws2.getColumn(i + 1).width = w);
      const ws3 = wb.addWorksheet("按状态汇总"); head(ws3, ["状态", "笔数", "支数", "理论重量kg"]);
      ["已入库", "包装中", "刚生产"].forEach(st => { const l = list.filter(e => e.s === st); if (l.length) ws3.addRow([st, l.length, l.reduce((s, e) => s + (e.q || 0), 0), +l.reduce((s, e) => s + (e.kg || 0), 0).toFixed(2)]) });
      ws3.addRow(["合计", list.length, list.reduce((s, e) => s + (e.q || 0), 0), +list.reduce((s, e) => s + (e.kg || 0), 0).toFixed(2)]).font = { bold: true }; [10, 8, 10, 12].forEach((w, i) => ws3.getColumn(i + 1).width = w);
      const ws4 = wb.addWorksheet("测试信息"); const need = list.filter(e => e.need).length, ms = list.map(e => e.ms).filter(Boolean);
      [["记录笔数", list.length], ["一次就对的", list.filter(e => !e.need && !e.fixed && !e.hand).length], ["要人工确认的", need], ["语音改过的", list.filter(e => e.fixed).length], ["手改过的", list.filter(e => e.hand).length], ["平均识别用时(秒)", ms.length ? +(ms.reduce((a, b) => a + b, 0) / ms.length / 1000).toFixed(1) : ""], ["听写方式", { cont: "连续听", ptt: "按一下说一句", dict: "键盘听写" }[mode]], ["诊断", $("diag").textContent]].forEach(r => ws4.addRow(r));
      ws4.getColumn(1).width = 18; ws4.getColumn(2).width = 90;
      const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name = `语音盘点_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "")}.xlsx`, file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return } catch (x) { if (x.name === "AbortError") return } }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    } catch (e) { alert("导出失败：" + e.message) }
  }
  if (speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", paintDiag);
  // iPhone 要先在点按时出一次声，后面才能自动播报
  let unlocked = false; document.addEventListener("touchend", () => { if (unlocked || !diag.tts) return; unlocked = true; try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u) } catch (e) { } }, { passive: true });
  setStatus(status); paintCtl(); paintList(); showCard(entries[0]); paintLib(); paintDiag();
})();
