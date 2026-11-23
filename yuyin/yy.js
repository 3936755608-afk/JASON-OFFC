/* 语音盘点测试页：三种听写方式（连续听 / 按一下说一句 / 键盘听写）+ 大字显示 + 耳机播报 + 改上一条。
   记录只存在这台手机（localStorage），可以导出 Excel 发回来，用来调识别。 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n0 = n => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  const n1 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
  const APP = !!window.VP_APP, KEY = APP ? "vp_entries" + (window.CLOUD_SUFFIX || "") : "yy_entries";   // 正式盘点的草稿和测试页的分开存
  let entries = LS.get(KEY, []), mode = LS.get("yy_mode", "cont"), status = LS.get("yy_status", "已入库"), undoStack = [], editId = null;
  let lib = VP.makeLib(window.BASE_CATALOG || []), libSrc = "基础型号库";
  const diag = { sr: !!(window.SpeechRecognition || window.webkitSpeechRecognition), standalone: !!(navigator.standalone || matchMedia("(display-mode: standalone)").matches), ua: navigator.userAgent, starts: 0, results: 0, errors: [], tts: "speechSynthesis" in window };
  function paintDiag() { $("diag").textContent = `语音识别：${diag.sr ? "有" : "没有（这个浏览器不支持）"}\n主屏幕 App 模式：${diag.standalone ? "是" : "否（在 Safari 里打开）"}\n朗读：${diag.tts ? "有" : "没有"}，中文声音 ${(speechSynthesis.getVoices ? speechSynthesis.getVoices() : []).filter(v => /zh/i.test(v.lang)).length} 个\n开始听 ${diag.starts} 次，识别到 ${diag.results} 句\n型号库：${libSrc}，${lib.size} 个型号\n最近错误：${diag.errors.slice(-6).join(" | ") || "无"}\n${diag.ua}` }

  // 型号库：登录后读 App 里的型号库（和录入页同一份）；读不到就用基础型号库
  (async () => { try { await Cloud.ready; const c = await Cloud.kv("pandian_kv").get("catalog"); if (Array.isArray(c) && c.length) { lib = VP.makeLib(c.concat(window.BASE_CATALOG || [])); libSrc = "App 型号库" } } catch (e) { diag.errors.push("读型号库：" + (e.code || e.message)) } paintLib(); paintDiag() })();
  function paintLib() { $("lib").textContent = `型号库 ${lib.size} 个型号（${libSrc}）` }

  /* ---------- 播报 ---------- */
  let speaking = false;
  /* 播报方式：完整 / 只报支数 / 提示音（有问题才说话）/ 不出声；声音可以选（优先“增强”“高音质”的） */
  let fb = LS.get("yy_fb", "full"), voiceName = LS.get("yy_voice", "");
  const zhVoices = () => (speechSynthesis.getVoices ? speechSynthesis.getVoices() : []).filter(v => /^zh|cmn/i.test(v.lang));
  const vScore = v => (/premium|高音质|优化/i.test(v.name) ? 30 : 0) + (/enhanced|增强/i.test(v.name) ? 20 : 0) + (/zh[-_]CN/i.test(v.lang) ? 5 : 0) + (v.localService ? 1 : 0);
  function pickVoice() { const vs = zhVoices(); return vs.find(v => v.name === voiceName) || vs.slice().sort((a, b) => vScore(b) - vScore(a))[0] || null }
  function paintVoices() { const vs = zhVoices().sort((a, b) => vScore(b) - vScore(a)), cur = pickVoice(); $("voice").innerHTML = vs.length ? vs.map(v => `<option value="${esc(v.name)}"${cur && v.name === cur.name ? " selected" : ""}>${esc(v.name)}（${esc(v.lang)}）${vScore(v) >= 20 ? " ★" : ""}</option>`).join("") : `<option>（这台手机没有中文声音）</option>`;
    for (const b of $("fbs").children) b.setAttribute("aria-pressed", String(b.dataset.fb === fb)) }
  // 提示音：成功“叮”一声
  let actx = null; function beep(ok, then) { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.type = "sine"; o.frequency.value = ok ? 1320 : 440; g.gain.setValueAtTime(0.0001, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.18); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.2) } catch (e) { } setTimeout(() => then && then(), 260) }
  function say(text, then, kind) {
    if (fb === "off" || !diag.tts || !text) { then && then(); return }
    if (fb === "beep" && kind === "ok") { beep(true, then); return }
    if (fb === "short" && kind === "ok") text = text.replace(/^.*?，(\d+支)，已记录$/, "$1");
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = "zh-CN"; u.rate = +$("rate").value; u.pitch = +$("pitch").value;
      const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang }
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
  function save() { entries.forEach(e => { if (e.need && !e.why && e.flags && e.flags.length) e.why = e.flags[0].replace(/，?请.*$/, "") }); LS.set(KEY, entries) }   // why = 当初为什么要人工确认，提交时写进备注
  function handle(alts) {
    alts = [].concat(alts).filter(Boolean); if (!alts.length) return; live(alts[0], true);
    // 几个候选里挑问题最少的那个
    let best = null; for (const a of alts) { const p = VP.parse(a); if (p.cmd) { best = { a, p }; break } const r = lib.resolve(p.rec); if (!best || (best.r && r.flags.length < best.r.flags.length)) best = { a, p, r } }
    const { a, p } = best; let speak = "", okSpeak = false;
    // 上一条有问题（例如“请说支重”），这句只说了支重/长度/支数、没说型号 → 当作补上一条
    if (!p.cmd && p.rec && !p.rec.m && entries[0] && entries[0].flags && entries[0].flags.length && ["L", "w", "q"].some(k => p.rec[k] != null)) { p.cmd = "fix"; p.p = {}; ["L", "w", "q"].forEach(k => { if (p.rec[k] != null) p.p[k] = p.rec[k] }) }
    if (p.cmd === "fix") { const e = entries[0]; if (!e) speak = "还没有记录"; else { undoStack.push({ k: "fix", id: e.id, before: JSON.parse(JSON.stringify(e)) }); const r = lib.resolve(Object.assign({ m: e.m, L: e.L, w: e.autoW && p.p.L != null ? null : e.w, q: e.q }, p.p)); Object.assign(e, pick(r), { fixed: (e.fixed || 0) + 1, fixRaw: (e.fixRaw ? e.fixRaw + "；" : "") + a, need: e.need || !!r.flags.length, ok: !r.flags.length }); save(); showCard(e); speak = "已改，" + sayRec(e).replace(/，?已记录$/, "") } }
    else if (p.cmd === "del") { const e = entries.shift(); if (e) { undoStack.push({ k: "del", e }); save(); speak = "已删除上一条" } else speak = "没有可以删的"; showCard(entries[0]) }
    else if (p.cmd === "undo") { const u = undoStack.pop(); if (!u) speak = "没有可以撤销的"; else { if (u.k === "add") entries = entries.filter(x => x.id !== u.id); else if (u.k === "del") entries.unshift(u.e); else if (u.k === "fix") { const i = entries.findIndex(x => x.id === u.id); if (i >= 0) entries[i] = u.before } save(); speak = "已撤销"; showCard(entries[0]) } }
    else if (p.cmd === "status") { setStatus(p.s); speak = "已切换" + p.s }
    else if (p.cmd === "pause") { stopRec(); speak = "已暂停" }
    else if (p.cmd === "end") { stopRec(); const n = pending().length; speak = n ? `还有${n}条要确认，确认后再结束` : `盘点结束，共${entries.length}条，正在导出`; if (!n) setTimeout(finish, 300); else markPending() }
    else if (p.cmd === "ok") { const e = entries[0]; if (e && e.need && !e.ok && !(e.m && e.L > 0 && e.w > 0 && e.q > 0)) speak = "上一条还没补全，不能确认"; else if (e && e.need && !e.ok) { e.ok = true; save(); showCard(e); speak = "已确认" } else speak = "上一条不用确认" }
    else { const r = best.r || lib.resolve(p.rec), e = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), raw: a, alts: alts.slice(0, 3), s: status }, pick(r)); e.ms = recT0 ? Date.now() - recT0 : null; entries.unshift(e); dupCheck(e); undoStack.push({ k: "add", id: e.id }); save(); showCard(e); speak = sayRec(e); okSpeak = !e.need }
    paintList(); if (mode === "cont" && want) { try { if (rec) { rec.onend = null; rec.abort() } } catch (x) { } } say(speak, afterSpeak, okSpeak ? "ok" : "");
  }
  // 有问题的记录 need=true：必须人工确认（点“确认”、点候选、改好，或说“确认”）才算数；没确认的不能导出成正式结果
  const pick = r => ({ m: r.m, L: r.L ?? null, w: r.w ?? null, q: r.q ?? null, kg: r.kg, flags: r.flags, cands: r.cands, wOpts: r.wOpts || null, autoW: !!r.autoW, need: !!(r.flags && r.flags.length), ok: false });
  const pending = () => entries.filter(e => e.need && !e.ok);
  function dupCheck(e) { const p = entries[1]; if (p && p.m === e.m && p.L === e.L && p.w === e.w && p.q === e.q && e.t - p.t < 120000) { e.flags = (e.flags || []).concat("和上一条完全一样，是不是说重复了？"); e.need = true } }

  /* ---------- 画面 ---------- */
  /* ---------- 大字卡片：型号 / 长度 / 支重 / 支数 四格，点哪格就改哪格（可以手写、键盘、或对着说这一项） ---------- */
  let slot = null, delArm = null;   // slot = {id, k}
  const SL = { m: "型号", L: "长度(米)", w: "支重", q: "支数" };
  function chipsFor(e, k, val) {
    if (k === "m") return lib.search(val || e.m || "", 12).map(m => `<button type="button" data-sv="${esc(m)}">${esc(m)}</button>`).join("");
    const sp = lib.specs(e.m);
    if (k === "L") return [...new Set(sp.map(x => x.L))].map(L => `<button type="button" data-sv="${L}">${L} 米</button>`).join("");
    if (k === "w") return [...new Set(sp.filter(x => e.L == null || x.L === e.L).map(x => x.w))].map(w => `<button type="button" data-sv="${w}">${w}</button>`).join("");
    return "";
  }
  function showCard(e) {
    if (!e) { $("cardBox").innerHTML = ""; return }
    const fl = e.flags && e.flags.length, on = k => slot && slot.id === e.id && slot.k === k ? " on" : "";
    $("cardBox").innerHTML = `<div class="card${e.need && !e.ok ? " flag" : ""}"><div class="m tile${on("m")}" data-slot="m" data-id="${e.id}">${esc(e.m || "？")}</div>
      <div class="tile${on("L")}" data-slot="L" data-id="${e.id}"><div class="k">长度(米)</div><div class="v L">${e.L ?? "？"}</div></div><div class="tile${on("w")}" data-slot="w" data-id="${e.id}"><div class="k">支重${e.autoW ? "（库里带出）" : ""}</div><div class="v W">${e.w ?? "？"}</div></div>
      <div class="tile${on("q")}" data-slot="q" data-id="${e.id}"><div class="k">支数</div><div class="v Q">${e.q != null ? n0(e.q) : "？"}</div></div><div><div class="k">理论重量</div><div class="v">${e.kg ? n1(e.kg) + " kg" : "—"}</div></div>
      ${slot && slot.id === e.id ? `<div class="slot"><div class="k">改${SL[slot.k]}：手写、打字，或点🎤只说这一项</div>
        <input id="slotIn" value="${esc(slot.v ?? (e[slot.k] ?? ""))}" inputmode="${slot.k === "m" ? "text" : slot.k === "q" ? "numeric" : "decimal"}" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done">
        <div class="chips" id="slotChips">${chipsFor(e, slot.k, slot.v)}</div>
        <div class="acts2"><button type="button" class="go" data-slot-save="1">✓ 好了</button><button type="button" data-slot-mic="1">🎤 说这一项</button><button type="button" data-slot-cancel="1">取消</button></div></div>` : ""}
      ${fl ? `<div class="flags">⚠ ${e.flags.map(esc).join("；")}</div>` : ""}
      ${fl && e.cands && e.cands.length > 1 ? `<div class="chips">${e.cands.map(c => `<button type="button" data-cm="${esc(c)}" data-id="${e.id}">${esc(c)}</button>`).join("")}</div>` : ""}
      ${e.wOpts && !slot ? `<div class="chips">${e.wOpts.map(w => `<button type="button" data-cw="${w}" data-id="${e.id}">支重 ${w}</button>`).join("")}</div>` : ""}
      <div class="acts2">${e.need && !e.ok ? `<button type="button" class="go" data-ok="${e.id}" style="background:#c00000;border-color:#c00000">✓ 核对过了，确认</button>` : e.need ? `<span class="flags" style="color:var(--ok)">✓ 已人工确认</span>` : ""}<button type="button" class="del" data-del="${e.id}">${delArm === e.id ? "再点一次删除" : "🗑 删除这条"}</button></div>
      <div class="raw">听到：“${esc(e.raw)}”${e.fixRaw ? "　改：" + esc(e.fixRaw) : ""} · ${esc(e.s)} · 点上面任何一格都能改</div></div>`;
    if (slot && slot.id === e.id) setTimeout(() => { const i = $("slotIn"); if (i && document.activeElement !== i) { i.focus(); i.select() } }, 30);
  }
  // 改一项：其他三项不动，重新对型号库
  function setField(e, k, v) {
    const cur = { m: e.m, L: e.L, w: e.autoW && (k === "m" || k === "L") ? null : e.w, q: e.q }; cur[k] = v;
    // 换了型号或长度：原来的长度/支重在新型号里没有，就清掉让库里重新带出（或提示要说）
    if (k === "m" || k === "L") { const sp = lib.specs(cur.m); if (sp.length) { if (k === "m" && cur.L != null && !sp.some(x => x.L === cur.L)) cur.L = null; if (cur.w != null && !sp.some(x => x.w === cur.w && (cur.L == null || x.L === cur.L))) cur.w = null } }
    const r = lib.resolve(cur); Object.assign(e, pick(r), { hand: true, need: e.need || !!r.flags.length, ok: !r.flags.length });
    save();
  }
  const fieldVal = (k, txt) => { txt = String(txt || "").trim(); if (!txt) return null; if (k === "m") { const p = VP.parse(txt); const m = (p.rec && p.rec.m) || VP.clean(txt).replace(/\s+/g, "").toUpperCase(); const mt = lib.matchModel(m); return mt.best ? mt.best.m : m } const n = (VP.numify(VP.clean(txt)).match(/\d+(?:\.\d+)?/) || [])[0]; return n == null ? null : k === "q" ? parseInt(n, 10) : parseFloat(n) };
  function paintList() {
    const fl = pending().length, fx = entries.filter(e => e.fixed || e.hand).length, kg = entries.reduce((s, e) => s + (e.kg || 0), 0), qs = entries.reduce((s, e) => s + (e.q || 0), 0);
    $("stat").innerHTML = `<span>已盘 <b>${entries.length}</b> 笔<span class="sub">（${APP ? "草稿，还没提交" : "测试目标 20"}）</span></span><span>累计 <b>${n0(qs)}</b> 支</span><span><b>${n1(kg)}</b> kg</span><span>待确认 <b class="${fl ? "bad" : "ok"}">${fl}</b></span><span class="sub">改过 ${fx}</span>`;
    $("list").innerHTML = entries.length ? `<table><thead><tr><th>#</th><th>型号</th><th>长度</th><th>支重</th><th>支数</th><th>状态</th><th></th><th>听到的话</th></tr></thead><tbody>${entries.map((e, i) => `<tr class="click${e.need && !e.ok ? " flag" : ""}" data-ed="${e.id}"><td>${entries.length - i}</td><td class="tl"><b>${esc(e.m)}</b></td><td>${e.L ?? ""}</td><td>${e.w ?? ""}</td><td><b>${e.q != null ? n0(e.q) : ""}</b></td><td>${esc(e.s)}${e.need ? (e.ok ? " ✓" : " ⚠") : ""}</td><td><button type="button" class="x" data-del="${e.id}">${delArm === e.id ? "确认删" : "删"}</button></td><td class="tl" style="color:var(--muted)">${esc(e.raw)}</td></tr>`).join("")}</tbody></table>` : `<div class="sub" style="padding:14px">还没有记录。</div>`;
    const x = entries.find(v => v.id === editId);
    $("edBox").innerHTML = x ? `<div class="ed"><input id="e_m" value="${esc(x.m)}" style="text-transform:uppercase"><input id="e_L" inputmode="decimal" value="${x.L ?? ""}"><input id="e_w" inputmode="decimal" value="${x.w ?? ""}"><input id="e_q" inputmode="numeric" value="${x.q ?? ""}"></div><div class="row"><button type="button" class="btn" data-esave="${x.id}" style="background:var(--accent);color:var(--accent-ink)">保存</button><button type="button" class="btn" data-ecancel="1">取消</button><button type="button" class="btn danger" data-edel="${x.id}">删除这条</button></div>` : "";
  }
  function paintCtl() {
    for (const b of $("modes").children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    if (mode === "hand") $("ctl").innerHTML = `<div class="hf"><label class="full">型号<input id="h_m" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next" placeholder="写或打型号"></label><div class="chips full" id="h_mc"></div>
      <label>长度(米)<input id="h_L" class="L" inputmode="decimal" enterkeyhint="next"></label><label>支重<input id="h_w" class="W" inputmode="decimal" enterkeyhint="next"></label><div class="chips full" id="h_sc"></div>
      <label class="full">支数<input id="h_q" inputmode="numeric" enterkeyhint="done"></label>
      <div class="acts2"><button type="button" class="go" id="h_ok">✓ 记录这条</button><button type="button" id="h_clr">清空</button></div></div>
      <div class="sub">想用手写：iPhone 设置 → 通用 → 键盘 → 键盘 → 添加新键盘 → 简体中文 → 手写，打字时点 🌐 切到手写。型号写几个字就会出候选，点一下；长度、支重点候选。</div>`;
    else if (mode === "dict") $("ctl").innerHTML = `<input class="dict" id="dict" placeholder="点这里，再点键盘上的 🎤 说一句" autocomplete="off" enterkeyhint="done"><div class="sub">说完会自动记录（停 1.5 秒），也可以按“完成”。iPhone 键盘听写最稳，没网也能用。</div>`;
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
    const b = e.target.closest("[data-cm],[data-cw],[data-ed],[data-esave],[data-ecancel],[data-edel],[data-ok],[data-slot],[data-sv],[data-slot-save],[data-slot-mic],[data-slot-cancel],[data-del],[data-hm],[data-hs]"); if (!b) return; const ds = b.dataset;
    const find = id => entries.find(x => x.id === id);
    // 点一格改一项
    if (ds.slot) { const x = find(ds.id); if (!x) return; if (want) { resumeAfter = true; stopRec() } slot = { id: x.id, k: ds.slot }; showCard(x); return }
    if (ds.sv !== undefined) { const i = $("slotIn"); if (i) { i.value = ds.sv; slotSave() } return }
    if (ds.slotSave) { slotSave(); return }
    if (ds.slotCancel) { const x = slot && find(slot.id); slot = null; showCard(x); resume(); return }
    if (ds.slotMic) { slotMic(); return }
    if (ds.del) { if (delArm !== ds.del) { delArm = ds.del; showCard(find(ds.del) || entries[0]); paintList(); return } const x = find(ds.del); delArm = null; if (x) { entries = entries.filter(v => v.id !== x.id); undoStack.push({ k: "del", e: x }); save(); say("已删除") } slot = null; paintList(); showCard(entries[0]); return }
    // 手写：点型号候选 / 点规格候选
    if (ds.hm) { $("h_m").value = ds.hm; hSpecs(); const sp = lib.specs(ds.hm); if (sp.length === 1) { $("h_L").value = sp[0].L; $("h_w").value = sp[0].w; $("h_q").focus() } else $("h_L").focus(); return }
    if (ds.hs) { const [L, w] = ds.hs.split("|"); $("h_L").value = L; $("h_w").value = w; $("h_q").focus(); return }
    if (ds.ok) { const x = find(ds.ok); if (!x) return; if (!x.m || !(x.L > 0) || !(x.w > 0) || !(x.q > 0)) { say("先把这条补全"); alert("这条型号、长度、支重、支数还没全，点下面列表里这一行补全后再确认。"); editId = x.id; paintList(); return } x.ok = true; save(); showCard(x); paintList(); const nx = pending()[0]; if (nx) showCard(nx); return }
    if (ds.cm) { const x = find(ds.id); if (!x) return; const r = lib.resolve({ m: ds.cm, L: x.L, w: x.autoW ? null : x.w, q: x.q }); Object.assign(x, pick(r), { hand: true, need: true, ok: !r.flags.length }); save(); showCard(x); paintList(); say(`${x.m}，${x.q || ""}支`) }
    else if (ds.cw) { const x = find(ds.id); if (!x) return; const r = lib.resolve({ m: x.m, L: x.L, w: +ds.cw, q: x.q }); Object.assign(x, pick(r), { hand: true, need: true, ok: !r.flags.length }); save(); showCard(x); paintList() }
    else if (ds.ed) { editId = ds.ed; paintList(); showCard(find(ds.ed)) }
    else if (ds.ecancel) { editId = null; paintList() }
    else if (ds.edel) { entries = entries.filter(x => x.id !== ds.edel); editId = null; save(); paintList(); showCard(entries[0]) }
    else if (ds.esave) { const x = find(ds.esave); if (!x) return; const r = lib.resolve({ m: $("e_m").value.trim().toUpperCase(), L: parseFloat($("e_L").value) || null, w: parseFloat($("e_w").value) || null, q: parseInt($("e_q").value, 10) || null }); Object.assign(x, pick(r), { hand: true, need: x.need || !!r.flags.length, ok: true }); /* 人手改过 = 人工确认 */ editId = null; save(); paintList(); showCard(x) }
  });
  let resumeAfter = false; function resume() { if (resumeAfter && mode === "cont") { resumeAfter = false; want = true; startRec() } resumeAfter = false }
  function slotSave() { const x = slot && entries.find(v => v.id === slot.id); if (!x) { slot = null; return } const v = fieldVal(slot.k, $("slotIn").value); if (v == null || (slot.k !== "m" && !(v > 0))) { say("没看懂，请重写"); return } setField(x, slot.k, v); const k = slot.k; slot = null; showCard(x); paintList(); say(`${SL[k].replace("(米)", "")}改成${v}${k === "q" ? "支" : ""}`, resume) }
  function slotMic() { if (!SR) { alert("这个浏览器没有语音识别，请手写或打字。"); return } try { if (rec) { rec.onend = null; rec.abort() } } catch (e) { } const r1 = new SR(); r1.lang = "zh-CN"; r1.interimResults = false; r1.maxAlternatives = 3;
    r1.onresult = ev => { const alts = [...ev.results[0]].map(a => a.transcript); let v = null; for (const a of alts) { v = fieldVal(slot.k, a); if (v != null) break } const i = $("slotIn"); if (i && v != null) { i.value = v; slotSave() } else say("没听清，请再说一遍") };
    r1.onerror = ev => { diag.errors.push("单项：" + ev.error) }; try { r1.start(); live("请说" + SL[slot.k] + "…") } catch (e) { } }
  document.addEventListener("input", e => { if (e.target.id === "slotIn" && slot) { slot.v = e.target.value; const x = entries.find(v => v.id === slot.id); if (x && $("slotChips")) $("slotChips").innerHTML = chipsFor(x, slot.k, slot.k === "m" ? e.target.value : "") } });
  document.addEventListener("keydown", e => { if (e.target.id === "slotIn" && e.key === "Enter") { e.preventDefault(); slotSave() } });
  // ---- 手写录入 ----
  function hSpecs() { const m = fieldVal("m", $("h_m").value), sp = m ? lib.specs(m) : []; $("h_sc").innerHTML = sp.map(x => `<button type="button" data-hs="${x.L}|${x.w}">${x.L} 米 · ${x.w}</button>`).join("") }
  function hSave() { const raw = ["h_m", "h_L", "h_w", "h_q"].map(id => $(id).value.trim()); if (!raw[0] && !raw[3]) return;
    const r = lib.resolve({ m: fieldVal("m", raw[0]) || "", L: fieldVal("L", raw[1]), w: fieldVal("w", raw[2]), q: fieldVal("q", raw[3]) });
    const e = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), raw: "手写：" + raw.join(" / "), s: status, hand: true }, pick(r));
    entries.unshift(e); dupCheck(e); undoStack.push({ k: "add", id: e.id }); save(); showCard(e); paintList(); say(sayRec(e), null, e.need ? "" : "ok");
    ["h_m", "h_L", "h_w", "h_q"].forEach(id => $(id).value = ""); $("h_mc").innerHTML = ""; $("h_sc").innerHTML = ""; $("h_m").focus() }
  $("ctl").addEventListener("input", e => { if (e.target.id === "h_m") { const v = e.target.value; $("h_mc").innerHTML = lib.search(v, 12).map(m => `<button type="button" data-hm="${esc(m)}">${esc(m)}</button>`).join(""); hSpecs() } });
  $("ctl").addEventListener("keydown", e => { const order = ["h_m", "h_L", "h_w", "h_q"], i = order.indexOf(e.target.id); if (i < 0 || e.key !== "Enter") return; e.preventDefault(); if (i === 0) { const c = $("h_mc").querySelector("[data-hm]"); if (c && !lib.specs(fieldVal("m", e.target.value)).length) { c.click(); return } hSpecs() } if (i < 3) $(order[i + 1]).focus(); else hSave() });
  $("ctl").addEventListener("click", e => { if (e.target.id === "h_ok") hSave(); if (e.target.id === "h_clr") { ["h_m", "h_L", "h_w", "h_q"].forEach(id => $(id).value = ""); $("h_mc").innerHTML = ""; $("h_sc").innerHTML = ""; $("h_m").focus() } });
  $("clr").addEventListener("click", () => { if ($("clr").dataset.arm !== "1") { $("clr").dataset.arm = "1"; $("clr").textContent = "再点一次确认清空"; return } entries = []; undoStack = []; save(); $("clr").dataset.arm = ""; $("clr").textContent = "清空测试记录"; paintList(); showCard(null) });
  function markPending() { const p = pending(); if (p.length) { editId = null; showCard(p[p.length - 1]); paintList(); window.scrollTo(0, 0) } }
  $("exp").addEventListener("click", () => finish());
  // 盘点完成：有待确认的先确认；然后导出 Excel（明细按说的顺序 + 按规格汇总 + 按状态汇总 + 测试信息）
  async function finish(after) {
    const pend = after ? [] : pending(); if (pend.length) { say(`还有${pend.length}条要确认`); markPending(); alert(`还有 ${pend.length} 条标黄的记录没确认。请逐条核对后点“确认这条”，再导出。`); return }
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
      const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name = `语音盘点_${APP ? day.replace(/-/g, "") : new Date().toLocaleDateString("zh-CN").replace(/\//g, "")}.xlsx`, file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return } catch (x) { if (x.name === "AbortError") return } }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    } catch (e) { alert("导出失败：" + e.message) }
  }
  if (speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", paintDiag);
  // iPhone 要先在点按时出一次声，后面才能自动播报
  let unlocked = false; document.addEventListener("touchend", () => { if (unlocked || !diag.tts) return; unlocked = true; try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u) } catch (e) { } }, { passive: true });
  $("fbs").addEventListener("click", e => { const b = e.target.closest("[data-fb]"); if (!b) return; fb = b.dataset.fb; LS.set("yy_fb", fb); paintVoices(); say(fb === "beep" ? "有问题时才说话" : fb === "short" ? "120支" : "8065，120支，已记录", null, fb === "beep" ? "" : "") ; if (fb === "beep") beep(true) });
  $("voice").addEventListener("change", e => { voiceName = e.target.value; LS.set("yy_voice", voiceName); say("8065，120支，已记录") });
  $("tryv").addEventListener("click", () => say("8065，六米，120支，已记录"));
  ["rate", "pitch"].forEach(id => { $(id).value = LS.get("yy_" + id, $(id).value); $(id).addEventListener("change", () => { LS.set("yy_" + id, $(id).value); say("120支，已记录") }) });
  if (speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", paintVoices); paintVoices(); setTimeout(paintVoices, 800);
  /* ---------- 正式语音盘点：草稿 → 全部核对 → 输一次授权码提交到当天清单 ---------- */
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };
  let day = window.VP_DAY || today();
  if (APP) {
    document.title = "语音盘点"; $("ttl").textContent = "🎤 语音盘点" + (window.CLOUD_SUFFIX ? "（测试版）" : "");
    $("ttlSub").innerHTML = `<a href="${esc(window.VP_BACK)}" class="btn" style="text-decoration:none;display:inline-flex;align-items:center">← 回 PETRJASON</a> <label class="sub">盘点日期 <input type="date" id="vday" value="${day}" style="min-height:40px;border:1px solid var(--line);border-radius:8px;padding:0 8px"></label>`;
    $("vday").addEventListener("change", e => { day = e.target.value || today(); paintSub() });
    $("sub").hidden = false; $("exp").textContent = "导出 Excel"; $("clr").textContent = "清空草稿";
  }
  function paintSub() { if (!APP) return; const n = entries.length; $("sub").textContent = n ? `盘点完成 · 提交 ${n} 笔到 ${+day.slice(5, 7)}/${+day.slice(8)} 的清单` : "盘点完成 · 提交到清单" }
  const _pl = paintList; paintList = function () { _pl(); paintSub() };
  $("sub").addEventListener("click", submit);
  async function submit() {
    const pend = pending(); if (pend.length) { say(`还有${pend.length}条要确认`); markPending(); alert(`还有 ${pend.length} 条标黄的记录没确认。全部核对确认后才能提交。`); return }
    const bad = entries.filter(e => !e.m || !(e.L > 0) || !(e.w > 0) || !(e.q > 0)); if (bad.length) { showCard(bad[0]); alert(`有 ${bad.length} 条型号、长度、支重、支数没填全，请补全。`); return }
    if (!entries.length) { alert("还没有记录。"); return }
    const list = entries.slice().reverse(), t0 = Date.now(), R = Cloud.store("pandian_records"), KV = Cloud.kv("pandian_kv");
    const byS = {}; list.forEach(e => { byS[e.s] = (byS[e.s] || 0) + 1 });
    const recs = list.map((e, i) => ({ id: t0.toString(36) + i.toString(36).padStart(3, "0") + Math.random().toString(36).slice(2, 5), d: day, m: e.m, L: +e.L, w: +e.w, q: +e.q, s: e.s, n: e.need ? "语音录入，已人工核对" + (e.why ? "（" + e.why + "）" : "") : "", p: "语音", t: t0 + i }));
    const $b = $("sub"); $b.disabled = true; $b.textContent = "正在提交…";
    try {
      await Cloud.boss.confirm([`语音盘点提交到 ${day}：${recs.length} 笔，${n0(recs.reduce((s, r) => s + r.q, 0))} 支，${n1(list.reduce((s, e) => s + (e.kg || 0), 0))} kg`, Object.entries(byS).map(([k, v]) => k + " " + v + " 笔").join("，"), "提交后在 PETRJASON 的“今天的记录”里能看到，可以照常修改"]);
      Cloud.boss.begin();
      try {
        // 型号库里没有的规格（已人工确认的），顺便加进型号库，下次录入下拉也有
        let cat = []; try { cat = (await KV.get("catalog")) || [] } catch (e) { }
        const have = new Set(cat.map(x => x.m + "|" + x.L + "|" + x.w)), add = []; recs.forEach(r => { const k = r.m + "|" + r.L + "|" + r.w; if (!have.has(k)) { have.add(k); add.push({ m: r.m, L: r.L, w: r.w }) } });
        if (add.length && cat.length) await KV.set("catalog", cat.concat(add));
        await R.putMany(recs);
      } finally { Cloud.boss.end() }
      const LK = "vp_last" + (window.CLOUD_SUFFIX || ""); LS.set(LK, entries); entries = []; undoStack = []; save(); paintList(); showCard(null);
      say(`已提交${recs.length}条`); $b.disabled = false; paintSub();
      if (confirm(`已提交 ${recs.length} 笔到 ${day} 的清单。\n\n要不要导出这次的 Excel？（确定 = 导出，取消 = 不导出）`)) { entries = LS.get(LK, []); try { await finish(true) } finally { entries = [] } }
      location.href = window.VP_BACK;
    } catch (e) { $b.disabled = false; paintSub(); if (e && (e.cancelled || e.code === "cancelled")) return; alert("没有提交成功，请检查网络后再试。草稿还在。"); console.error(e) }
  }
  setStatus(status); paintCtl(); paintList(); showCard(entries[0]); paintLib(); paintDiag();
})();
