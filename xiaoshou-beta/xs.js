/* PETRJASON 销售：首页 / 客户 / 报价 / 订单 / 账款 / 更多。
   数据只放在 xs_* 集合（xs_cust 客户、xs_follow 跟进、xs_quote 报价单、xs_order 订单、xs_ship 发货单、xs_pay 收款），
   不读也不写车间的数据。所有改动都经过 BOSS 授权（lib/cloud.js），操作记录在 xs_log，授权码在 xs_kv。
   单价 = 元/吨；金额 = 理论支重 ÷ 6 × 长度 × 支数 ÷ 1000 × 单价。应收按发货单算（提货后才算）。 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n0 = n => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  const n1 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n3 = n => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const yuan = n => "¥" + Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const norm = s => String(s || "").toUpperCase().replace(/[\s\-－_]/g, "");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") };
  const md = d => d ? +d.slice(5, 7) + "/" + +d.slice(8, 10) : "";
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const kgOf = l => (+l.w || 0) / 6 * (+l.L || 0) * (+l.q || 0);
  const isPc = l => l.unit === "pc";
  const pcKg = l => (+l.w || 0) / 6 * (+l.L || 0);   // 每支理论重量
  const amtOf = l => isPc(l) ? r2((+l.price || 0) * (+l.q || 0)) : r2(kgOf(l) / 1000 * (+l.price || 0));
  const unitTxt = l => isPc(l) ? "元/支" : "元/吨";
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const days = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
  const isCancel = e => !!(e && (e.cancelled || e.code === "cancelled"));
  const LS = { get: (k, d) => { try { return localStorage.getItem(k) || d } catch (e) { return d } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch (e) { } } };
  const BETA = !!window.CLOUD_SUFFIX;
  if (BETA) { $("title").innerHTML = 'PETRJASON 销售<small>测试版</small>'; document.title = "PETRJASON 销售（测试版）" }

  /* ---------- 数据 ---------- */
  const ST = { cust: Cloud.store("xs_cust"), follow: Cloud.store("xs_follow"), quote: Cloud.store("xs_quote"), order: Cloud.store("xs_order"), ship: Cloud.store("xs_ship"), pay: Cloud.store("xs_pay"), ingot: Cloud.store("xs_ingot"), prod: Cloud.store("xs_prod") };
  const D = { cust: [], follow: [], quote: [], order: [], ship: [], pay: [], ingot: [], prod: [] };
  const KV = Cloud.kv("xs_kv"), P = { billet: 0, colors: [] };
  async function loadAll() {
    try { const ks = Object.keys(ST); const vs = await Promise.all(ks.map(k => ST[k].all())); ks.forEach((k, i) => D[k] = vs[i]) }
    catch (e) { console.error(e); $("banner").hidden = false; $("banner").textContent = "读取云端数据失败，请检查网络后刷新页面。" }
    try { const [b, c] = await Promise.all([KV.get("billet"), KV.get("colors")]); P.billet = +b || 0; P.colors = Array.isArray(c) ? c : [] } catch (e) { console.error(e) }
    D.cust.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }
  /* ---------- 内部单价：单价(元/吨) = 开单当天的铝锭价 + 胚料加工费 + 表面颜色加工费；胚料费、颜色费可以按客户单独定，没定的用标准价 ---------- */
  const RAW = { id: "raw", name: "胚料（不做颜色）", fee: 0 };
  const colors = () => [RAW, ...P.colors];
  const colorName = id => (colors().find(c => c.id === (id || "raw")) || {}).name || "(已删除颜色)";
  const has = v => v !== undefined && v !== null && v !== "";
  function ingotOn(d) { let best = null; for (const x of D.ingot) if (x.d <= d && (!best || x.d > best.d)) best = x; return best }
  function custBillet(c) { return c && has(c.billet) ? +c.billet : +P.billet || 0 }
  function custColorFee(c, color) { if (!color || color === "raw") return 0; const ov = c && c.cfee && c.cfee[color]; if (has(ov)) return +ov; const k = P.colors.find(x => x.id === color); return k ? +k.fee || 0 : 0 }
  function priceParts(cid, color, d) { const ig = ingotOn(d); if (!ig) return null; const c = custOf(cid), bil = custBillet(c), cf = custColorFee(c, color); return { ing: +ig.price, ingD: ig.d, bil, cf, unit: +ig.price + bil + cf } }
  /* 多步操作：先确认一次（列出要做的事、输授权码），之后这几步合成一条操作记录 */
  async function boss(items, fn) { await Cloud.boss.confirm(items); Cloud.boss.begin(); try { return await fn() } finally { Cloud.boss.end() } }
  async function act(items, fn, okText) {
    try { await boss(items, fn); await loadAll(); render(); if (okText) msg(okText, "ok"); return true }
    catch (e) { await loadAll(); render(); if (isCancel(e)) msg("已取消，没有修改。"); else { console.error(e); msg("没有保存成功，请检查网络后再试。", "err") } return false }
  }

  const custOf = id => D.cust.find(c => c.id === id);
  const custName = id => (custOf(id) || {}).name || "(已删除客户)";
  const linesQ = ls => sum(ls || [], l => +l.q);
  const linesKg = ls => sum(ls || [], kgOf);
  const linesAmt = ls => r2(sum(ls || [], amtOf));
  function nextNo(pre, list, d) { const base = pre + d.replace(/-/g, "").slice(2) + "-"; let n = list.filter(x => x.d === d).length + 1, no; do { no = base + String(n).padStart(2, "0"); n++ } while (list.some(x => x.no === no)); return no }

  // 订单：每一行订了多少、发了多少
  function shippedBy(orderId) { const m = {}; D.ship.filter(s => s.order === orderId).forEach(s => (s.lines || []).forEach(l => { m[l.lid] = (m[l.lid] || 0) + (+l.q || 0) })); return m }
  function orderState(o) {
    const sh = shippedBy(o.id), tot = linesQ(o.lines), done = sum(o.lines || [], l => Math.min(+l.q || 0, sh[l.lid] || 0));
    if (tot > 0 && done >= tot) return ["已发完", "done"]; if (done > 0) return ["部分发货", "part"]; return ["待发货", "wait"];
  }
  // 账款：应收 = 发货金额，已收 = 收款，欠款 = 差；账龄 = 最早没收齐的发货单到今天几天（先发的先抵）
  function account(cid) {
    const sh = D.ship.filter(s => s.cust === cid).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t || 0) - (b.t || 0));
    const due = r2(sum(sh, s => linesAmt(s.lines))), paid = r2(sum(D.pay.filter(p => p.cust === cid), p => +p.amt)), owe = r2(due - paid);
    let left = paid, oldest = null; for (const s of sh) { const a = linesAmt(s.lines); if (left >= a - 0.005) { left -= a; continue } oldest = s.d; break }
    return { due, paid, owe, age: owe > 0.005 && oldest ? days(oldest, today()) : 0, last: sh.length ? sh[sh.length - 1].d : "" };
  }
  // 跟进：客户的“下次跟进”= 最新一条跟进记录写的下次日期
  function lastFollow(cid) { return D.follow.filter(f => f.cust === cid).sort((a, b) => (b.t || 0) - (a.t || 0))[0] || null }

  // 型号库：基础型号库 + 用过的规格；上次单价：同一客户同规格 → 同一客户同型号 → 任何客户同规格
  function catalog() {
    const m = new Map(); (D.prod.length ? D.prod : (window.BASE_CATALOG || [])).forEach(x => m.set(x.m + "|" + x.L + "|" + x.w, { m: x.m, L: +x.L, w: +x.w }));
    [...D.quote, ...D.order].forEach(d => (d.lines || []).forEach(l => { if (l.m && l.L && l.w) m.set(l.m + "|" + l.L + "|" + l.w, { m: l.m, L: +l.L, w: +l.w }) }));
    return [...m.values()];
  }
  function lastPrice(cid, l) {
    const docs = [...D.order, ...D.quote].filter(d => d.d).sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : (b.t || 0) - (a.t || 0)));
    const find = f => { for (const d of docs) { const x = (d.lines || []).find(y => y.price > 0 && f(d, y)); if (x) return +x.price } return 0 };
    const same = y => norm(y.m) === norm(l.m) && +y.L === +l.L && +y.w === +l.w;
    const u0 = l.unit || "t", f0 = find; const find2 = f => f0((d, y) => (y.unit || "t") === u0 && f(d, y));
    return (cid && find2((d, y) => d.cust === cid && same(y))) || (cid && u0 === "t" && find2((d, y) => d.cust === cid && norm(y.m) === norm(l.m))) || find2((d, y) => same(y)) || 0;
  }

  /* ---------- 外框 ---------- */
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    cust: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
    quote: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
    order: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    prod: '<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7"/><path d="M12 11v10"/>',
    price: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
    acct: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
  };
  const TABS = [["home", "首页"], ["cust", "客户"], ["quote", "报价"], ["order", "订单"], ["prod", "产品"], ["price", "价格"], ["acct", "账款"], ["more", "更多"]];
  $("bar").innerHTML = `<div class="in">${TABS.map(([k, t]) => `<button type="button" data-tab="${k}"><svg viewBox="0 0 24 24">${ICON[k]}</svg>${t}</button>`).join("")}</div>`;
  let tab = LS.get("xs_tab", "home"), sel = null, ed = null, armDel = null, logList = null, q = "", qf = "all", shipEd = null, payEd = null, stdEd = null, pcEd = null, pView = "fee", igEd = null;
  function setTab(t, s) { if (t !== "search" && $("gq") && $("gq").value) { $("gq").value = ""; gq = "" } tab = t; sel = s || null; ed = null; shipEd = null; payEd = null; armDel = null; stdEd = null; pcEd = t === "price" && s ? s : null; LS.set("xs_tab", t); for (const b of $("bar").querySelectorAll("button")) b.setAttribute("aria-current", b.dataset.tab === t ? "page" : "false"); render(); window.scrollTo(0, 0) }
  $("bar").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) { q = ""; qf = "all"; setTab(b.dataset.tab) } });
  let msgT = null;
  function msg(t, kind) { const m = $("msg"); if (!m) return; m.textContent = t || ""; m.className = "msg" + (kind ? " " + kind : ""); clearTimeout(msgT); if (kind === "ok") msgT = setTimeout(() => { if ($("msg")) $("msg").textContent = "" }, 6000) }

  const chip = (t, c) => `<span class="chip ${c}">${esc(t)}</span>`;
  const card = (l, b, s, cls) => `<div class="card ${cls || ""}"><div class="l">${l}</div><div class="b">${b}</div><div class="s">${s || "&nbsp;"}</div></div>`;

  /* ---------- 首页 ---------- */
  function viewHome() {
    const t = today(), mon = t.slice(0, 7);
    const due = D.cust.map(c => ({ c, f: lastFollow(c.id) })).filter(x => x.f && x.f.next && x.f.next <= t).sort((a, b) => a.f.next < b.f.next ? -1 : 1);
    const open = D.order.filter(o => orderState(o)[1] !== "done").sort((a, b) => a.d < b.d ? -1 : 1);
    const mShip = D.ship.filter(s => (s.d || "").startsWith(mon)), mOrd = D.order.filter(o => (o.d || "").startsWith(mon));
    const accts = D.cust.map(c => account(c.id)), owe = r2(sum(accts, a => Math.max(0, a.owe)));
    return `<div class="msg" id="msg"></div>
    <div class="cards">${card("今天要跟进", due.length + " 个客户", "", due.length ? "warn" : "")}${card("没发完的订单", open.length + " 张", n3(sum(open, o => linesKg(o.lines) - sum(D.ship.filter(s => s.order === o.id), s => linesKg(s.lines))) / 1000) + " 吨没发")}
      ${card("本月发货", n3(sum(mShip, s => linesKg(s.lines)) / 1000) + " 吨", yuan(sum(mShip, s => linesAmt(s.lines))) + " · 接单 " + mOrd.length + " 张")}${card("欠款合计", yuan(owe), accts.filter(a => a.owe > 0.005).length + " 个客户欠款")}</div>
    <div class="two">
      <section class="panel"><h2>今天要跟进</h2>${due.length ? `<div class="list">${due.map(x => `<div class="li" data-go="cust" data-id="${x.c.id}"><div><div class="n">${esc(x.c.name)}</div><div class="sub">${esc(x.f.text || "")}</div></div><div class="r">${chip(x.f.next < t ? "过期 " + md(x.f.next) : "今天", x.f.next < t ? "wait" : "part")}</div></div>`).join("")}</div>` : `<div class="empty">今天没有要跟进的客户。<br>在客户页记跟进时填“下次跟进”日期，到日子会出现在这里。</div>`}</section>
      <section class="panel"><h2>没发完的订单</h2>${open.length ? `<div class="list">${open.map(o => { const s = orderState(o); return `<div class="li" data-go="order" data-id="${o.id}"><div><div class="n">${esc(custName(o.cust))} <span class="sub d">${esc(o.no)}</span></div><div class="sub">${md(o.d)} 下单 · ${n0(linesQ(o.lines))} 支 · ${n3(linesKg(o.lines) / 1000)} 吨</div></div><div class="r">${chip(s[0], s[1])}</div></div>` }).join("")}</div>` : `<div class="empty">订单都发完了。</div>`}</section>
    </div>`;
  }

  /* ---------- 客户 ---------- */
  function viewCustList() {
    const k = norm(q), t = today();
    const rows = D.cust.filter(c => !k || norm(c.name + c.contact + c.phone).includes(k)).map(c => ({ c, a: account(c.id), f: lastFollow(c.id) }));
    return `<div class="msg" id="msg"></div><section class="panel"><h2><span>客户 <span class="sub">${D.cust.length} 个</span></span><button type="button" class="btn primary" data-new-cust="1">＋ 新客户</button></h2>
      <div class="tools"><input class="q" id="q" placeholder="搜客户名、联系人、电话" value="${esc(q)}" autocomplete="off"></div>
      ${rows.length ? `<div class="tw"><table class="g"><thead><tr><th>客户</th><th>联系人</th><th>电话</th><th>欠款</th><th>最近发货</th><th>下次跟进</th></tr></thead><tbody>${rows.map(({ c, a, f }) => `<tr class="click" data-go="cust" data-id="${c.id}"><td class="tl B">${esc(c.name)}</td><td class="tl">${esc(c.contact || "")}</td><td>${esc(c.phone || "")}</td><td class="M">${a.owe > 0.005 ? yuan(a.owe) : ""}</td><td>${md(a.last)}</td><td class="ct">${f && f.next ? chip(md(f.next), f.next <= t ? "wait" : "gray") : ""}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty">${D.cust.length ? "没有找到。" : "还没有客户。点右上角“＋ 新客户”。"}</div>`}</section>`;
  }
  function custForm(c) {
    const f = (k, l, v, ph) => `<div class="field"><label for="cf_${k}">${l}</label><input id="cf_${k}" value="${esc(v || "")}" placeholder="${ph || ""}" autocomplete="off"></div>`;
    return `<div class="fgrid">${f("name", "客户名称 *", c.name)}${f("contact", "联系人", c.contact)}${f("phone", "电话", c.phone)}${f("addr", "地址", c.addr)}${f("pay", "付款方式", c.pay, "例如 月结30天、款到发货")}${f("note", "备注", c.note)}</div>`;
  }
  function viewCust() {
    if (sel === "new") return `<div class="msg" id="msg"></div><section class="panel"><h2>新客户 <button type="button" class="btn" data-back="cust">返回</button></h2>${custForm({})}<div class="acts"><button type="button" class="btn primary" data-save-cust="new">保存</button></div></section>`;
    const c = custOf(sel); if (!c) { sel = null; return viewCustList() }
    const a = account(c.id), t = today();
    const fl = D.follow.filter(f => f.cust === c.id).sort((x, y) => (y.t || 0) - (x.t || 0));
    const qs = D.quote.filter(x => x.cust === c.id).sort((x, y) => y.d > x.d ? 1 : -1), os = D.order.filter(x => x.cust === c.id).sort((x, y) => y.d > x.d ? 1 : -1);
    return `<div class="msg" id="msg"></div>
    <div class="tools"><button type="button" class="btn" data-back="cust">← 客户列表</button><h2 style="margin:0;font-size:20px">${esc(c.name)}</h2><div class="grow"></div>
      <button type="button" class="btn primary" data-new-doc="quote" data-cust="${c.id}">＋ 报价单</button><button type="button" class="btn primary" data-new-doc="order" data-cust="${c.id}">＋ 订单</button><button type="button" class="btn" data-new-pay="${c.id}">登记收款</button></div>
    <div class="cards">${card("应收（已发货）", yuan(a.due))}${card("已收", yuan(a.paid))}${card("欠款", yuan(a.owe), a.age ? "最早一笔欠了 " + a.age + " 天" : "", a.owe > 0.005 ? "warn" : "")}${card("最近发货", a.last ? md(a.last) : "—", c.pay ? esc(c.pay) : "")}</div>
    <div class="side">
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
        <section class="panel"><h2>跟进记录</h2>
          <div class="fgrid" style="grid-template-columns:minmax(0,1fr) 170px"><div class="field"><label for="fu_text">这次跟进说了什么</label><input id="fu_text" placeholder="例如 电话问了 7801 的价格，下周要 2 吨" autocomplete="off"></div>
            <div class="field"><label for="fu_next">下次跟进（可不填）</label><input id="fu_next" type="date"></div></div>
          <div class="acts"><button type="button" class="btn primary" data-add-follow="${c.id}">记一条跟进</button></div>
          ${fl.length ? fl.slice(0, 30).map(f => `<div class="fl${f.next && f.next <= t && f === fl[0] ? " due" : ""}"><div class="sub">${md(f.d)}${f.next ? " · 下次跟进 " + md(f.next) : ""}</div><div>${esc(f.text || "")}</div></div>`).join("") : `<div class="sub">还没有跟进记录。</div>`}
        </section>
        <section class="panel"><h2>订单</h2>${os.length ? `<div class="list">${os.map(o => { const s = orderState(o); return `<div class="li" data-go="order" data-id="${o.id}"><div><div class="n d">${esc(o.no)}</div><div class="sub">${md(o.d)} · ${n0(linesQ(o.lines))} 支 · ${n3(linesKg(o.lines) / 1000)} 吨 · ${yuan(linesAmt(o.lines))}</div></div><div class="r">${chip(s[0], s[1])}</div></div>` }).join("")}</div>` : `<div class="sub">还没有订单。</div>`}</section>
        <section class="panel"><h2>报价单</h2>${qs.length ? `<div class="list">${qs.map(x => `<div class="li" data-go="quote" data-id="${x.id}"><div><div class="n d">${esc(x.no)}</div><div class="sub">${md(x.d)} · ${n0(linesQ(x.lines))} 支 · ${yuan(linesAmt(x.lines))}</div></div><div class="r">${x.order ? chip("已转订单", "done") : chip("报价", "gray")}</div></div>`).join("")}</div>` : `<div class="sub">还没有报价单。</div>`}</section>
      </div>
      <section class="panel"><h2><span>这个客户的定价</span><button type="button" class="btn sm" data-go-price="${c.id}">改定价</button></h2>
        <div class="sub">胚料加工费 <b class="d">${n0(custBillet(c))}</b> 元/吨${has(c.billet) ? "（单独定）" : "（标准）"}；单独定了 ${c.cfee ? Object.values(c.cfee).filter(has).length : 0} 种颜色的加工费${ingotOn(today()) ? `；今天不做颜色的单价 <b class="d">${n0(ingotOn(today()).price + custBillet(c))}</b> 元/吨` : ""}。</div></section>
      <section class="panel"><h2>客户资料</h2>${custForm(c)}<div class="acts"><button type="button" class="btn primary" data-save-cust="${c.id}">保存资料</button>
        <button type="button" class="btn danger" data-del-cust="${c.id}">${armDel === "c" + c.id ? "再点一次确认删除" : "删除客户"}</button></div><div class="sub">有订单、发货或收款的客户不能删除。</div></section>
    </div>`;
  }

  /* ---------- 报价单 / 订单 编辑 ---------- */
  function newDoc(kind, cid, from) {
    const d = today(), list = kind === "quote" ? D.quote : D.order;
    return { id: uid(), kind, isNew: true, no: nextNo(kind === "quote" ? "BJ" : "DD", list, d), d, cust: cid || "", unit: from ? from.unit || "t" : "t", note: from ? from.note || "" : "", quote: from ? from.id : "", lines: from ? from.lines.map(l => Object.assign({}, l, { lid: uid() })) : [] };
  }
  function openDoc(kind, id) { const x = (kind === "quote" ? D.quote : D.order).find(v => v.id === id); if (!x) return; ed = JSON.parse(JSON.stringify(x)); ed.kind = kind; ed.isNew = false }
  function viewEditor() {
    const x = ed, isQ = x.kind === "quote", sh = isQ ? {} : shippedBy(x.id), saved = !x.isNew, nm = isQ ? "报价单" : "订单";
    const cOpts = `<option value="">— 选客户 —</option>` + D.cust.map(c => `<option value="${c.id}"${c.id === x.cust ? " selected" : ""}>${esc(c.name)}</option>`).join("") + `<option value="__new">＋ 新客户…</option>`;
    const rows = x.lines.map((l, i) => { const s = sh[l.lid] || 0; return `<tr data-i="${i}"><td class="ct">${i + 1}</td>
      <td><input class="m" data-f="m" value="${esc(l.m || "")}" autocomplete="off" spellcheck="false"${s ? " disabled" : ""}></td><td><input data-f="L" inputmode="decimal" value="${l.L ?? ""}"${s ? " disabled" : ""}></td><td><input data-f="w" inputmode="decimal" value="${l.w ?? ""}"${s ? " disabled" : ""}></td>
      <td><select data-f="color" style="min-width:130px;height:34px;border:1px solid var(--line);border-radius:6px;background:var(--bg)"${s ? " disabled" : ""}>${colors().map(c => `<option value="${c.id}"${c.id === (l.color || "raw") ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></td>
      <td><input data-f="q" inputmode="numeric" value="${l.q ?? ""}"></td><td><select data-f="unit" style="height:34px;border:1px solid var(--line);border-radius:6px;background:var(--bg)"${s ? " disabled" : ""}><option value="t"${isPc(l) ? "" : " selected"}>按吨</option><option value="pc"${isPc(l) ? " selected" : ""}>按支</option></select></td><td><input data-f="price" inputmode="decimal" value="${l.price || ""}" placeholder="${l.hint ? "上次 " + l.hint : ""}" title="${unitTxt(l)}"><div class="sub" style="text-align:right;line-height:1.1">${unitTxt(l)}</div></td><td class="tl" id="pp_${i}" style="font-size:12px;line-height:1.3">${partsTxt(l, i)}</td>
      <td id="kg_${i}">${n1(kgOf(l))}</td><td class="M" id="am_${i}">${yuan(amtOf(l))}</td>${isQ ? "" : `<td class="${s ? "B" : ""}">${s ? n0(s) : ""}</td>`}<td class="ct">${s ? "" : `<button type="button" class="x" data-rm="${i}">删</button>`}</td></tr>` }).join("");
    const st = !isQ && saved ? orderState(x) : null;
    return `<div class="msg" id="msg"></div>
    <div class="tools"><button type="button" class="btn" data-back="${x.kind}">← ${nm}列表</button><h2 style="margin:0;font-size:20px">${x.isNew ? "新" + nm : nm} <span class="d">${esc(x.no)}</span></h2>${st ? chip(st[0], st[1]) : ""}${isQ && x.order ? chip("已转订单", "done") : ""}<div class="grow"></div>
      ${saved ? `<button type="button" class="btn" data-xl="1">导出 Excel</button>` : ""}${isQ && saved && !x.order ? `<button type="button" class="btn primary" data-to-order="1">转成订单</button>` : ""}${isQ && x.order ? `<button type="button" class="btn" data-go="order" data-id="${x.order}">查看订单</button>` : ""}
      ${!isQ && saved ? `<button type="button" class="btn primary" data-new-ship="${x.id}">登记发货</button>` : ""}</div>
    <section class="panel">
      <div class="fgrid"><div class="field"><label for="e_cust">客户 *</label><select id="e_cust"${!isQ && saved && D.ship.some(s => s.order === x.id) ? " disabled" : ""}>${cOpts}</select></div>
        <div class="field" id="e_newc_f" hidden><label for="e_newc">新客户名称</label><input id="e_newc" autocomplete="off"></div>
        <div class="field"><label for="e_d">日期</label><input id="e_d" type="date" value="${x.d}"></div>
        <div class="field" style="grid-column:span 2"><label for="e_note">备注</label><input id="e_note" value="${esc(x.note || "")}" placeholder="${isQ ? "例如 有效期 7 天、含运费" : "例如 交货日期、颜色"}" autocomplete="off"></div></div>
      <div class="tw"><table class="g"><thead><tr><th>#</th><th>型号</th><th>长度(米)</th><th>理论支重</th><th>颜色</th><th>支数</th><th>计价</th><th>单价</th><th>单价组成（内部）</th><th>理论重量(kg)</th><th>金额(元)</th>${isQ ? "" : "<th>已发(支)</th>"}<th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${isQ ? 12 : 13}" class="empty">还没有明细。在下面搜型号加一行。</td></tr>`}</tbody></table></div>
      <div class="tools"><span class="sub" style="font-weight:700">这张单子：</span><div class="seg"><button type="button" data-dunit="t" aria-pressed="${(x.unit || "t") === "t"}">全单按吨卖</button><button type="button" data-dunit="pc" aria-pressed="${x.unit === "pc"}">全单按支卖</button></div><span class="sub">新加的行用这个方式；单行也可以在“计价”里改。</span></div>
      ${ingotOn(x.d) ? `<div class="sub">单价按 ${md(ingotOn(x.d).d)} 的铝锭价 ${n0(ingotOn(x.d).price)} 元/吨 + 这个客户的胚料费和颜色费自动算；手改过的单价不会被自动改。</div>` : `<div class="banner">还没有填 ${x.d} 及以前的铝锭价，单价不能自动算（可以手填）。到“价格”页填当日铝锭价。</div>`}
      <div class="tools"><input class="q" id="lnQ" placeholder="🔍 搜型号加一行，例如 7801" autocomplete="off" spellcheck="false" style="text-transform:uppercase"><button type="button" class="btn" data-add-blank="1">手动加一行</button></div>
      <div class="res" id="lnRes" hidden></div>
      <div class="tot" id="e_tot"></div>
      <div class="acts"><button type="button" class="btn primary" data-save-doc="1" style="min-width:140px">保存${nm}</button>${saved ? `<button type="button" class="btn danger" data-del-doc="1">${armDel === "d" + x.id ? "再点一次确认删除" : "删除"}</button>` : ""}</div>
      <div class="sub">吨价 = 铝锭价 + 胚料加工费 + 颜色加工费（元/吨）。按吨卖：金额 = 理论重量 ÷ 1000 × 吨价；按支卖：每支单价 = 吨价 × 每支理论重量 ÷ 1000（可手改），金额 = 每支单价 × 支数。导出给客户的 Excel 只有单价，没有组成。${isQ ? "" : "已经发过货的行，型号、长度、支重不能改，支数不能少于已发。"}</div>
    </section>${!isQ && saved ? viewShipsOf(x) : ""}`;
  }
  function paintTotals() {
    if (!ed || !$("e_tot")) return;
    ed.lines.forEach((l, i) => { const k = $("kg_" + i), a = $("am_" + i), pp = $("pp_" + i); if (k) k.textContent = n1(kgOf(l)); if (a) a.textContent = yuan(amtOf(l)); if (pp) pp.innerHTML = partsTxt(l, i) });
    $("e_tot").innerHTML = `<span>${ed.lines.length} 行</span><span><b>${n0(linesQ(ed.lines))}</b> 支</span><span><b>${n1(linesKg(ed.lines))}</b> kg（${n3(linesKg(ed.lines) / 1000)} 吨）</span><span>合计 <b class="M">${yuan(linesAmt(ed.lines))}</b></span>`;
  }
  function partsTxt(l, i) { if (l.man) return `<span style="color:var(--warn-ink)">手改</span> <button type="button" class="x" style="color:inherit" data-auto="${i}">按定价算</button>`; if (!has(l.ing)) return ""; const ton = l.ing + l.bil + l.cf; if (isPc(l)) return +l.price === r2(ton * pcKg(l) / 1000) ? `吨价 ${n0(ton)}（锭 ${n0(l.ing)} + 胚 ${n0(l.bil)} + 色 ${n0(l.cf)}）× 每支 ${pcKg(l).toFixed(3)} kg` : ""; return +l.price === ton ? `锭 ${n0(l.ing)} + 胚 ${n0(l.bil)} + 色 ${n0(l.cf)}` : "" }
  function autoPrice(l) { if (l.man) return; const p = priceParts(ed.cust && ed.cust !== "__new" ? ed.cust : "", l.color || "raw", ed.d); if (p) Object.assign(l, { price: isPc(l) ? r2(p.unit * pcKg(l) / 1000) : p.unit, ing: p.ing, bil: p.bil, cf: p.cf }) }
  // 换计价方式：自动价重新算；手改过的价按每支重量换算（元/吨 ↔ 元/支）
  function switchUnit(l, u) { if ((l.unit || "t") === u) return; const kgp = pcKg(l); if (l.man && +l.price > 0 && kgp > 0) l.price = u === "pc" ? r2(+l.price * kgp / 1000) : Math.round(+l.price / kgp * 1000); l.unit = u; delete l.hint; autoPrice(l) }
  function reprice() { if (!ed) return; const sh = ed.kind === "order" ? shippedBy(ed.id) : {}; ed.lines.forEach(l => { if (!sh[l.lid]) autoPrice(l) }) }
  function addLine(spec) { const l = { lid: uid(), m: spec ? spec.m : "", L: spec ? spec.L : "", w: spec ? spec.w : "", color: "raw", unit: ed.unit || "t", q: "", price: 0 }; autoPrice(l); const p = spec && !(l.price > 0) ? lastPrice(ed.cust, l) : 0; if (p) { l.price = p; l.hint = p; l.man = true } ed.lines.push(l); render(); const tr = document.querySelector(`tr[data-i="${ed.lines.length - 1}"]`); if (tr) { const i = tr.querySelector(spec ? '[data-f="q"]' : '[data-f="m"]'); if (i) i.focus() } }
  function checkDoc() {
    const x = ed; if (!x.cust) return "请选客户。"; if (!x.lines.length) return "请至少加一行明细。";
    const sh = x.kind === "order" ? shippedBy(x.id) : {};
    for (const [i, l] of x.lines.entries()) {
      if (!l.m || !(+l.L > 0) || !(+l.w > 0)) return `第 ${i + 1} 行：型号、长度、支重都要填。`;
      if (!(+l.q > 0)) return `第 ${i + 1} 行（${l.m}）：请填支数。`;
      if (!(+l.price > 0)) return `第 ${i + 1} 行（${l.m}）：请填单价（${unitTxt(l)}）。`;
      if ((sh[l.lid] || 0) > +l.q) return `第 ${i + 1} 行（${l.m}）已经发了 ${sh[l.lid]} 支，支数不能少于这个数。`;
    }
    if (x.kind === "order") { const keep = new Set(x.lines.map(l => l.lid)); const lost = Object.keys(sh).filter(k => sh[k] > 0 && !keep.has(k)); if (lost.length) return "有已经发过货的行被删掉了，不能保存。请刷新后重来。" }
    return "";
  }
  async function saveDoc() {
    const x = ed, isQ = x.kind === "quote", nm = isQ ? "报价单" : "订单";
    if (x.cust === "__new") { const n = ($("e_newc").value || "").trim(); if (!n) { msg("请填新客户名称。", "err"); return } if (D.cust.some(c => c.name === n)) { msg("已经有同名客户了，请在下拉里选。", "err"); return } }
    const err = checkDoc(); if (err) { msg(err, "err"); return }
    const newC = x.cust === "__new" ? { id: uid(), name: $("e_newc").value.trim(), contact: "", phone: "", addr: "", pay: "", note: "" } : null;
    const doc = { id: x.id, no: x.no, d: x.d, unit: x.unit || "t", cust: newC ? newC.id : x.cust, note: x.note || "", lines: x.lines.map(l => Object.assign({ lid: l.lid, m: String(l.m).trim().toUpperCase(), L: +l.L, w: +l.w, color: l.color || "raw", unit: isPc(l) ? "pc" : "t", q: +l.q, price: +l.price }, l.man ? { man: true } : has(l.ing) ? { ing: +l.ing, bil: +l.bil, cf: +l.cf } : {})), t: x.t || Date.now() };
    if (isQ) doc.order = x.order || ""; else doc.quote = x.quote || "";
    const items = [`${x.isNew ? "新建" : "修改"}${nm} ${doc.no}：${newC ? newC.name + "（新客户）" : custName(doc.cust)}，${doc.lines.length} 行，${n0(linesQ(doc.lines))} 支，${n3(linesKg(doc.lines) / 1000)} 吨，${yuan(linesAmt(doc.lines))}`];
    if (!isQ && x.quote && x.isNew) items.push("由报价单转成，报价单标记“已转订单”");
    const q0 = !isQ && x.quote && x.isNew ? D.quote.find(v => v.id === x.quote) : null;
    const ok = await act(items, async () => {
      if (newC) await ST.cust.put(newC);
      await ST[x.kind].put(doc);
      if (q0) await ST.quote.update(q0.id, { order: doc.id });
    }, `已保存${nm} ${doc.no}。`);
    if (ok) { openDoc(x.kind, doc.id); render() }
  }

  /* ---------- 报价单 / 订单 列表 ---------- */
  function viewDocList(kind) {
    const isQ = kind === "quote", list = (isQ ? D.quote : D.order).slice().sort((a, b) => b.d > a.d ? 1 : b.d < a.d ? -1 : (b.t || 0) - (a.t || 0)), k = norm(q);
    const rows = list.filter(x => (!k || norm(x.no + custName(x.cust) + (x.lines || []).map(l => l.m).join(" ")).includes(k)) && (qf === "all" || (isQ ? (qf === "done" ? !!x.order : !x.order) : orderState(x)[1] === qf)));
    const segs = isQ ? [["all", "全部"], ["open", "未转订单"], ["done", "已转订单"]] : [["all", "全部"], ["wait", "待发货"], ["part", "部分发货"], ["done", "已发完"]];
    return `<div class="msg" id="msg"></div><section class="panel"><h2><span>${isQ ? "报价单" : "订单"} <span class="sub">${list.length} 张</span></span><button type="button" class="btn primary" data-new-doc="${kind}">＋ 新${isQ ? "报价单" : "订单"}</button></h2>
      <div class="tools"><input class="q" id="q" placeholder="搜单号、客户、型号" value="${esc(q)}" autocomplete="off"><div class="seg">${segs.map(([v, t]) => `<button type="button" data-qf="${v}" aria-pressed="${qf === v}">${t}</button>`).join("")}</div></div>
      ${rows.length ? `<div class="tw"><table class="g"><thead><tr><th>日期</th><th>单号</th><th>客户</th><th>行数</th><th>支数</th><th>吨</th><th>金额</th><th>状态</th></tr></thead><tbody>${rows.map(x => { const s = isQ ? (x.order ? ["已转订单", "done"] : ["报价", "gray"]) : orderState(x); return `<tr class="click" data-go="${kind}" data-id="${x.id}"><td>${md(x.d)}</td><td class="tl d">${esc(x.no)}</td><td class="tl B">${esc(custName(x.cust))}</td><td>${(x.lines || []).length}</td><td>${n0(linesQ(x.lines))}</td><td>${n3(linesKg(x.lines) / 1000)}</td><td class="M">${yuan(linesAmt(x.lines))}</td><td class="ct">${chip(s[0], s[1])}</td></tr>` }).join("")}</tbody></table></div>`
        : `<div class="empty">${list.length ? "没有符合条件的。" : "还没有" + (isQ ? "报价单" : "订单") + "。"}</div>`}</section>`;
  }

  /* ---------- 发货 ---------- */
  function viewShipsOf(o) {
    const ss = D.ship.filter(s => s.order === o.id).sort((a, b) => a.d < b.d ? -1 : 1);
    return `<section class="panel"><h2><span>发货记录 <span class="sub">${ss.length} 次</span></span></h2>${shipEd && shipEd.order === o.id ? viewShipForm(o) : ""}
      ${ss.length ? `<div class="tw"><table class="g"><thead><tr><th>日期</th><th>发货单号</th><th>支数</th><th>理论重量(kg)</th><th>过磅(kg)</th><th>金额</th><th>车牌 / 司机</th><th></th></tr></thead><tbody>${ss.map(s => `<tr><td>${md(s.d)}</td><td class="tl d">${esc(s.no)}</td><td>${n0(linesQ(s.lines))}</td><td>${n1(linesKg(s.lines))}</td><td>${s.kg ? n1(s.kg) : ""}</td><td class="M">${yuan(linesAmt(s.lines))}</td><td class="tl">${esc([s.car, s.driver].filter(Boolean).join(" / "))}</td>
        <td class="ct"><button type="button" class="x" style="color:inherit" data-ship-xl="${s.id}">发货单</button> <button type="button" class="x" data-del-ship="${s.id}">${armDel === "s" + s.id ? "确认撤销" : "撤销"}</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="sub">还没有发货。货提走后点上面的“登记发货”，这时才记应收。</div>`}</section>`;
  }
  function viewShipForm(o) {
    const sh = shippedBy(o.id);
    return `<div class="panel" style="background:var(--soft)"><h2>登记发货 <span class="sub">提货后登记，金额记入这个客户的应收</span></h2>
      <div class="fgrid"><div class="field"><label for="sp_d">发货日期</label><input id="sp_d" type="date" value="${shipEd.d}"></div><div class="field"><label for="sp_car">车牌</label><input id="sp_car" value="${esc(shipEd.car)}" autocomplete="off"></div>
        <div class="field"><label for="sp_driver">司机 / 电话</label><input id="sp_driver" value="${esc(shipEd.driver)}" autocomplete="off"></div><div class="field"><label for="sp_kg">过磅重量 kg（可不填）</label><input id="sp_kg" inputmode="decimal" value="${esc(shipEd.kg)}"></div></div>
      <div class="tw"><table class="g"><thead><tr><th>型号</th><th>长度</th><th>支重</th><th>颜色</th><th>订(支)</th><th>已发(支)</th><th>这次发(支)</th></tr></thead><tbody>${o.lines.map(l => { const left = (+l.q) - (sh[l.lid] || 0); return `<tr><td class="tl B">${esc(l.m)}</td><td class="L">${l.L}</td><td class="W">${l.w}</td><td class="tl">${esc(colorName(l.color))}</td><td>${n0(l.q)}</td><td>${sh[l.lid] ? n0(sh[l.lid]) : ""}</td><td style="width:130px"><input data-sq="${l.lid}" inputmode="numeric" value="${shipEd.q[l.lid] ?? (left > 0 ? left : "")}"${left > 0 ? "" : " disabled"}></td></tr>` }).join("")}</tbody></table></div>
      <div class="acts"><button type="button" class="btn primary" data-save-ship="1">确认发货</button><button type="button" class="btn" data-cancel-ship="1">取消</button></div></div>`;
  }
  async function saveShip() {
    const o = D.order.find(v => v.id === shipEd.order); if (!o) return;
    const sh = shippedBy(o.id), lines = [];
    for (const l of o.lines) { const left = (+l.q) - (sh[l.lid] || 0), v = parseInt(String(shipEd.q[l.lid] ?? (left > 0 ? left : "")).replace(/[^\d]/g, ""), 10); if (!(v > 0)) continue; if (v > left) { msg(`${l.m}（${l.L}米）只剩 ${n0(left)} 支没发，这次填了 ${n0(v)} 支。`, "err"); return } lines.push({ lid: l.lid, m: l.m, L: l.L, w: l.w, color: l.color || "raw", unit: l.unit || "t", q: v, price: l.price }) }
    if (!lines.length) { msg("这次没有填发货支数。", "err"); return }
    const d = shipEd.d || today(), s = { id: uid(), no: nextNo("FH", D.ship, d), d, cust: o.cust, order: o.id, lines, car: shipEd.car.trim(), driver: shipEd.driver.trim(), kg: parseFloat(shipEd.kg) || 0, t: Date.now() };
    const ok = await act([`登记发货 ${s.no}：${custName(o.cust)}（订单 ${o.no}），${lines.length} 行，${n0(linesQ(lines))} 支，${n3(linesKg(lines) / 1000)} 吨`, `记入应收 ${yuan(linesAmt(lines))}`], () => ST.ship.put(s), `已登记发货 ${s.no}，应收增加 ${yuan(linesAmt(lines))}。`);
    if (ok) { shipEd = null; openDoc("order", o.id); render() }
  }

  /* ---------- 账款 ---------- */
  function viewAcct() {
    if (payEd) return viewPayForm();
    if (sel) return viewStatement(sel);
    const k = norm(q), rows = D.cust.map(c => ({ c, a: account(c.id) })).filter(x => (x.a.due || x.a.paid) && (!k || norm(x.c.name).includes(k))).sort((a, b) => b.a.owe - a.a.owe);
    const tot = { due: sum(rows, x => x.a.due), paid: sum(rows, x => x.a.paid), owe: sum(rows, x => Math.max(0, x.a.owe)) };
    const recent = D.pay.slice().sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 15);
    return `<div class="msg" id="msg"></div>
    <div class="cards">${card("应收合计", yuan(tot.due), "按发货单")}${card("已收合计", yuan(tot.paid))}${card("欠款合计", yuan(tot.owe), rows.filter(x => x.a.owe > 0.005).length + " 个客户", tot.owe > 0.005 ? "warn" : "")}${card("超过 30 天的欠款", rows.filter(x => x.a.age > 30).length + " 个客户", "")}</div>
    <section class="panel"><h2><span>每个客户的欠款</span><button type="button" class="btn primary" data-new-pay="">＋ 登记收款</button></h2>
      <div class="tools"><input class="q" id="q" placeholder="搜客户" value="${esc(q)}" autocomplete="off"></div>
      ${rows.length ? `<div class="tw"><table class="g"><thead><tr><th>客户</th><th>应收</th><th>已收</th><th>欠款</th><th>欠了多久</th><th>最近发货</th></tr></thead><tbody>${rows.map(({ c, a }) => `<tr class="click" data-stmt="${c.id}"><td class="tl B">${esc(c.name)}</td><td>${yuan(a.due)}</td><td>${yuan(a.paid)}</td><td class="M">${a.owe > 0.005 ? yuan(a.owe) : a.owe < -0.005 ? "多收 " + yuan(-a.owe) : "结清"}</td><td class="ct">${a.age ? chip(a.age + " 天", a.age > 30 ? "wait" : "gray") : ""}</td><td>${md(a.last)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty">还没有发货或收款。订单登记发货后，这里会出现应收。</div>`}</section>
    <section class="panel"><h2>最近的收款</h2>${recent.length ? `<div class="list">${recent.map(p => `<div class="li" data-stmt="${p.cust}"><div><div class="n">${esc(custName(p.cust))}</div><div class="sub">${md(p.d)}${p.way ? " · " + esc(p.way) : ""}${p.note ? " · " + esc(p.note) : ""}</div></div><div class="r M">${yuan(p.amt)}</div></div>`).join("")}</div>` : `<div class="sub">还没有收款记录。</div>`}</section>`;
  }
  function stmtRows(cid) {
    const ev = [...D.ship.filter(s => s.cust === cid).map(s => ({ d: s.d, t: s.t || 0, k: "ship", x: s, inc: linesAmt(s.lines) })), ...D.pay.filter(p => p.cust === cid).map(p => ({ d: p.d, t: p.t || 0, k: "pay", x: p, dec: r2(+p.amt) }))].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.t - b.t);
    let bal = 0; ev.forEach(e => { bal = r2(bal + (e.inc || 0) - (e.dec || 0)); e.bal = bal }); return ev;
  }
  function viewStatement(cid) {
    const c = custOf(cid); if (!c) { sel = null; return viewAcct() }
    const a = account(cid), ev = stmtRows(cid);
    return `<div class="msg" id="msg"></div><div class="tools"><button type="button" class="btn" data-back="acct">← 账款</button><h2 style="margin:0;font-size:20px">${esc(c.name)} 对账</h2><div class="grow"></div><button type="button" class="btn" data-stmt-xl="${cid}">导出对账单</button><button type="button" class="btn primary" data-new-pay="${cid}">登记收款</button></div>
    <div class="cards">${card("应收", yuan(a.due))}${card("已收", yuan(a.paid))}${card("欠款", yuan(a.owe), a.age ? "最早一笔欠了 " + a.age + " 天" : "", a.owe > 0.005 ? "warn" : "")}${card("付款方式", esc(c.pay || "—"))}</div>
    <section class="panel">${ev.length ? `<div class="tw"><table class="g"><thead><tr><th>日期</th><th>类型</th><th>单号 / 说明</th><th>应收增加</th><th>收款</th><th>余额（欠款）</th><th></th></tr></thead><tbody>${ev.map(e => e.k === "ship" ? `<tr><td>${md(e.d)}</td><td class="tl">发货</td><td class="tl d">${esc(e.x.no)} <span class="sub">${n0(linesQ(e.x.lines))} 支 · ${n3(linesKg(e.x.lines) / 1000)} 吨</span></td><td class="M">${yuan(e.inc)}</td><td></td><td class="B">${yuan(e.bal)}</td><td></td></tr>`
      : `<tr><td>${md(e.d)}</td><td class="tl">收款</td><td class="tl">${esc([e.x.way, e.x.note].filter(Boolean).join(" · "))}</td><td></td><td class="M">${yuan(e.dec)}</td><td class="B">${yuan(e.bal)}</td><td class="ct"><button type="button" class="x" data-del-pay="${e.x.id}">${armDel === "p" + e.x.id ? "确认删除" : "删除"}</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">这个客户还没有发货和收款。</div>`}</section>`;
  }
  function viewPayForm() {
    const p = payEd, cOpts = `<option value="">— 选客户 —</option>` + D.cust.map(c => `<option value="${c.id}"${c.id === p.cust ? " selected" : ""}>${esc(c.name)}${account(c.id).owe > 0.005 ? "（欠 " + yuan(account(c.id).owe) + "）" : ""}</option>`).join("");
    return `<div class="msg" id="msg"></div><section class="panel" style="max-width:640px"><h2>登记收款 <button type="button" class="btn" data-cancel-pay="1">取消</button></h2>
      <div class="fgrid"><div class="field" style="grid-column:1/-1"><label for="py_cust">客户 *</label><select id="py_cust">${cOpts}</select></div>
        <div class="field"><label for="py_amt">收款金额（元）*</label><input id="py_amt" inputmode="decimal" value="${esc(p.amt)}" autocomplete="off"></div><div class="field"><label for="py_d">日期</label><input id="py_d" type="date" value="${p.d}"></div>
        <div class="field"><label for="py_way">方式</label><input id="py_way" value="${esc(p.way)}" placeholder="例如 转账、现金、承兑" autocomplete="off"></div><div class="field"><label for="py_note">备注</label><input id="py_note" value="${esc(p.note)}" autocomplete="off"></div></div>
      <div class="acts"><button type="button" class="btn primary" data-save-pay="1">保存收款</button></div></section>`;
  }


  /* ---------- 价格（内部单价汇总） ---------- */
  function viewPrice() {
    const t = today(), ig = ingotOn(t), cs = colors(), hist = D.ingot.slice().sort((a, b) => b.d > a.d ? 1 : -1);
    if (!stdEd) stdEd = { billet: P.billet || "", colors: P.colors.map(c => Object.assign({}, c)) };
    if (!igEd) igEd = { d: t, price: "" };
    const unitOf = (c, col) => ig ? ig.price + custBillet(c) + custColorFee(c, col) : null;
    const pc = pcEd ? custOf(pcEd) : null;
    if (impPlan) return viewImp();
    const cell = (v, own) => `<td class="${own ? "B" : ""}" style="${own ? "" : "color:var(--muted)"}">${n0(v)}</td>`;
    return `<div class="msg" id="msg"></div>
    <div class="cards">${card("今日铝锭价", ig ? n0(ig.price) + " 元/吨" : "未填", ig ? (ig.d === t ? "今天" : md(ig.d) + " 填的（今天还没填）") : "请在下面填", ig && ig.d === t ? "" : "warn")}${card("标准胚料加工费", n0(P.billet) + " 元/吨", "没单独定价的客户用这个")}${card("颜色", P.colors.length + " 种", "另有“胚料（不做颜色）”= 0")}${card("单独定价的客户", D.cust.filter(c => has(c.billet) || (c.cfee && Object.values(c.cfee).some(has))).length + " 个", "其余用标准价")}</div>
    <div class="side">
      <section class="panel"><h2><span>客户定价列表</span><span class="acts"><span class="seg"><button type="button" data-pv="fee" aria-pressed="${pView === "fee"}">加工费</button><button type="button" data-pv="unit" aria-pressed="${pView === "unit"}">今日单价</button></span><button type="button" class="btn" data-price-xl="1">导出价格表</button><button type="button" class="btn primary" data-price-imp="1">导入价格表</button></span></h2>
        <div class="sub">${pView === "fee" ? "黑色粗体 = 这个客户单独定的价；灰色 = 用标准价。点一行改这个客户的定价。" : ig ? `今日单价 = 铝锭价 ${n0(ig.price)} + 胚料费 + 颜色费（元/吨）。` : "还没有铝锭价，算不出今日单价。"}</div>
        ${pc ? `<div class="panel" style="background:var(--soft)"><h2>${esc(pc.name)} 的定价 <span class="sub">空着 = 用标准价</span></h2>
          <div class="fgrid"><div class="field"><label for="pc_billet">胚料加工费（元/吨）</label><input id="pc_billet" inputmode="decimal" value="${has(pc.billet) ? pc.billet : ""}" placeholder="标准 ${n0(P.billet)}"></div>
          ${P.colors.map(c => `<div class="field"><label>${esc(c.name)}（元/吨）</label><input data-pcf="${c.id}" inputmode="decimal" value="${pc.cfee && has(pc.cfee[c.id]) ? pc.cfee[c.id] : ""}" placeholder="标准 ${n0(c.fee)}"></div>`).join("")}</div>
          <div class="acts"><button type="button" class="btn primary" data-save-pc="${pc.id}">保存 ${esc(pc.name)} 的定价</button><button type="button" class="btn" data-clear-pc="1">全部清空（用标准价）</button><button type="button" class="btn" data-cancel-pc="1">取消</button></div></div>` : ""}
        ${D.cust.length ? `<div class="tw"><table class="g"><thead><tr><th style="position:sticky;left:0;z-index:3">客户</th>${pView === "fee" ? `<th>胚料加工费</th>${P.colors.map(c => `<th>${esc(c.name)}</th>`).join("")}` : cs.map(c => `<th>${esc(c.name)}</th>`).join("")}</tr></thead><tbody>
          <tr><td class="tl" style="position:sticky;left:0;z-index:1;color:var(--muted)">（标准价）</td>${pView === "fee" ? `<td>${n0(P.billet)}</td>${P.colors.map(c => `<td>${n0(c.fee)}</td>`).join("")}` : cs.map(c => `<td>${ig ? n0(ig.price + (+P.billet || 0) + (+c.fee || 0)) : ""}</td>`).join("")}</tr>
          ${D.cust.map(c => `<tr class="click" data-pc="${c.id}"><td class="tl B" style="position:sticky;left:0;z-index:1">${esc(c.name)}</td>${pView === "fee" ? cell(custBillet(c), has(c.billet)) + P.colors.map(k => cell(custColorFee(c, k.id), c.cfee && has(c.cfee[k.id]))).join("") : cs.map(k => `<td class="M">${ig ? n0(unitOf(c, k.id)) : ""}</td>`).join("")}</tr>`).join("")}
          </tbody></table></div>` : `<div class="empty">还没有客户。</div>`}
      </section>
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
        <section class="panel"><h2>当日铝锭价</h2>
          <div class="fgrid" style="grid-template-columns:1fr 1fr"><div class="field"><label for="ig_d">日期</label><input id="ig_d" type="date" value="${igEd.d}"></div><div class="field"><label for="ig_p">铝锭价（元/吨）</label><input id="ig_p" inputmode="decimal" value="${esc(igEd.price)}" placeholder="${ig ? "上次 " + n0(ig.price) : "例如 20500"}"></div></div>
          <div class="acts"><button type="button" class="btn primary" data-save-ig="1">保存铝锭价</button></div>
          <div class="sub">开单时用开单当天的铝锭价（那天没填就用之前最近一天的），存进单子后就不变了。</div>
          ${hist.length ? `<div class="tw" style="max-height:260px"><table class="g"><thead><tr><th>日期</th><th>铝锭价</th><th>涨跌</th><th></th></tr></thead><tbody>${hist.slice(0, 30).map((x, i) => { const pr = hist[i + 1], dd = pr ? x.price - pr.price : 0; return `<tr><td>${md(x.d)}</td><td class="B">${n0(x.price)}</td><td style="color:${dd > 0 ? "var(--accent)" : dd < 0 ? "#2f7d3b" : "var(--muted)"}">${pr ? (dd > 0 ? "+" : "") + n0(dd) : ""}</td><td class="ct"><button type="button" class="x" data-del-ig="${x.id}">${armDel === "i" + x.id ? "确认删除" : "删"}</button></td></tr>` }).join("")}</tbody></table></div>` : ""}
        </section>
        <section class="panel"><h2>标准加工费</h2>
          <div class="field"><label for="sd_billet">标准胚料加工费（元/吨）</label><input id="sd_billet" inputmode="decimal" value="${esc(stdEd.billet)}"></div>
          <div class="tw"><table class="g"><thead><tr><th>颜色</th><th>标准颜色加工费（元/吨）</th><th></th></tr></thead><tbody>
            <tr><td class="tl" style="color:var(--muted)">胚料（不做颜色）</td><td style="color:var(--muted)">0</td><td></td></tr>
            ${stdEd.colors.map((c, i) => `<tr><td><input class="m" data-scn="${i}" value="${esc(c.name)}" placeholder="颜色名称" style="text-transform:none;min-width:90px"></td><td><input data-scf="${i}" inputmode="decimal" value="${esc(c.fee)}"></td><td class="ct"><button type="button" class="x" data-rm-color="${i}">删</button></td></tr>`).join("")}
          </tbody></table></div>
          <div class="acts"><button type="button" class="btn" data-add-color="1">＋ 加一种颜色</button><button type="button" class="btn primary" data-save-std="1">保存标准加工费</button></div>
          <div class="sub">改标准价只影响以后新开的单，已经存了的报价单、订单不变。删掉的颜色，旧单子里显示“已删除颜色”。</div>
        </section>
      </div>
    </div>`;
  }


  /* ---------- 产品（型号和支重表）：规格 = 型号 + 长度 + 理论支重；可从“产品大数据库”Excel 导入，只取型号和支重 ---------- */
  const specKey = (m, L, w) => norm(m) + "|" + (+L) + "|" + (+w);
  const bandOf = w => { w = +w; return w < 0.15 ? "<0.15" : w < 0.2 ? "0.15–0.20" : w < 0.25 ? "0.20–0.25" : w < 0.3 ? "0.25–0.30" : w < 0.4 ? "0.30–0.40" : w < 0.6 ? "0.40–0.60" : "≥0.60" };
  let pq = "", pModel = null, pEdit = null, prodPlan = null;
  function specSales(m, L, w) {   // 这个规格（L/w 为空 = 整个型号）在销售里的情况
    const k = norm(m), mt = l => norm(l.m) === k && (L == null || (+l.L === +L && +l.w === +w));
    const ords = D.order.filter(o => (o.lines || []).some(mt)), sh = D.ship.flatMap(s => (s.lines || []).filter(mt).map(l => ({ s, l })));
    const custs = [...new Set([...ords.map(o => o.cust), ...D.quote.filter(q => (q.lines || []).some(mt)).map(q => q.cust)])];
    const last = [...D.order, ...D.quote].filter(d => (d.lines || []).some(mt)).sort((a, b) => b.d > a.d ? 1 : -1)[0];
    const ll = last ? last.lines.find(mt) : null;
    return { nOrd: ords.length, shQ: sum(sh, x => +x.l.q), shKg: sum(sh, x => kgOf(x.l)), shAmt: sum(sh, x => amtOf(x.l)), custs, last: ll ? { d: last.d, cust: last.cust, price: ll.price, unit: unitTxt(ll) } : null };
  }
  function viewProd() {
    if (prodPlan) return viewProdImp();
    const groups = new Map(); D.prod.forEach(x => { const k = norm(x.m); (groups.get(k) || groups.set(k, { m: x.m, specs: [] }).get(k)).specs.push(x) });
    if (pModel) { const g = groups.get(norm(pModel)); if (g) return viewModel(g); pModel = null }
    const k = norm(pq), list = [...groups.values()].filter(g => !k || norm(g.m).includes(k)).sort((a, b) => a.m < b.m ? -1 : 1);
    return `<div class="msg" id="msg"></div>
    <div class="cards">${card("型号", groups.size + " 个")}${card("规格", D.prod.length + " 个", "型号 + 长度 + 理论支重")}${card("卖过的型号", [...groups.values()].filter(g => specSales(g.m).nOrd).length + " 个", "有订单的")}${card("产品表来源", D.prod.length ? "已导入" : "未导入", D.prod.length ? "" : "报价搜型号暂时用基础型号库")}</div>
    <section class="panel"><h2><span>产品型号和支重 <span class="sub">${list.length} 个型号</span></span><span class="acts"><button type="button" class="btn" data-prod-new="1">＋ 加规格</button><button type="button" class="btn" data-prod-xl="1">导出产品表</button><button type="button" class="btn primary" data-prod-imp="1">导入产品大数据</button></span></h2>
      <div class="tools"><input class="q" id="pq" placeholder="搜型号，例如 1021" value="${esc(pq)}" autocomplete="off" spellcheck="false" style="text-transform:uppercase"></div>
      ${pEdit && pEdit.isNew ? prodForm() : ""}
      ${list.length ? `<div class="tw" style="max-height:calc(100vh - 360px)"><table class="g"><thead><tr><th>型号</th><th>规格数</th><th>长度(米)</th><th>理论支重</th><th>支重区间</th><th>订单</th><th>已发(吨)</th></tr></thead><tbody>${list.slice(0, 400).map(g => { const ls = [...new Set(g.specs.map(x => +x.L))].sort((a, b) => a - b), ws = g.specs.map(x => +x.w), st = specSales(g.m); return `<tr class="click" data-pm="${esc(g.m)}"><td class="tl B">${esc(g.m)}</td><td>${g.specs.length}</td><td class="L">${ls.join(" / ")}</td><td class="W">${Math.min(...ws) === Math.max(...ws) ? Math.min(...ws) : Math.min(...ws) + "–" + Math.max(...ws)}</td><td class="ct">${[...new Set(g.specs.map(x => x.band || bandOf(x.w)))].join("、")}</td><td>${st.nOrd || ""}</td><td>${st.shKg ? n3(st.shKg / 1000) : ""}</td></tr>` }).join("")}</tbody></table></div>${list.length > 400 ? `<div class="sub">只显示前 400 个，请输入型号搜索。</div>` : ""}`
        : `<div class="empty">${D.prod.length ? "没有找到这个型号。" : "还没有产品表。点右上角“导入产品大数据”，选你们的「产品大数据库」Excel（只导型号和支重，不导库存）。"}</div>`}</section>`;
  }
  function prodForm() { const x = pEdit; return `<div class="panel" style="background:var(--soft)"><h2>${x.isNew ? "加一个规格" : "改规格"}</h2><div class="fgrid">
      <div class="field"><label for="pf_m">型号 *</label><input id="pf_m" value="${esc(x.m || "")}" style="text-transform:uppercase" autocomplete="off"></div><div class="field"><label for="pf_L">长度(米) *</label><input id="pf_L" inputmode="decimal" value="${x.L ?? ""}"></div>
      <div class="field"><label for="pf_w">理论支重(6米) *</label><input id="pf_w" inputmode="decimal" value="${x.w ?? ""}"></div><div class="field"><label for="pf_note">备注</label><input id="pf_note" value="${esc(x.note || "")}" autocomplete="off"></div></div>
      <div class="acts"><button type="button" class="btn primary" data-prod-save="1">保存</button><button type="button" class="btn" data-prod-cancel="1">取消</button>${x.isNew ? "" : `<button type="button" class="btn danger" data-prod-del="${x.id}">${armDel === "g" + x.id ? "再点一次确认删除" : "删除这个规格"}</button>`}</div></div>` }
  function viewModel(g) {
    const st = specSales(g.m), specs = g.specs.slice().sort((a, b) => a.L - b.L || a.w - b.w);
    return `<div class="msg" id="msg"></div><div class="tools"><button type="button" class="btn" data-pm-back="1">← 产品列表</button><h2 style="margin:0;font-size:22px">${esc(g.m)}</h2><span class="sub">${specs.length} 个规格</span><div class="grow"></div><button type="button" class="btn" data-prod-new="${esc(g.m)}">＋ 加规格</button></div>
    <div class="cards">${card("订单", st.nOrd + " 张")}${card("已发", n0(st.shQ) + " 支", n3(st.shKg / 1000) + " 吨 · " + yuan(st.shAmt))}${card("买过的客户", st.custs.length + " 个", st.custs.slice(0, 4).map(custName).map(esc).join("、"))}${card("最近单价", st.last ? n0(st.last.price) + " " + st.last.unit : "—", st.last ? md(st.last.d) + " " + esc(custName(st.last.cust)) : "")}</div>
    ${pEdit && !pEdit.isNew ? prodForm() : ""}
    <section class="panel"><h2>规格</h2><div class="tw"><table class="g"><thead><tr><th>长度(米)</th><th>理论支重(6米)</th><th>每支理论重量(kg)</th><th>每吨约多少支</th><th>支重区间</th><th>订单</th><th>已发(支)</th><th>最近单价</th><th>备注</th><th></th></tr></thead><tbody>${specs.map(x => { const s2 = specSales(x.m, x.L, x.w), pk = x.w / 6 * x.L; return `<tr><td class="L">${x.L}</td><td class="W">${x.w}</td><td>${pk.toFixed(4)}</td><td>${pk > 0 ? n0(1000 / pk) : ""}</td><td class="ct">${esc(x.band || bandOf(x.w))}</td><td>${s2.nOrd || ""}</td><td>${s2.shQ ? n0(s2.shQ) : ""}</td><td>${s2.last ? n0(s2.last.price) + " " + s2.last.unit : ""}</td><td class="tl">${esc(x.note || "")}</td>
      <td class="ct"><button type="button" class="x" style="color:inherit" data-prod-edit="${x.id}">改</button> <button type="button" class="x" style="color:inherit" data-prod-quote="${x.id}">报价</button></td></tr>` }).join("")}</tbody></table></div></section>
    ${st.custs.length ? `<section class="panel"><h2>买过这个型号的客户</h2><div class="list">${st.custs.map(cid => { const s3 = D.ship.filter(x => x.cust === cid).flatMap(x => x.lines.filter(l => norm(l.m) === norm(g.m))); return `<div class="li" data-go="cust" data-id="${cid}"><div><div class="n">${esc(custName(cid))}</div></div><div class="r">${s3.length ? n0(sum(s3, l => +l.q)) + " 支 · " + n3(sum(s3, kgOf) / 1000) + " 吨" : "只报过价 / 未发货"}</div></div>` }).join("")}</div></section>` : ""}`;
  }

  /* ---------- 读 Excel：先用 ExcelJS；文件里有图表等 ExcelJS 读不了时，用下面这个只读数据的小读取器（只取每个格子的值） ---------- */
  async function unzipXlsx(buf) {
    const dv = new DataView(buf); let e = buf.byteLength - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error("不是 Excel（xlsx）文件");
    const n = dv.getUint16(e + 10, true), files = {}; let p = dv.getUint32(e + 16, true);
    for (let i = 0; i < n; i++) { const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true); files[new TextDecoder().decode(new Uint8Array(buf, p + 46, nl))] = { method, csize, off }; p += 46 + nl + xl + cl }
    return async name => { const f = files[name]; if (!f) return null; const st = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), raw = new Uint8Array(buf, st, f.csize);
      const out = f.method === 0 ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()); return new TextDecoder().decode(out) };
  }
  async function readXlsxLite(buf) {
    const get = await unzipXlsx(buf), DP = new DOMParser(), X = t => DP.parseFromString(t, "application/xml"), ss = [];
    const sst = await get("xl/sharedStrings.xml"); if (sst) for (const si of X(sst).getElementsByTagName("si")) ss.push([...si.getElementsByTagName("t")].map(t => t.textContent).join(""));
    const rmap = {}; for (const r of X(await get("xl/_rels/workbook.xml.rels")).getElementsByTagName("Relationship")) rmap[r.getAttribute("Id")] = r.getAttribute("Target");
    const worksheets = [];
    for (const sh of X(await get("xl/workbook.xml")).getElementsByTagName("sheet")) {
      let t = rmap[sh.getAttribute("r:id")] || ""; t = t.replace(/^\//, ""); if (!t.startsWith("xl/")) t = "xl/" + t;
      const txt = await get(t), rows = []; if (txt) for (const row of X(txt).getElementsByTagName("row")) { const a = []; for (const c of row.getElementsByTagName("c")) { const col = c.getAttribute("r").replace(/\d+/g, "").split("").reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0); const tp = c.getAttribute("t"), v = c.getElementsByTagName("v")[0];
        a[col] = tp === "s" ? (v ? ss[+v.textContent] : null) : tp === "inlineStr" ? [...c.getElementsByTagName("t")].map(x => x.textContent).join("") : tp === "str" || tp === "e" ? (v ? v.textContent : null) : tp === "b" ? (v ? v.textContent === "1" : null) : (v ? +v.textContent : null) } rows[+row.getAttribute("r")] = a }
      worksheets.push({ name: sh.getAttribute("name"), rowCount: rows.length ? rows.length - 1 : 0, getRow: r => { const a = rows[r] || []; return { getCell: i => ({ value: a[i] ?? null }), eachCell: fn => a.forEach((v, i) => { if (v !== null && v !== undefined && v !== "") fn({ value: v }, i) }) } } });
    }
    return { worksheets, getWorksheet: n => worksheets.find(w => w.name === n) };
  }
  async function openWb(file) { const buf = await file.arrayBuffer(); try { const XL = await loadXL(), wb = new XL.Workbook(); await wb.xlsx.load(buf.slice(0)); return wb } catch (e) { console.warn("ExcelJS 读不了，改用简单读取：", e); return readXlsxLite(buf) } }
  async function parseProd(file) {
    const wb = await openWb(file);
    const sheets = [wb.getWorksheet("产品数据库"), ...wb.worksheets].filter(Boolean);
    for (const ws of sheets) { let hr = 0, c = {};
      for (let r = 1; r <= Math.min(10, ws.rowCount) && !hr; r++) { const x = {}; ws.getRow(r).eachCell((cell, i) => { const t = String(cellV(cell.value) || "").trim(); if (/^型号$|^型号\(统一\)$/.test(t) && !x.m) x.m = i; else if (/^长度/.test(t) && !x.L) x.L = i; else if (/理论支重|^支重$/.test(t) && !/区间|范围/.test(t) && !x.w) x.w = i; else if (/支重区间/.test(t)) x.b = i }); if (x.m && x.L && x.w) { hr = r; c = x } }
      if (!hr) continue;
      const out = new Map(), bad = [];
      for (let r = hr + 1; r <= ws.rowCount; r++) { const row = ws.getRow(r), m = String(cellV(row.getCell(c.m).value) || "").trim().toUpperCase(); if (!m || /合计/.test(m)) continue;
        const L = numV(row.getCell(c.L).value), w = numV(row.getCell(c.w).value); if (!(L > 0) || !(w > 0)) { bad.push(r); continue }
        const k = specKey(m, L, w); if (!out.has(k)) out.set(k, { id: k, m, L, w, band: c.b ? String(cellV(row.getCell(c.b).value) || "").trim() || bandOf(w) : bandOf(w) }) }
      if (out.size) return { sheet: ws.name, specs: [...out.values()], bad: bad.length };
    }
    throw new Error("找不到“型号、长度、理论支重”这几列");
  }
  function viewProdImp() {
    const p = prodPlan, have = new Set(D.prod.map(x => x.id)), nw = p.specs.filter(x => !have.has(x.id)), models = new Set(p.specs.map(x => norm(x.m)));
    return `<div class="msg" id="msg"></div><section class="panel" style="max-width:860px"><h2>导入产品大数据 <span class="sub">${esc(p.name)} ·「${esc(p.sheet)}」表</span></h2>
      <div class="list"><div class="fl">文件里有 ${models.size} 个型号、${p.specs.length} 个规格（型号 + 长度 + 理论支重）${p.bad ? `；${p.bad} 行长度或支重不是数字，跳过` : ""}。</div>
        <div class="fl">新的规格 <b>${nw.length}</b> 个${nw.length ? "：" + esc(nw.slice(0, 12).map(x => x.m + " " + x.L + "米 " + x.w).join("、")) + (nw.length > 12 ? "……" : "") : ""}</div>
        <div class="fl">已经有的 ${p.specs.length - nw.length} 个，只更新支重区间，备注不动。</div>
        <div class="fl">只导型号、长度、理论支重、支重区间；文件里的库存、出货等车间数据不导入。</div></div>
      <div class="acts">${nw.length || p.specs.some(x => { const o = D.prod.find(y => y.id === x.id); return o && o.band !== x.band }) ? `<button type="button" class="btn primary" data-prod-imp-ok="1">确认导入</button>` : `<span class="sub">和现在的产品表一样，没有要改的。</span>`}<button type="button" class="btn" data-prod-imp-no="1">取消</button></div></section>`;
  }
  async function xlProd() {
    try { const XL = await loadXL(), wb = new XL.Workbook(), ws = wb.addWorksheet("产品数据库");
      const h = ws.addRow(["型号", "长度(米)", "理论支重", "每支理论重量(kg)", "支重区间", "备注"]); h.eachCell(c => { c.font = FH; c.fill = fill("A3122A"); c.border = BD; c.alignment = { horizontal: "center" } });
      D.prod.slice().sort((a, b) => a.m < b.m ? -1 : a.m > b.m ? 1 : a.L - b.L || a.w - b.w).forEach((x, i) => { const r = i + 2, row = ws.addRow([x.m, +x.L, +x.w, { formula: `C${r}/6*B${r}`, result: x.w / 6 * x.L }, x.band || bandOf(x.w), x.note || ""]); row.eachCell({ includeEmpty: true }, c => { c.font = F; c.border = BD }); row.getCell(2).numFmt = "0.00"; row.getCell(3).numFmt = "0.000"; row.getCell(4).numFmt = "0.0000" });
      [16, 10, 10, 16, 12, 24].forEach((w, i) => ws.getColumn(i + 1).width = w); ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = `A1:F${D.prod.length + 1}`;
      await shareFile(new Blob([await wb.xlsx.writeBuffer()], { type: XT }), `产品型号支重表_${mmdd(today())}.xlsx`); msg("已导出产品表（可以改好后再导入）。", "ok");
    } catch (e) { console.error(e); msg("导出失败，请再试一次。", "err") }
  }
  const prodFile = document.createElement("input"); prodFile.type = "file"; prodFile.accept = ".xlsx"; prodFile.hidden = true; document.body.appendChild(prodFile);
  prodFile.addEventListener("change", async () => { const f = prodFile.files && prodFile.files[0]; prodFile.value = ""; if (!f) return;
    try { prodPlan = Object.assign(await parseProd(f), { name: f.name }); render(); window.scrollTo(0, 0) } catch (e) { console.error(e); msg("读不了这个文件：" + (e && e.message || "格式不对") + "。", "err") } });
  /* ---------- 导入内部价格表（Excel）：格式和“导出价格表”一样，导出的文件改完可以直接导回来 ----------
     “加工费”表：第一列客户，第二列胚料加工费，后面每列一种颜色（元/吨）。“（标准价）”那一行 = 标准价。
     客户格子空着或和标准价一样 = 用标准价。新的颜色、新的客户会自动加上。“铝锭价”表：日期、铝锭价。“今日单价”表只看不导。 */
  let impPlan = null;
  const cellV = v => v && typeof v === "object" ? ("result" in v ? v.result : "richText" in v ? v.richText.map(t => t.text).join("") : v.text ?? (v instanceof Date ? v : "")) : v;
  const numV = v => { v = cellV(v); if (v === null || v === undefined || v === "") return null; const n = parseFloat(String(v).replace(/[,，\s元¥]/g, "")); return isFinite(n) ? n : NaN };
  function dayV(v) { v = cellV(v); if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10); const t = String(v || "").trim(); let m = /(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/.exec(t); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; if (typeof v === "number" && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10) } return "" }
  async function parsePrice(file) {
    const wb = await openWb(file);
    const ws = wb.getWorksheet("加工费") || wb.worksheets.find(w => !/今日单价|铝锭/.test(w.name)) || wb.worksheets[0]; if (!ws) throw new Error("没有工作表");
    let hr = 0, cols = []; for (let r = 1; r <= Math.min(10, ws.rowCount) && !hr; r++) { const row = ws.getRow(r), c1 = String(cellV(row.getCell(1).value) || ""); if (/客户/.test(c1)) { hr = r; row.eachCell((c, i) => { if (i > 1) cols.push({ i, name: String(cellV(c.value) || "").trim() }) }) } }
    if (!hr) throw new Error("“加工费”表第一列要有“客户”这个表头");
    const bCol = cols.find(c => /胚料/.test(c.name) && !/不做颜色/.test(c.name)); if (!bCol) throw new Error("找不到“胚料加工费”这一列");
    const cCols = cols.filter(c => c !== bCol && c.name && c.name !== RAW.name && !/不做颜色/.test(c.name));
    const rows = [], bad = [];
    for (let r = hr + 1; r <= ws.rowCount; r++) { const row = ws.getRow(r), name = String(cellV(row.getCell(1).value) || "").trim(); if (!name) continue;
      const x = { name, std: /标准/.test(name) && /^[（(]?标准价?[）)]?$/.test(name), billet: numV(row.getCell(bCol.i).value), fees: {} };
      if (Number.isNaN(x.billet)) bad.push(`${name} 的胚料加工费`);
      cCols.forEach(c => { const v = numV(row.getCell(c.i).value); if (Number.isNaN(v)) bad.push(`${name} 的 ${c.name}`); else if (v !== null) x.fees[c.name] = v }); rows.push(x) }
    if (bad.length) throw new Error("这些格子不是数字：" + bad.slice(0, 6).join("、") + (bad.length > 6 ? "……" : ""));
    const ing = [], wi = wb.getWorksheet("铝锭价");
    if (wi) { let h = 0, dc = 0, pcl = 0; for (let r = 1; r <= Math.min(10, wi.rowCount) && !h; r++) wi.getRow(r).eachCell((c, i) => { const t = String(cellV(c.value) || ""); if (/日期/.test(t)) { dc = i; h = r } else if (/铝锭/.test(t)) pcl = i });
      if (h && dc && pcl) for (let r = h + 1; r <= wi.rowCount; r++) { const d = dayV(wi.getRow(r).getCell(dc).value), v = numV(wi.getRow(r).getCell(pcl).value); if (d && v > 0) ing.push({ d, price: v }) } }
    return { colorNames: cCols.map(c => c.name), rows, ing };
  }
  function planPrice(x, fileName) {
    const stdRow = x.rows.find(r => r.std), custRows = x.rows.filter(r => !r.std);
    const colorsNew = P.colors.map(c => Object.assign({}, c)); const added = [];
    x.colorNames.forEach(n => { if (!colorsNew.some(c => c.name === n)) { const c = { id: uid(), name: n, fee: 0 }; colorsNew.push(c); added.push(n) } });
    const ch = [], billet = stdRow && stdRow.billet !== null ? stdRow.billet : +P.billet || 0;
    if (billet !== (+P.billet || 0)) ch.push(`标准胚料加工费 ${n0(P.billet)} → ${n0(billet)}`);
    if (stdRow) colorsNew.forEach(c => { const v = stdRow.fees[c.name]; if (v !== undefined && v !== +c.fee) { if (!added.includes(c.name)) ch.push(`标准 ${c.name}：${n0(c.fee)} → ${n0(v)}`); c.fee = v } });
    added.forEach(n => ch.push(`新增颜色 ${n}：${n0((colorsNew.find(c => c.name === n) || {}).fee)}`));
    const byName = n => colorsNew.find(c => c.name === n), custOps = [], newCust = [];
    custRows.forEach(r => { const c = D.cust.find(v => v.name === r.name);
      const bl = r.billet === null || r.billet === billet ? "" : r.billet, cf = {};
      Object.entries(r.fees).forEach(([n, v]) => { const k = byName(n); if (k && v !== +k.fee) cf[k.id] = v });
      if (!c) { newCust.push(r.name); custOps.push({ isNew: true, doc: { id: uid(), name: r.name, contact: "", phone: "", addr: "", pay: "", note: "", billet: bl, cfee: cf } }); return }
      const keep = {}; Object.entries(c.cfee || {}).forEach(([id, v]) => { const k = colorsNew.find(z => z.id === id); if (has(v) && k && !x.colorNames.includes(k.name)) keep[id] = v });   // 文件里没有的颜色列，保留原来的
      const cf2 = Object.assign(keep, cf);
      if (String(has(c.billet) ? +c.billet : "") !== String(bl) || JSON.stringify(Object.entries(c.cfee || {}).filter(([, v]) => has(v)).sort()) !== JSON.stringify(Object.entries(cf2).sort())) custOps.push({ isNew: false, id: c.id, name: c.name, patch: { billet: bl, cfee: cf2 } }) });
    const ingOps = x.ing.filter(i => { const o = D.ingot.find(v => v.d === i.d); return !o || +o.price !== i.price });
    return { fileName, colors: colorsNew, billet, ch, custOps, newCust, ingOps, nCust: custRows.length, nIng: x.ing.length };
  }
  function viewImp() {
    const p = impPlan, upd = p.custOps.filter(o => !o.isNew);
    const items = [...p.ch, ...(p.newCust.length ? [`新增客户 ${p.newCust.length} 个：${p.newCust.join("、")}`] : []), ...(upd.length ? [`改定价的客户 ${upd.length} 个：${upd.map(o => o.name).join("、")}`] : []), ...(p.ingOps.length ? [`铝锭价 ${p.ingOps.length} 天：${p.ingOps.slice(0, 8).map(i => md(i.d) + " " + n0(i.price)).join("、")}${p.ingOps.length > 8 ? "……" : ""}`] : [])];
    return `<div class="msg" id="msg"></div><section class="panel" style="max-width:860px"><h2>导入价格表 <span class="sub">${esc(p.fileName)}</span></h2>
      <div class="sub">文件里有 ${p.nCust} 个客户、${p.colors.length} 种颜色${p.nIng ? "、" + p.nIng + " 天铝锭价" : ""}。客户格子空着或和标准价一样的，算“用标准价”。文件里没有的客户不动。</div>
      ${items.length ? `<div class="list">${items.map(t => `<div class="fl">${esc(t)}</div>`).join("")}</div>` : `<div class="empty">和现在的价格完全一样，没有要改的。</div>`}
      <div class="acts">${items.length ? `<button type="button" class="btn primary" data-imp-ok="1">确认导入</button>` : ""}<button type="button" class="btn" data-imp-no="1">取消</button></div>
      <div class="sub">导入只改价格表，已经存了的报价单、订单的单价不变。</div></section>`;
  }
  async function applyImp() {
    const p = impPlan, items = ["导入价格表：" + p.fileName, ...p.ch.slice(0, 20), ...(p.newCust.length ? ["新增客户：" + p.newCust.join("、")] : []), ...(p.custOps.filter(o => !o.isNew).length ? [`改 ${p.custOps.filter(o => !o.isNew).length} 个客户的定价`] : []), ...(p.ingOps.length ? [`铝锭价 ${p.ingOps.length} 天`] : [])];
    if (await act(items, async () => {
      await KV.set("colors", p.colors.map(c => ({ id: c.id, name: c.name, fee: +c.fee || 0 }))); await KV.set("billet", p.billet);
      for (const o of p.custOps) { if (o.isNew) await ST.cust.put(o.doc); else await ST.cust.update(o.id, o.patch) }
      if (p.ingOps.length) await ST.ingot.putMany(p.ingOps.map(i => ({ id: i.d, d: i.d, price: i.price, t: Date.now() })));
    }, "已导入价格表。")) { impPlan = null; stdEd = null; render() }
  }
  const impFile = document.createElement("input"); impFile.type = "file"; impFile.accept = ".xlsx"; impFile.hidden = true; document.body.appendChild(impFile);
  impFile.addEventListener("change", async () => { const f = impFile.files && impFile.files[0]; impFile.value = ""; if (!f) return;
    try { impPlan = planPrice(await parsePrice(f), f.name); render(); window.scrollTo(0, 0) } catch (e) { console.error(e); msg("读不了这个文件：" + (e && e.message || "格式不对") + "。可以先点“导出价格表”，在导出的文件上改。", "err") } });
  async function xlPrice() {
    try { const XL = await loadXL(), wb = new XL.Workbook(), t = today(), ig = ingotOn(t), cs = colors();
      const mk = (name, f, cols, first) => { const ws = wb.addWorksheet(name); const h = ws.addRow(["客户", ...(first ? [first] : []), ...cols.map(c => c.name)]); h.eachCell(c => { c.font = FH; c.fill = fill("A3122A"); c.border = BD; c.alignment = { horizontal: "center", wrapText: true } }); h.height = 30;
        const add = (nm, c) => { const r = ws.addRow([nm, ...(first ? [f(c, null)] : []), ...cols.map(k => f(c, k.id))]); r.eachCell((x, i) => { x.font = F; x.border = BD; if (i > 1) x.numFmt = "#,##0" }) };
        add("（标准价）", null); D.cust.forEach(c => add(c.name, c)); ws.getColumn(1).width = 18; for (let i = 2; i <= cols.length + 2; i++) ws.getColumn(i).width = 12; ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }] };
      mk("加工费", (c, col) => col === null ? (c ? custBillet(c) : +P.billet || 0) : (c ? custColorFee(c, col) : (col === "raw" ? 0 : +(P.colors.find(k => k.id === col) || {}).fee || 0)), P.colors, "胚料加工费");
      if (ig) mk("今日单价", (c, col) => ig.price + (c ? custBillet(c) : +P.billet || 0) + (col === null ? 0 : (c ? custColorFee(c, col) : (col === "raw" ? 0 : +(P.colors.find(k => k.id === col) || {}).fee || 0))), cs);
      const ws = wb.addWorksheet("铝锭价"); const h = ws.addRow(["日期", "铝锭价(元/吨)"]); h.eachCell(c => { c.font = FH; c.fill = fill("A3122A"); c.border = BD });
      D.ingot.slice().sort((a, b) => b.d > a.d ? 1 : -1).forEach(x => { const r = ws.addRow([x.d, x.price]); r.eachCell(c => { c.font = F; c.border = BD }); r.getCell(2).numFmt = "#,##0" }); ws.getColumn(1).width = 14; ws.getColumn(2).width = 16;
      const wn = wb.addWorksheet("说明"); ["这是内部价格表，只给内部看。改好后可以在销售 App“价格”页点“导入价格表”导回去。", "“加工费”表：第一列客户，第二列胚料加工费，后面每列一种颜色（元/吨）。“（标准价）”那一行是标准价。", "客户的格子空着或者和标准价一样 = 这个客户用标准价。", "要加新颜色：在“加工费”表最后加一列，表头写颜色名称。要加新客户：加一行，第一列写客户名称。", "“铝锭价”表：日期、铝锭价（元/吨），导入时会更新这些日子的铝锭价。", "“今日单价”表是算出来给你看的，导入时不读。"].forEach((t, i) => { wn.getCell("A" + (i + 1)).value = t; wn.getCell("A" + (i + 1)).font = F }); wn.getColumn(1).width = 100;
      await shareFile(new Blob([await wb.xlsx.writeBuffer()], { type: XT }), `内部价格表_${mmdd(t)}.xlsx`); msg("已导出价格表。改好后可以点“导入价格表”导回来。", "ok");
    } catch (e) { console.error(e); msg("导出失败，请再试一次。", "err") }
  }

  /* ---------- 全域查询：客户、报价单、订单、发货单、收款、跟进 ---------- */
  let gq = "", gBack = "home";
  function viewSearch() {
    const k = norm(gq), hit = t => norm(t).includes(k), lt = ls => (ls || []).map(l => l.m + " " + colorName(l.color)).join(" ");
    const sortD = a => a.sort((x, y) => y.d > x.d ? 1 : y.d < x.d ? -1 : (y.t || 0) - (x.t || 0));
    const G = [
      ["产品型号", [...new Set(D.prod.filter(x => hit(x.m + " " + (x.note || ""))).map(x => x.m))].sort().map(m => { const sp = D.prod.filter(x => x.m === m); return `<div class="li" data-pm-go="${esc(m)}"><div><div class="n">${esc(m)}</div><div class="sub">${sp.length} 个规格 · ${[...new Set(sp.map(x => +x.L))].sort((a, b) => a - b).join(" / ")} 米 · 支重 ${esc([...new Set(sp.map(x => x.w))].sort((a, b) => a - b).join("、"))}</div></div><div class="r"></div></div>` })],
      ["客户", D.cust.filter(c => hit([c.name, c.contact, c.phone, c.addr, c.pay, c.note].join(" "))).map(c => { const a = account(c.id); return `<div class="li" data-go="cust" data-id="${c.id}"><div><div class="n">${esc(c.name)}</div><div class="sub">${esc([c.contact, c.phone, c.addr].filter(Boolean).join(" · "))}</div></div><div class="r">${a.owe > 0.005 ? "欠 " + yuan(a.owe) : ""}</div></div>` })],
      ["订单", sortD(D.order.filter(o => hit([o.no, custName(o.cust), o.note, lt(o.lines)].join(" ")))).map(o => { const st = orderState(o); return `<div class="li" data-go="order" data-id="${o.id}"><div><div class="n"><span class="d">${esc(o.no)}</span> ${esc(custName(o.cust))}</div><div class="sub">${md(o.d)} · ${esc((o.lines || []).map(l => l.m).join("、"))}</div></div><div class="r">${chip(st[0], st[1])} ${yuan(linesAmt(o.lines))}</div></div>` })],
      ["报价单", sortD(D.quote.filter(x => hit([x.no, custName(x.cust), x.note, lt(x.lines)].join(" ")))).map(x => `<div class="li" data-go="quote" data-id="${x.id}"><div><div class="n"><span class="d">${esc(x.no)}</span> ${esc(custName(x.cust))}</div><div class="sub">${md(x.d)} · ${esc((x.lines || []).map(l => l.m).join("、"))}</div></div><div class="r">${x.order ? chip("已转订单", "done") : ""} ${yuan(linesAmt(x.lines))}</div></div>`)],
      ["发货单", sortD(D.ship.filter(x => { const o = D.order.find(v => v.id === x.order) || {}; return hit([x.no, o.no, custName(x.cust), x.car, x.driver, lt(x.lines)].join(" ")) })).map(x => `<div class="li" data-go="order" data-id="${x.order}"><div><div class="n"><span class="d">${esc(x.no)}</span> ${esc(custName(x.cust))}</div><div class="sub">${md(x.d)} · ${n0(linesQ(x.lines))} 支${x.car ? " · " + esc(x.car) : ""}${x.driver ? " · " + esc(x.driver) : ""}</div></div><div class="r">${yuan(linesAmt(x.lines))}</div></div>`)],
      ["收款", sortD(D.pay.filter(x => hit([custName(x.cust), x.way, x.note, String(x.amt), x.d].join(" ")))).map(x => `<div class="li" data-stmt="${x.cust}"><div><div class="n">${esc(custName(x.cust))}</div><div class="sub">${md(x.d)}${x.way ? " · " + esc(x.way) : ""}${x.note ? " · " + esc(x.note) : ""}</div></div><div class="r M">${yuan(x.amt)}</div></div>`)],
      ["跟进记录", D.follow.filter(f => hit([custName(f.cust), f.text].join(" "))).sort((a, b) => (b.t || 0) - (a.t || 0)).map(f => `<div class="li" data-go="cust" data-id="${f.cust}"><div><div class="n">${esc(custName(f.cust))}</div><div class="sub">${md(f.d)} · ${esc(f.text)}</div></div><div class="r">${f.next ? "下次 " + md(f.next) : ""}</div></div>`)],
    ].filter(g => g[1].length);
    const n = G.reduce((a, g) => a + g[1].length, 0);
    return `<div class="msg" id="msg"></div><div class="tools"><h2 style="margin:0;font-size:20px">查询“${esc(gq)}”</h2><span class="sub">${n ? "找到 " + n + " 条" : ""}</span><div class="grow"></div><button type="button" class="btn" data-gclear="1">关闭查询</button></div>
      ${n ? G.map(([t, items]) => `<section class="panel"><h2><span>${t} <span class="sub">${items.length} 条</span></span></h2><div class="list">${items.slice(0, 50).join("")}</div>${items.length > 50 ? `<div class="sub">只显示前 50 条，请输入更具体的内容。</div>` : ""}</section>`).join("")
        : `<div class="empty">没有找到“${esc(gq)}”。可以搜客户名、联系人、电话、单号、型号、颜色、车牌、司机、收款金额。</div>`}`;
  }
  const gIn = $("gq");
  // 打字时不马上跳：拼音输入法正在拼字时不搜；停手 0.35 秒后再搜一次
  let gT = null, gComp = false;
  function gRun() { const v = gIn.value.trim(); if (v === gq && (v ? tab === "search" : tab !== "search")) return; if (v && tab !== "search") gBack = tab; gq = v; if (v) { tab = "search"; ed = null; shipEd = null; payEd = null; render() } else setTab(gBack) }
  // 顶部全部查询：打字时页面完全不动（不会打断输入法），按回车 / 键盘上的“搜索”才查；清空就回到原来的页面
  gIn.addEventListener("compositionstart", () => { gComp = true });
  gIn.addEventListener("compositionend", () => { gComp = false });
  gIn.addEventListener("input", e => { if (gComp || e.isComposing) return; if (!gIn.value.trim() && tab === "search") { clearTimeout(gT); gT = setTimeout(gRun, 0) } });
  gIn.addEventListener("search", () => { if (!gIn.value.trim()) gRun() });
  gIn.addEventListener("keydown", e => { if (e.isComposing) return; if (e.key === "Escape") { clearTimeout(gT); gIn.value = ""; gq = ""; setTab(gBack) } if (e.key === "Enter") { e.preventDefault(); clearTimeout(gT); gRun(); gIn.blur() } });
  /* ---------- 更多 ---------- */
  function viewMore() {
    const it = (t, p, b) => `<div class="it"><h3>${t}</h3><p>${p}</p>${b || ""}</div>`;
    return `<div class="msg" id="msg"></div><div class="more">
      ${it("BOSS 授权 / 操作记录", (Cloud.boss.left() ? "已授权，还剩 " + Math.ceil(Cloud.boss.left() / 60000) + " 分钟。" : "已锁上。") + "销售 App 的授权码和操作记录单独存放，和车间的 PETRJASON 分开。",
        `<div class="acts"><button type="button" class="btn primary" id="mLog">${logList ? "收起操作记录" : "操作记录"}</button><button type="button" class="btn" id="mUndo">撤销最近一次改动</button><button type="button" class="btn" id="mLock">立即锁上</button><button type="button" class="btn" id="mPin">设置 / 修改授权码</button><button type="button" class="btn" id="mForgot">忘记授权码</button></div>`)}
      ${it("备份 / 恢复", "把销售的全部数据（客户、跟进、报价、订单、发货、收款）存成一个文件，或者从备份文件恢复。", `<div class="acts"><button type="button" class="btn" id="mBak">备份销售数据</button><button type="button" class="btn" id="mRes">从备份恢复</button></div>`)}
      ${it("算法", "单价按“元/吨”。理论重量 = 理论支重 ÷ 6 × 长度 × 支数；金额 = 理论重量 ÷ 1000 × 单价。应收按发货单算（货提走、登记发货后才算），收款先抵最早的发货。")}
      ${it("账号", esc("当前账号：" + (Cloud.email() || "")), `<button type="button" class="btn" id="mOut">退出登录</button>`)}
    </div>${logList ? `<section class="panel"><h2>操作记录（最近 30 次）</h2><div class="list">${logList.map(x => { const d = new Date(x.t / 1000); return `<div class="fl"><div class="sub">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}${x.undone ? " · 已撤销" : ""}</div><div>${(x.items || []).slice(0, 6).map(esc).join("<br>")}${(x.items || []).length > 6 ? "<br>……" : ""}</div></div>` }).join("")}</div></section>` : ""}`;
  }

  /* ---------- 导出 Excel ---------- */
  function loadXL() { return new Promise((ok, bad) => { if (window.ExcelJS) return ok(window.ExcelJS); const s = document.createElement("script"); s.src = "../exceljs.min.js"; s.onload = () => ok(window.ExcelJS); s.onerror = () => bad(new Error("load")); document.head.appendChild(s) }) }
  async function shareFile(blob, name) {
    try { const file = new File([blob], name, { type: blob.type || "application/octet-stream" }); if (/iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return } } catch (e) { if (e && e.name === "AbortError") return }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000);
  }
  const XT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const thin = { style: "thin", color: { argb: "FFBFBFBF" } }, BD = { top: thin, left: thin, bottom: thin, right: thin }, F = { name: "Arial", size: 11 }, FB = { name: "Arial", size: 11, bold: true }, FH = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  const fill = c => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c } });
  // 报价单 / 订单 / 发货单：同一种版式。理论重量和金额用公式（WPS 也能算）
  function sheetDoc(wb, title, sheetName, info, lines, foot) {
    const ws = wb.addWorksheet(sheetName, { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.mergeCells("A1:J1"); ws.getCell("A1").value = title; ws.getCell("A1").font = { name: "Arial", size: 18, bold: true }; ws.getCell("A1").alignment = { horizontal: "center" }; ws.getRow(1).height = 30;
    info.forEach((t, i) => { const c = ws.getCell(`${i % 2 ? "E" : "A"}${2 + Math.floor(i / 2)}`); c.value = t; c.font = F });
    const h0 = 3 + Math.ceil(info.length / 2), hr = ws.getRow(h0);
    ["序号", "型号", "颜色", "长度(米)", "理论支重", "支数", "理论重量(kg)", "单价", "计价单位", "金额(元)"].forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = FH; c.fill = fill("A3122A"); c.border = BD; c.alignment = { horizontal: "center", vertical: "middle" } }); hr.height = 24;
    lines.forEach((l, i) => { const r = h0 + 1 + i, row = ws.getRow(r);
      [i + 1, l.m, colorName(l.color), +l.L, +l.w, +l.q, { formula: `E${r}/6*D${r}*F${r}`, result: kgOf(l) }, +l.price, unitTxt(l), { formula: isPc(l) ? `ROUND(H${r}*F${r},2)` : `ROUND(G${r}/1000*H${r},2)`, result: amtOf(l) }].forEach((v, j) => { const c = row.getCell(j + 1); c.value = v; c.font = F; c.border = BD; c.alignment = { horizontal: j === 1 || j === 2 ? "left" : "center" } });
      ws.getCell(`D${r}`).numFmt = "0.00"; ws.getCell(`E${r}`).numFmt = "0.000"; ws.getCell(`F${r}`).numFmt = "#,##0"; ws.getCell(`G${r}`).numFmt = "#,##0.0"; ws.getCell(`H${r}`).numFmt = "#,##0.00"; ws.getCell(`J${r}`).numFmt = "#,##0.00" });
    const tr = h0 + 1 + lines.length, a = h0 + 1, b = tr - 1;
    ws.getCell(`A${tr}`).value = "合计"; ws.getCell(`F${tr}`).value = { formula: `SUM(F${a}:F${b})`, result: linesQ(lines) }; ws.getCell(`G${tr}`).value = { formula: `SUM(G${a}:G${b})`, result: linesKg(lines) }; ws.getCell(`J${tr}`).value = { formula: `SUM(J${a}:J${b})`, result: linesAmt(lines) };
    for (let c = 1; c <= 10; c++) { const x = ws.getRow(tr).getCell(c); x.font = FB; x.border = BD; x.fill = fill("FBE6E3") }
    ws.getCell(`F${tr}`).numFmt = "#,##0"; ws.getCell(`G${tr}`).numFmt = "#,##0.0"; ws.getCell(`J${tr}`).numFmt = "#,##0.00";
    let r = tr + 2; (foot || []).forEach(t => { ws.getCell(`A${r}`).value = t; ws.getCell(`A${r}`).font = F; r++ });
    ws.getCell(`A${r}`).value = "理论重量 = 理论支重 ÷ 6 × 长度 × 支数；按吨：金额 = 理论重量 ÷ 1000 × 单价；按支：金额 = 单价 × 支数。"; ws.getCell(`A${r}`).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF7F7F7F" } };
    [6, 14, 16, 9, 10, 9, 13, 12, 10, 14].forEach((w, i) => ws.getColumn(i + 1).width = w);
    return ws;
  }
  const mmdd = d => d.slice(5).replace("-", "");
  const safe = s => String(s || "").replace(/[\\\/:*?"<>|]/g, "");
  async function xlDoc(kind, x) {
    try { const XL = await loadXL(), wb = new XL.Workbook(), c = custOf(x.cust) || { name: custName(x.cust) };
      const isQ = kind === "quote";
      sheetDoc(wb, isQ ? "报 价 单" : "订 单", isQ ? "报价单" : "订单", [`客户：${c.name}`, `日期：${x.d}`, `联系人：${c.contact || ""}　电话：${c.phone || ""}`, `单号：${x.no}`], x.lines, [x.note ? "备注：" + x.note : "", c.pay && !isQ ? "付款方式：" + c.pay : ""].filter(Boolean));
      await shareFile(new Blob([await wb.xlsx.writeBuffer()], { type: XT }), `${isQ ? "报价单" : "订单"}_${safe(c.name)}_${mmdd(x.d)}.xlsx`); msg("已导出。", "ok");
    } catch (e) { console.error(e); msg("导出失败，请再试一次。", "err") }
  }
  async function xlShip(s) {
    try { const XL = await loadXL(), wb = new XL.Workbook(), c = custOf(s.cust) || { name: custName(s.cust) }, o = D.order.find(v => v.id === s.order) || {};
      const ws = sheetDoc(wb, "发 货 单", "发货单", [`客户：${c.name}`, `日期：${s.d}`, `发货单号：${s.no}`, `订单号：${o.no || ""}`, `车牌：${s.car || ""}　司机：${s.driver || ""}`, s.kg ? `过磅重量：${s.kg} kg` : ""], s.lines, []);
      const r = ws.rowCount + 2; ws.getCell(`A${r}`).value = "发货人："; ws.getCell(`D${r}`).value = "提货人："; ws.getCell(`G${r}`).value = "日期："; [`A${r}`, `D${r}`, `G${r}`].forEach(k => ws.getCell(k).font = FB);
      await shareFile(new Blob([await wb.xlsx.writeBuffer()], { type: XT }), `发货单_${safe(c.name)}_${mmdd(s.d)}.xlsx`); msg("已导出发货单。", "ok");
    } catch (e) { console.error(e); msg("导出失败，请再试一次。", "err") }
  }
  async function xlStmt(cid) {
    try { const XL = await loadXL(), wb = new XL.Workbook(), c = custOf(cid), ev = stmtRows(cid), a = account(cid);
      const ws = wb.addWorksheet("对账单", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      ws.mergeCells("A1:F1"); ws.getCell("A1").value = "对 账 单"; ws.getCell("A1").font = { name: "Arial", size: 18, bold: true }; ws.getCell("A1").alignment = { horizontal: "center" };
      ws.getCell("A2").value = "客户：" + c.name; ws.getCell("D2").value = "截至：" + today(); ["A2", "D2"].forEach(k => ws.getCell(k).font = F);
      const hr = ws.getRow(4); ["日期", "类型", "单号 / 说明", "应收增加(元)", "收款(元)", "余额(元)"].forEach((h, i) => { const x = hr.getCell(i + 1); x.value = h; x.font = FH; x.fill = fill("A3122A"); x.border = BD; x.alignment = { horizontal: "center" } });
      ev.forEach((e, i) => { const r = 5 + i, row = ws.getRow(r);
        [e.d, e.k === "ship" ? "发货" : "收款", e.k === "ship" ? `${e.x.no}（${linesQ(e.x.lines)} 支，${(linesKg(e.x.lines) / 1000).toFixed(3)} 吨）` : [e.x.way, e.x.note].filter(Boolean).join(" · "), e.inc || null, e.dec || null, { formula: i ? `F${r - 1}+D${r}-E${r}` : `D${r}-E${r}`, result: e.bal }].forEach((v, j) => { const x = row.getCell(j + 1); x.value = v; x.font = F; x.border = BD });
        ["D", "E", "F"].forEach(k => ws.getCell(`${k}${r}`).numFmt = "#,##0.00") });
      const tr = 5 + ev.length; ws.getCell(`A${tr}`).value = "合计"; ws.getCell(`D${tr}`).value = { formula: `SUM(D5:D${tr - 1})`, result: a.due }; ws.getCell(`E${tr}`).value = { formula: `SUM(E5:E${tr - 1})`, result: a.paid }; ws.getCell(`F${tr}`).value = { formula: `D${tr}-E${tr}`, result: a.owe };
      for (let k = 1; k <= 6; k++) { const x = ws.getRow(tr).getCell(k); x.font = FB; x.border = BD; x.fill = fill("FBE6E3") } ["D", "E", "F"].forEach(k => ws.getCell(`${k}${tr}`).numFmt = "#,##0.00");
      [12, 8, 40, 15, 15, 15].forEach((w, i) => ws.getColumn(i + 1).width = w);
      await shareFile(new Blob([await wb.xlsx.writeBuffer()], { type: XT }), `对账单_${safe(c.name)}_${mmdd(today())}.xlsx`); msg("已导出对账单。", "ok");
    } catch (e) { console.error(e); msg("导出失败，请再试一次。", "err") }
  }

  /* ---------- 渲染 ---------- */
  // 只换掉页面上别的部分，正在打字的搜索框本身不动（不重建、不失去焦点，输入法不会被打断）
  function morph(o, n, keep) {
    if (o.nodeName !== n.nodeName) return false;
    const oc = [...o.childNodes], nc = [...n.childNodes];
    for (let i = 0; i < Math.max(oc.length, nc.length); i++) { const a = oc[i], b = nc[i];
      if (a && b) { if (a === keep) continue; if (a.contains && a.contains(keep)) { if (!morph(a, b, keep)) return false } else o.replaceChild(b, a) }
      else if (b) o.appendChild(b); else if (a) { if (a.contains && a.contains(keep)) return false; o.removeChild(a) } }
    return true;
  }
  function render() {
    for (const b of $("bar").querySelectorAll("button")) b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false");
    const old = $("msg"), om = old ? [old.textContent, old.className] : null, fq = document.activeElement && document.activeElement.id === "q", fpq = document.activeElement && document.activeElement.id === "pq";
    const html = `<div style="display:flex;flex-direction:column;gap:12px">${tab === "search" ? viewSearch() : tab === "home" ? viewHome() : tab === "cust" ? (sel ? viewCust() : viewCustList()) : (tab === "quote" || tab === "order") ? (ed ? viewEditor() : viewDocList(tab)) : tab === "acct" ? viewAcct() : tab === "price" ? viewPrice() : tab === "prod" ? viewProd() : viewMore()}</div>`;
    const act0 = document.activeElement, keep = (fq || fpq) && act0 && $("app").contains(act0) ? act0 : null;
    if (keep) { const tmp = document.createElement($("app").nodeName); tmp.innerHTML = html; if (!morph($("app"), tmp, keep)) $("app").innerHTML = html } else $("app").innerHTML = html;
    if (om && $("msg")) { $("msg").textContent = om[0]; $("msg").className = om[1] }
    if (ed) paintTotals();
    if (!keep && fq && $("q")) { const i = $("q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length) }
    if (!keep && fpq && $("pq")) { const i = $("pq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length) }
  }
  const app = $("app");
  // 列表搜索框（客户、报价、订单、账款、产品）：拼音拼字时不刷新，停手 0.3 秒后再刷新，免得每打一个字就跳
  let appComp = false, lqT = null;
  app.addEventListener("compositionstart", () => { appComp = true });
  app.addEventListener("compositionend", e => { appComp = false; const t = e.target; if (t.id === "q" || t.id === "pq") { clearTimeout(lqT); lqT = setTimeout(() => { if (t.id === "q") q = t.value; else pq = t.value; render() }, 300) } });
  app.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "q" || t.id === "pq") { if (appComp || e.isComposing) return; clearTimeout(lqT); lqT = setTimeout(() => { if (t.id === "q") q = t.value; else pq = t.value; render() }, 300); return }
    if (ed) {
      const tr = t.closest("tr[data-i]"); if (tr && t.dataset.f && t.dataset.f !== "color" && t.dataset.f !== "unit") { const l = ed.lines[+tr.dataset.i]; l[t.dataset.f] = t.dataset.f === "m" ? t.value.toUpperCase() : t.value; if (t.dataset.f === "price") l.man = true;
        if ((t.dataset.f === "L" || t.dataset.f === "w") && isPc(l) && !l.man) { autoPrice(l); const pi = tr.querySelector('[data-f="price"]'); if (pi) pi.value = l.price || "" }
        paintTotals(); return }
      if (t.id === "e_d") ed.d = t.value; else if (t.id === "e_note") ed.note = t.value;
      else if (t.id === "lnQ") { const k = norm(t.value), box = $("lnRes"); if (!k) { box.hidden = true; return }
        const hits = catalog().filter(c => norm(c.m).includes(k)).sort((a, b) => (norm(a.m) === k ? -1 : 0) - (norm(b.m) === k ? -1 : 0) || (a.m < b.m ? -1 : a.m > b.m ? 1 : a.L - b.L)).slice(0, 40);
        box.innerHTML = hits.map(c => `<button type="button" data-spec="${esc(JSON.stringify(c))}">${esc(c.m)} · <span style="color:var(--len)">${c.L} 米</span> · <span style="color:var(--wt)">支重 ${c.w}</span>${(() => { const p = lastPrice(ed.cust, c); return p ? ` · <span class="sub">上次 ${n0(p)} 元/吨</span>` : "" })()}</button>`).join("") || `<div class="sub" style="padding:8px 10px">型号库里没有，点“手动加一行”自己填。</div>`; box.hidden = false }
    }
    if (shipEd) { if (t.dataset.sq) shipEd.q[t.dataset.sq] = t.value; else if (t.id === "sp_d") shipEd.d = t.value; else if (t.id === "sp_car") shipEd.car = t.value; else if (t.id === "sp_driver") shipEd.driver = t.value; else if (t.id === "sp_kg") shipEd.kg = t.value }
    if (tab === "price" && stdEd) { if (t.id === "sd_billet") stdEd.billet = t.value; else if (t.dataset.scn !== undefined) stdEd.colors[+t.dataset.scn].name = t.value; else if (t.dataset.scf !== undefined) stdEd.colors[+t.dataset.scf].fee = t.value }
    if (tab === "price" && igEd) { if (t.id === "ig_d") igEd.d = t.value; else if (t.id === "ig_p") igEd.price = t.value }
    if (payEd) { if (t.id === "py_amt") payEd.amt = t.value; else if (t.id === "py_d") payEd.d = t.value; else if (t.id === "py_way") payEd.way = t.value; else if (t.id === "py_note") payEd.note = t.value }
  });
  app.addEventListener("change", e => {
    const t = e.target;
    if (ed && t.id === "e_cust") { ed.cust = t.value; $("e_newc_f").hidden = t.value !== "__new"; if (t.value === "__new") { reprice(); paintTotals(); $("e_newc").focus() } else { reprice(); render() } }
    if (ed && t.id === "e_d") { ed.d = t.value; reprice(); render() }
    if (ed && t.dataset.f === "unit") { const tr = t.closest("tr[data-i]"), l = ed.lines[+tr.dataset.i]; switchUnit(l, t.value); render() }
    if (ed && t.dataset.f === "color") { const tr = t.closest("tr[data-i]"), l = ed.lines[+tr.dataset.i]; l.color = t.value; autoPrice(l); render() }
    if (payEd && t.id === "py_cust") payEd.cust = t.value;
  });
  app.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "lnQ") { const b = $("lnRes").querySelector("[data-spec]"); if (b) { e.preventDefault(); b.click() } } });
  app.addEventListener("click", async e => {
    const t = e.target, b = t.closest("button, [data-go], [data-stmt], [data-pc], [data-pm], [data-pm-go]"); if (!b) return;
    const ds = b.dataset;
    if (ds.go) { if (ds.go === "quote" || ds.go === "order") { setTab(ds.go); openDoc(ds.go, ds.id); render() } else setTab(ds.go, ds.id); return }
    if (ds.stmt !== undefined) { setTab("acct", ds.stmt); return }
    if (ds.back) { setTab(ds.back); return }
    if (ds.gclear) { setTab(gBack); return }
    if (ds.qf) { qf = ds.qf; render(); return }
    if (ds.newCust) { setTab("cust", "new"); return }
    if (ds.saveCust) {
      const v = k => ($("cf_" + k).value || "").trim(), name = v("name"); if (!name) { msg("请填客户名称。", "err"); return }
      if (D.cust.some(c => c.name === name && c.id !== ds.saveCust)) { msg("已经有同名客户了。", "err"); return }
      const id = ds.saveCust === "new" ? uid() : ds.saveCust, c = Object.assign({}, custOf(id) || { id }, { name, contact: v("contact"), phone: v("phone"), addr: v("addr"), pay: v("pay"), note: v("note") });
      if (await act([(ds.saveCust === "new" ? "新建客户：" : "修改客户资料：") + name], () => ST.cust.put(c), "已保存客户资料。")) { sel = id; render() } return }
    if (ds.delCust) { const id = ds.delCust; if (D.order.some(o => o.cust === id) || D.ship.some(s => s.cust === id) || D.pay.some(p => p.cust === id) || D.quote.some(x => x.cust === id)) { msg("这个客户有报价、订单、发货或收款记录，不能删除。", "err"); return }
      if (armDel !== "c" + id) { armDel = "c" + id; render(); return } armDel = null; const fl = D.follow.filter(f => f.cust === id).map(f => f.id);
      if (await act(["删除客户：" + custName(id)].concat(fl.length ? [`连同 ${fl.length} 条跟进记录`] : []), async () => { if (fl.length) await ST.follow.delMany(fl); await ST.cust.del(id) }, "已删除客户。")) setTab("cust"); return }
    if (ds.addFollow) { const text = ($("fu_text").value || "").trim(), next = $("fu_next").value || ""; if (!text) { msg("请填跟进内容。", "err"); $("fu_text").focus(); return }
      const f = { id: uid(), cust: ds.addFollow, d: today(), t: Date.now(), text, next }; await act([`跟进 ${custName(f.cust)}：${text}` + (next ? `（下次 ${md(next)}）` : "")], () => ST.follow.put(f), "已记下跟进。"); return }
    if (ds.newDoc) { const k = ds.newDoc; tab = k; LS.set("xs_tab", k); sel = null; shipEd = null; ed = newDoc(k, ds.cust || ""); render(); return }
    if (ds.addBlank) { addLine(null); return }
    if (ds.spec) { addLine(JSON.parse(ds.spec)); return }
    if (ds.rm !== undefined) { ed.lines.splice(+ds.rm, 1); render(); return }
    if (ds.dunit) { ed.unit = ds.dunit; const sh = ed.kind === "order" ? shippedBy(ed.id) : {}; ed.lines.forEach(l => { if (!sh[l.lid]) switchUnit(l, ds.dunit) }); render(); return }
    if (ds.auto !== undefined) { const l = ed.lines[+ds.auto]; delete l.man; delete l.hint; autoPrice(l); if (!has(l.ing)) msg("还没有当日铝锭价，不能自动算。", "err"); render(); return }
    if (ds.saveDoc) { await saveDoc(); return }
    if (ds.delDoc) { const x = ed, isQ = x.kind === "quote";
      if (!isQ && D.ship.some(s => s.order === x.id)) { msg("这个订单已经有发货记录，不能删除。要删的话先把发货撤销。", "err"); return }
      if (isQ && x.order) { msg("这张报价单已经转成订单，不能删除。", "err"); return }
      if (armDel !== "d" + x.id) { armDel = "d" + x.id; render(); return } armDel = null;
      const qq = !isQ && x.quote ? D.quote.find(v => v.id === x.quote && v.order === x.id) : null;
      if (await act([`删除${isQ ? "报价单" : "订单"} ${x.no}：${custName(x.cust)}`].concat(qq ? [`报价单 ${qq.no} 改回“未转订单”`] : []), async () => { await ST[x.kind].del(x.id); if (qq) await ST.quote.update(qq.id, { order: "" }) }, "已删除。")) setTab(x.kind); return }
    if (ds.toOrder) { const x = ed; if (x.order) return; ed = newDoc("order", x.cust, x); tab = "order"; LS.set("xs_tab", "order"); render(); msg("已按报价单生成新订单，检查一下后点“保存订单”。", "ok"); return }
    if (ds.xl) { xlDoc(ed.kind, ed); return }
    if (ds.newShip) { shipEd = { order: ds.newShip, d: today(), car: "", driver: "", kg: "", q: {} }; render(); setTimeout(() => { const f = document.querySelector("[data-sq]:not([disabled])"); if (f) f.scrollIntoView({ block: "center" }) }, 30); return }
    if (ds.cancelShip) { shipEd = null; render(); return }
    if (ds.saveShip) { await saveShip(); return }
    if (ds.shipXl) { const s = D.ship.find(v => v.id === ds.shipXl); if (s) xlShip(s); return }
    if (ds.delShip) { const s = D.ship.find(v => v.id === ds.delShip); if (!s) return; if (armDel !== "s" + s.id) { armDel = "s" + s.id; render(); return } armDel = null;
      if (await act([`撤销发货 ${s.no}：${custName(s.cust)}，${n0(linesQ(s.lines))} 支`, `应收减少 ${yuan(linesAmt(s.lines))}`], () => ST.ship.del(s.id), "已撤销这次发货。")) { openDoc("order", s.order); render() } return }
    if (ds.newPay !== undefined) { payEd = { cust: ds.newPay || "", d: today(), amt: "", way: "", note: "" }; tab = "acct"; LS.set("xs_tab", "acct"); render(); setTimeout(() => { const i = $(payEd && payEd.cust ? "py_amt" : "py_cust"); if (i) i.focus() }, 30); return }
    if (ds.cancelPay) { payEd = null; render(); return }
    if (ds.savePay) { const p = payEd, amt = r2(parseFloat(String(p.amt).replace(/[,，¥\s]/g, ""))); if (!p.cust) { msg("请选客户。", "err"); return } if (!(amt > 0)) { msg("请填收款金额。", "err"); return }
      const x = { id: uid(), cust: p.cust, d: p.d || today(), amt, way: p.way.trim(), note: p.note.trim(), t: Date.now() }, a = account(p.cust);
      if (await act([`收款：${custName(x.cust)} ${yuan(amt)}（${x.way || "未写方式"}）`, `欠款 ${yuan(a.owe)} → ${yuan(r2(a.owe - amt))}`], () => ST.pay.put(x), `已登记收款 ${yuan(amt)}。`)) { payEd = null; sel = x.cust; render() } return }
    if (ds.delPay) { const p = D.pay.find(v => v.id === ds.delPay); if (!p) return; if (armDel !== "p" + p.id) { armDel = "p" + p.id; render(); return } armDel = null;
      await act([`删除收款：${custName(p.cust)} ${md(p.d)} ${yuan(p.amt)}`], () => ST.pay.del(p.id), "已删除这笔收款。"); return }
    if (ds.stmtXl) { xlStmt(ds.stmtXl); return }
    // 价格
    if (ds.goPrice) { setTab("price", ds.goPrice); return }
    if (ds.pv) { pView = ds.pv; render(); return }
    if (ds.pc) { pcEd = ds.pc; render(); window.scrollTo(0, 0); return }
    if (ds.cancelPc) { pcEd = null; render(); return }
    if (ds.clearPc) { document.querySelectorAll("#pc_billet,[data-pcf]").forEach(i => i.value = ""); return }
    if (ds.savePc) { const c = custOf(ds.savePc); if (!c) return; const bv = ($("pc_billet").value || "").trim(), cf = {}; let bad = "";
      if (bv && !(parseFloat(bv) >= 0)) bad = "胚料加工费";
      document.querySelectorAll("[data-pcf]").forEach(i => { const v = i.value.trim(); if (!v) return; if (!(parseFloat(v) >= 0)) bad = bad || colorName(i.dataset.pcf); else cf[i.dataset.pcf] = parseFloat(v) });
      if (bad) { msg(bad + " 要填数字。", "err"); return }
      const billet = bv ? parseFloat(bv) : "", items = [`${c.name} 定价：胚料费 ${bv ? n0(billet) : "用标准价"}`].concat(P.colors.map(k => has(cf[k.id]) || (c.cfee && has(c.cfee[k.id])) ? `${k.name} ${has(cf[k.id]) ? n0(cf[k.id]) : "用标准价"}` : "").filter(Boolean));
      if (await act(items, () => ST.cust.update(c.id, { billet, cfee: cf }), `已保存 ${c.name} 的定价。`)) { pcEd = null; render() } return }
    if (ds.saveIg) { const d = igEd.d || today(), v = parseFloat(String(igEd.price).replace(/[,，\s]/g, "")); if (!(v > 0)) { msg("请填铝锭价。", "err"); return } const old = D.ingot.find(x => x.d === d);
      if (await act([`${d} 铝锭价：${old ? n0(old.price) + " → " : ""}${n0(v)} 元/吨`, "已经存了的报价单、订单不变；以后开单按新价算"], () => ST.ingot.put({ id: d, d, price: v, t: Date.now() }), `已保存 ${md(d)} 铝锭价 ${n0(v)}。`)) { igEd = null; render() } return }
    if (ds.delIg) { const x = D.ingot.find(v => v.id === ds.delIg); if (!x) return; if (armDel !== "i" + x.id) { armDel = "i" + x.id; render(); return } armDel = null; await act([`删除 ${x.d} 的铝锭价 ${n0(x.price)}`], () => ST.ingot.del(x.id), "已删除。"); return }
    if (ds.addColor) { stdEd.colors.push({ id: uid(), name: "", fee: "" }); render(); const ins = document.querySelectorAll("[data-scn]"); if (ins.length) ins[ins.length - 1].focus(); return }
    if (ds.rmColor !== undefined) { stdEd.colors.splice(+ds.rmColor, 1); render(); return }
    if (ds.saveStd) { const bv = parseFloat(stdEd.billet); if (String(stdEd.billet).trim() && !(bv >= 0)) { msg("胚料加工费要填数字。", "err"); return }
      const cl = []; for (const c of stdEd.colors) { const n = String(c.name || "").trim(); if (!n) continue; const f = String(c.fee).trim() ? parseFloat(c.fee) : 0; if (!(f >= 0)) { msg(`${n} 的加工费要填数字。`, "err"); return } if (cl.some(x => x.name === n) || n === RAW.name) { msg(`颜色“${n}”重复了。`, "err"); return } cl.push({ id: c.id, name: n, fee: f }) }
      const ch = []; if ((bv || 0) !== (+P.billet || 0)) ch.push(`标准胚料加工费 ${n0(P.billet)} → ${n0(bv || 0)}`);
      cl.forEach(c => { const o = P.colors.find(x => x.id === c.id); if (!o) ch.push(`新增颜色 ${c.name}：${n0(c.fee)}`); else if (o.name !== c.name || +o.fee !== c.fee) ch.push(`${o.name}${o.name !== c.name ? " 改名为 " + c.name : ""}：${n0(o.fee)} → ${n0(c.fee)}`) });
      P.colors.forEach(o => { if (!cl.some(c => c.id === o.id)) ch.push(`删除颜色 ${o.name}`) });
      if (!ch.length) { msg("没有改动。"); return }
      if (await act(ch, async () => { await KV.set("billet", bv || 0); await KV.set("colors", cl) }, "已保存标准加工费。")) { stdEd = null; render() } return }
    if (ds.priceXl) { xlPrice(); return }
    // 产品
    if (ds.pmGo) { setTab("prod"); pModel = ds.pmGo; render(); return }
    if (ds.pm) { pModel = ds.pm; pEdit = null; render(); window.scrollTo(0, 0); return }
    if (ds.pmBack) { pModel = null; pEdit = null; render(); return }
    if (ds.prodNew !== undefined) { pEdit = { isNew: true, m: ds.prodNew || "" }; render(); setTimeout(() => { const i = $(ds.prodNew ? "pf_L" : "pf_m"); if (i) i.focus() }, 30); return }
    if (ds.prodEdit) { const x = D.prod.find(v => v.id === ds.prodEdit); if (x) { pEdit = Object.assign({}, x); render(); window.scrollTo(0, 0) } return }
    if (ds.prodCancel) { pEdit = null; render(); return }
    if (ds.prodSave) { const m = ($("pf_m").value || "").trim().toUpperCase(), L = parseFloat($("pf_L").value), w = parseFloat($("pf_w").value), note = ($("pf_note").value || "").trim();
      if (!m || !(L > 0) || !(w > 0)) { msg("型号、长度、理论支重都要填对。", "err"); return }
      const id = specKey(m, L, w), old = pEdit.isNew ? null : D.prod.find(v => v.id === pEdit.id);
      if (D.prod.some(v => v.id === id && (!old || v.id !== old.id))) { msg("这个规格已经有了。", "err"); return }
      const doc = { id, m, L, w, band: bandOf(w), note };
      if (await act([`${old ? "修改规格：" + old.m + " " + old.L + "米 " + old.w + " → " : "新增规格："}${m} ${L}米 ${w}`], async () => { if (old && old.id !== id) await ST.prod.del(old.id); await ST.prod.put(doc) }, "已保存规格。")) { pEdit = null; pModel = m; render() } return }
    if (ds.prodDel) { const x = D.prod.find(v => v.id === ds.prodDel); if (!x) return; if (armDel !== "g" + x.id) { armDel = "g" + x.id; render(); return } armDel = null;
      if (await act([`删除规格：${x.m} ${x.L}米 ${x.w}`, "已经开了的单子不受影响"], () => ST.prod.del(x.id), "已删除规格。")) { pEdit = null; render() } return }
    if (ds.prodQuote) { const x = D.prod.find(v => v.id === ds.prodQuote); if (!x) return; tab = "quote"; LS.set("xs_tab", "quote"); ed = newDoc("quote", ""); addLine({ m: x.m, L: +x.L, w: +x.w }); msg("已按这个规格开了一张新报价单，先选客户。", "ok"); return }
    if (ds.prodImp) { prodFile.click(); return }
    if (ds.prodImpNo) { prodPlan = null; render(); return }
    if (ds.prodImpOk) { const p = prodPlan, nw = p.specs.filter(x => !D.prod.some(y => y.id === x.id)), up = p.specs.filter(x => { const o = D.prod.find(y => y.id === x.id); return o && o.band !== x.band });
      if (await act([`导入产品大数据：${p.name}`, `新增 ${nw.length} 个规格，更新 ${up.length} 个支重区间`], async () => { if (nw.length) await ST.prod.putMany(nw); for (const x of up) await ST.prod.update(x.id, { band: x.band }) }, `已导入：新增 ${nw.length} 个规格。`)) { prodPlan = null; render() } return }
    if (ds.prodXl) { xlProd(); return }
    if (ds.priceImp) { impFile.click(); return }
    if (ds.impOk) { await applyImp(); return }
    if (ds.impNo) { impPlan = null; render(); return }
    // 更多
    if (b.id === "mLog") { if (logList) { logList = null; render() } else { try { logList = await Cloud.boss.log(30) } catch (err) { msg("读取操作记录失败。", "err") } render() } return }
    if (b.id === "mUndo") { Cloud.boss.undoLast().then(async t2 => { await loadAll(); logList = logList ? await Cloud.boss.log(30) : null; render(); msg(t2, /^已撤销/.test(t2) ? "ok" : "err") }).catch(() => { }); return }
    if (b.id === "mLock") { Cloud.boss.lock(); render(); msg("已锁上。下次改动要重新输授权码。", "ok"); return }
    if (b.id === "mPin") { Cloud.boss.changePin().then(() => render()); return }
    if (b.id === "mForgot") { const pw = prompt("忘记授权码：请输入你的登录密码，验证后重新设置授权码。"); if (pw) Cloud.boss.forgot(pw).catch(() => msg("登录密码不对，或者网络不通。", "err")); return }
    if (b.id === "mOut") { Cloud.signOut(); return }
    if (b.id === "mBak") { try { const data = { app: "petrjason-xiaoshou", v: 1, at: new Date().toISOString() }; for (const k of Object.keys(ST)) data[k] = await ST[k].allOnce(); await shareFile(new Blob([JSON.stringify(data)], { type: "application/json" }), `销售备份_${today().replace(/-/g, "")}.json`); msg(`已生成备份：${data.cust.length} 个客户、${data.order.length} 张订单、${data.ship.length} 次发货、${data.pay.length} 笔收款。`, "ok") } catch (err) { msg("备份失败，请再试一次。", "err") } return }
    if (b.id === "mRes") { resFile.click(); return }
  });
  const resFile = document.createElement("input"); resFile.type = "file"; resFile.accept = ".json,application/json"; resFile.hidden = true; document.body.appendChild(resFile);
  resFile.addEventListener("change", async () => {
    const f = resFile.files && resFile.files[0]; resFile.value = ""; if (!f) return;
    let d; try { d = JSON.parse(await f.text()); if (!d || d.app !== "petrjason-xiaoshou") throw 0 } catch (e) { msg("这个文件不是销售 App 的备份，没有恢复。", "err"); return }
    const ks = Object.keys(ST).filter(k => Array.isArray(d[k]));
    await act([`从备份恢复销售数据：${ks.map(k => k + " " + d[k].length + " 条").join("，")}`, "备份里有的记录会覆盖现在的同一条，备份里没有的不动"], async () => { for (const k of ks) await ST[k].putMany(d[k].filter(x => x && x.id)) }, "已从备份恢复。");
  });

  let rt = null;
  Cloud.onChange(() => { clearTimeout(rt); rt = setTimeout(async () => { const a = document.activeElement; if (a && a !== document.body && app.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return; await loadAll(); render() }, 400) });
  (async () => { try { await Cloud.ready } catch (e) { } await loadAll(); setTab(TABS.some(x => x[0] === tab) ? tab : "home") })();
})();
