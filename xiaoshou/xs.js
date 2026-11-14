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
  const amtOf = l => r2(kgOf(l) / 1000 * (+l.price || 0));
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const days = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
  const isCancel = e => !!(e && (e.cancelled || e.code === "cancelled"));
  const LS = { get: (k, d) => { try { return localStorage.getItem(k) || d } catch (e) { return d } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch (e) { } } };
  const BETA = !!window.CLOUD_SUFFIX;
  if (BETA) { $("title").innerHTML = 'PETRJASON 销售<small>测试版</small>'; document.title = "PETRJASON 销售（测试版）" }

  /* ---------- 数据 ---------- */
  const ST = { cust: Cloud.store("xs_cust"), follow: Cloud.store("xs_follow"), quote: Cloud.store("xs_quote"), order: Cloud.store("xs_order"), ship: Cloud.store("xs_ship"), pay: Cloud.store("xs_pay") };
  const D = { cust: [], follow: [], quote: [], order: [], ship: [], pay: [] };
  async function loadAll() {
    try { const ks = Object.keys(ST); const vs = await Promise.all(ks.map(k => ST[k].all())); ks.forEach((k, i) => D[k] = vs[i]) }
    catch (e) { console.error(e); $("banner").hidden = false; $("banner").textContent = "读取云端数据失败，请检查网络后刷新页面。" }
    D.cust.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }
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
    const m = new Map(); (window.BASE_CATALOG || []).forEach(x => m.set(x.m + "|" + x.L + "|" + x.w, { m: x.m, L: x.L, w: x.w }));
    [...D.quote, ...D.order].forEach(d => (d.lines || []).forEach(l => { if (l.m && l.L && l.w) m.set(l.m + "|" + l.L + "|" + l.w, { m: l.m, L: +l.L, w: +l.w }) }));
    return [...m.values()];
  }
  function lastPrice(cid, l) {
    const docs = [...D.order, ...D.quote].filter(d => d.d).sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : (b.t || 0) - (a.t || 0)));
    const find = f => { for (const d of docs) { const x = (d.lines || []).find(y => y.price > 0 && f(d, y)); if (x) return +x.price } return 0 };
    const same = y => norm(y.m) === norm(l.m) && +y.L === +l.L && +y.w === +l.w;
    return (cid && find((d, y) => d.cust === cid && same(y))) || (cid && find((d, y) => d.cust === cid && norm(y.m) === norm(l.m))) || find((d, y) => same(y)) || 0;
  }

  /* ---------- 外框 ---------- */
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    cust: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
    quote: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
    order: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    acct: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
  };
  const TABS = [["home", "首页"], ["cust", "客户"], ["quote", "报价"], ["order", "订单"], ["acct", "账款"], ["more", "更多"]];
  $("bar").innerHTML = `<div class="in">${TABS.map(([k, t]) => `<button type="button" data-tab="${k}"><svg viewBox="0 0 24 24">${ICON[k]}</svg>${t}</button>`).join("")}</div>`;
  let tab = LS.get("xs_tab", "home"), sel = null, ed = null, armDel = null, logList = null, q = "", qf = "all", shipEd = null, payEd = null;
  function setTab(t, s) { tab = t; sel = s || null; ed = null; shipEd = null; payEd = null; armDel = null; LS.set("xs_tab", t); for (const b of $("bar").querySelectorAll("button")) b.setAttribute("aria-current", b.dataset.tab === t ? "page" : "false"); render(); window.scrollTo(0, 0) }
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
      <section class="panel"><h2>客户资料</h2>${custForm(c)}<div class="acts"><button type="button" class="btn primary" data-save-cust="${c.id}">保存资料</button>
        <button type="button" class="btn danger" data-del-cust="${c.id}">${armDel === "c" + c.id ? "再点一次确认删除" : "删除客户"}</button></div><div class="sub">有订单、发货或收款的客户不能删除。</div></section>
    </div>`;
  }

  /* ---------- 报价单 / 订单 编辑 ---------- */
  function newDoc(kind, cid, from) {
    const d = today(), list = kind === "quote" ? D.quote : D.order;
    return { id: uid(), kind, isNew: true, no: nextNo(kind === "quote" ? "BJ" : "DD", list, d), d, cust: cid || "", note: from ? from.note || "" : "", quote: from ? from.id : "", lines: from ? from.lines.map(l => Object.assign({}, l, { lid: uid() })) : [] };
  }
  function openDoc(kind, id) { const x = (kind === "quote" ? D.quote : D.order).find(v => v.id === id); if (!x) return; ed = JSON.parse(JSON.stringify(x)); ed.kind = kind; ed.isNew = false }
  function viewEditor() {
    const x = ed, isQ = x.kind === "quote", sh = isQ ? {} : shippedBy(x.id), saved = !x.isNew, nm = isQ ? "报价单" : "订单";
    const cOpts = `<option value="">— 选客户 —</option>` + D.cust.map(c => `<option value="${c.id}"${c.id === x.cust ? " selected" : ""}>${esc(c.name)}</option>`).join("") + `<option value="__new">＋ 新客户…</option>`;
    const rows = x.lines.map((l, i) => { const s = sh[l.lid] || 0; return `<tr data-i="${i}"><td class="ct">${i + 1}</td>
      <td><input class="m" data-f="m" value="${esc(l.m || "")}" autocomplete="off" spellcheck="false"${s ? " disabled" : ""}></td><td><input data-f="L" inputmode="decimal" value="${l.L ?? ""}"${s ? " disabled" : ""}></td><td><input data-f="w" inputmode="decimal" value="${l.w ?? ""}"${s ? " disabled" : ""}></td>
      <td><input data-f="q" inputmode="numeric" value="${l.q ?? ""}"></td><td><input data-f="price" inputmode="decimal" value="${l.price || ""}" placeholder="${l.hint ? "上次 " + l.hint : ""}"></td>
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
      <div class="tw"><table class="g"><thead><tr><th>#</th><th>型号</th><th>长度(米)</th><th>理论支重</th><th>支数</th><th>单价(元/吨)</th><th>理论重量(kg)</th><th>金额(元)</th>${isQ ? "" : "<th>已发(支)</th>"}<th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${isQ ? 9 : 10}" class="empty">还没有明细。在下面搜型号加一行。</td></tr>`}</tbody></table></div>
      <div class="tools"><input class="q" id="lnQ" placeholder="🔍 搜型号加一行，例如 7801" autocomplete="off" spellcheck="false" style="text-transform:uppercase"><button type="button" class="btn" data-add-blank="1">手动加一行</button></div>
      <div class="res" id="lnRes" hidden></div>
      <div class="tot" id="e_tot"></div>
      <div class="acts"><button type="button" class="btn primary" data-save-doc="1" style="min-width:140px">保存${nm}</button>${saved ? `<button type="button" class="btn danger" data-del-doc="1">${armDel === "d" + x.id ? "再点一次确认删除" : "删除"}</button>` : ""}</div>
      <div class="sub">金额 = 理论支重 ÷ 6 × 长度 × 支数 ÷ 1000 × 单价（元/吨）。${isQ ? "" : "已经发过货的行，型号、长度、支重不能改，支数不能少于已发。"}</div>
    </section>${!isQ && saved ? viewShipsOf(x) : ""}`;
  }
  function paintTotals() {
    if (!ed || !$("e_tot")) return;
    ed.lines.forEach((l, i) => { const k = $("kg_" + i), a = $("am_" + i); if (k) k.textContent = n1(kgOf(l)); if (a) a.textContent = yuan(amtOf(l)) });
    $("e_tot").innerHTML = `<span>${ed.lines.length} 行</span><span><b>${n0(linesQ(ed.lines))}</b> 支</span><span><b>${n1(linesKg(ed.lines))}</b> kg（${n3(linesKg(ed.lines) / 1000)} 吨）</span><span>合计 <b class="M">${yuan(linesAmt(ed.lines))}</b></span>`;
  }
  function addLine(spec) { const l = { lid: uid(), m: spec ? spec.m : "", L: spec ? spec.L : "", w: spec ? spec.w : "", q: "", price: 0 }; const p = spec ? lastPrice(ed.cust, l) : 0; if (p) { l.price = p; l.hint = p } ed.lines.push(l); render(); const tr = document.querySelector(`tr[data-i="${ed.lines.length - 1}"]`); if (tr) { const i = tr.querySelector(spec ? '[data-f="q"]' : '[data-f="m"]'); if (i) i.focus() } }
  function checkDoc() {
    const x = ed; if (!x.cust) return "请选客户。"; if (!x.lines.length) return "请至少加一行明细。";
    const sh = x.kind === "order" ? shippedBy(x.id) : {};
    for (const [i, l] of x.lines.entries()) {
      if (!l.m || !(+l.L > 0) || !(+l.w > 0)) return `第 ${i + 1} 行：型号、长度、支重都要填。`;
      if (!(+l.q > 0)) return `第 ${i + 1} 行（${l.m}）：请填支数。`;
      if (!(+l.price > 0)) return `第 ${i + 1} 行（${l.m}）：请填单价（元/吨）。`;
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
    const doc = { id: x.id, no: x.no, d: x.d, cust: newC ? newC.id : x.cust, note: x.note || "", lines: x.lines.map(l => ({ lid: l.lid, m: String(l.m).trim().toUpperCase(), L: +l.L, w: +l.w, q: +l.q, price: +l.price })), t: x.t || Date.now() };
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
      <div class="tw"><table class="g"><thead><tr><th>型号</th><th>长度</th><th>支重</th><th>订(支)</th><th>已发(支)</th><th>这次发(支)</th></tr></thead><tbody>${o.lines.map(l => { const left = (+l.q) - (sh[l.lid] || 0); return `<tr><td class="tl B">${esc(l.m)}</td><td class="L">${l.L}</td><td class="W">${l.w}</td><td>${n0(l.q)}</td><td>${sh[l.lid] ? n0(sh[l.lid]) : ""}</td><td style="width:130px"><input data-sq="${l.lid}" inputmode="numeric" value="${shipEd.q[l.lid] ?? (left > 0 ? left : "")}"${left > 0 ? "" : " disabled"}></td></tr>` }).join("")}</tbody></table></div>
      <div class="acts"><button type="button" class="btn primary" data-save-ship="1">确认发货</button><button type="button" class="btn" data-cancel-ship="1">取消</button></div></div>`;
  }
  async function saveShip() {
    const o = D.order.find(v => v.id === shipEd.order); if (!o) return;
    const sh = shippedBy(o.id), lines = [];
    for (const l of o.lines) { const v = parseInt(String(shipEd.q[l.lid] ?? "").replace(/[^\d]/g, ""), 10); if (!(v > 0)) continue; const left = (+l.q) - (sh[l.lid] || 0); if (v > left) { msg(`${l.m}（${l.L}米）只剩 ${n0(left)} 支没发，这次填了 ${n0(v)} 支。`, "err"); return } lines.push({ lid: l.lid, m: l.m, L: l.L, w: l.w, q: v, price: l.price }) }
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
    ws.mergeCells("A1:H1"); ws.getCell("A1").value = title; ws.getCell("A1").font = { name: "Arial", size: 18, bold: true }; ws.getCell("A1").alignment = { horizontal: "center" }; ws.getRow(1).height = 30;
    info.forEach((t, i) => { const c = ws.getCell(`${i % 2 ? "E" : "A"}${2 + Math.floor(i / 2)}`); c.value = t; c.font = F });
    const h0 = 3 + Math.ceil(info.length / 2), hr = ws.getRow(h0);
    ["序号", "型号", "长度(米)", "理论支重", "支数", "理论重量(kg)", "单价(元/吨)", "金额(元)"].forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = FH; c.fill = fill("305496"); c.border = BD; c.alignment = { horizontal: "center", vertical: "middle" } }); hr.height = 24;
    lines.forEach((l, i) => { const r = h0 + 1 + i, row = ws.getRow(r);
      [i + 1, l.m, +l.L, +l.w, +l.q, { formula: `D${r}/6*C${r}*E${r}`, result: kgOf(l) }, +l.price, { formula: `ROUND(F${r}/1000*G${r},2)`, result: amtOf(l) }].forEach((v, j) => { const c = row.getCell(j + 1); c.value = v; c.font = F; c.border = BD; c.alignment = { horizontal: j === 1 ? "left" : "center" } });
      ws.getCell(`C${r}`).numFmt = "0.00"; ws.getCell(`D${r}`).numFmt = "0.000"; ws.getCell(`E${r}`).numFmt = "#,##0"; ws.getCell(`F${r}`).numFmt = "#,##0.0"; ws.getCell(`G${r}`).numFmt = "#,##0.00"; ws.getCell(`H${r}`).numFmt = "#,##0.00" });
    const tr = h0 + 1 + lines.length, a = h0 + 1, b = tr - 1;
    ws.getCell(`A${tr}`).value = "合计"; ws.getCell(`E${tr}`).value = { formula: `SUM(E${a}:E${b})`, result: linesQ(lines) }; ws.getCell(`F${tr}`).value = { formula: `SUM(F${a}:F${b})`, result: linesKg(lines) }; ws.getCell(`H${tr}`).value = { formula: `SUM(H${a}:H${b})`, result: linesAmt(lines) };
    for (let c = 1; c <= 8; c++) { const x = ws.getRow(tr).getCell(c); x.font = FB; x.border = BD; x.fill = fill("D9E1F2") }
    ws.getCell(`E${tr}`).numFmt = "#,##0"; ws.getCell(`F${tr}`).numFmt = "#,##0.0"; ws.getCell(`H${tr}`).numFmt = "#,##0.00";
    let r = tr + 2; (foot || []).forEach(t => { ws.getCell(`A${r}`).value = t; ws.getCell(`A${r}`).font = F; r++ });
    ws.getCell(`A${r}`).value = "理论重量 = 理论支重 ÷ 6 × 长度 × 支数；金额 = 理论重量 ÷ 1000 × 单价（元/吨）。"; ws.getCell(`A${r}`).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF7F7F7F" } };
    [6, 16, 10, 10, 10, 14, 13, 15].forEach((w, i) => ws.getColumn(i + 1).width = w);
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
      const hr = ws.getRow(4); ["日期", "类型", "单号 / 说明", "应收增加(元)", "收款(元)", "余额(元)"].forEach((h, i) => { const x = hr.getCell(i + 1); x.value = h; x.font = FH; x.fill = fill("305496"); x.border = BD; x.alignment = { horizontal: "center" } });
      ev.forEach((e, i) => { const r = 5 + i, row = ws.getRow(r);
        [e.d, e.k === "ship" ? "发货" : "收款", e.k === "ship" ? `${e.x.no}（${linesQ(e.x.lines)} 支，${(linesKg(e.x.lines) / 1000).toFixed(3)} 吨）` : [e.x.way, e.x.note].filter(Boolean).join(" · "), e.inc || null, e.dec || null, { formula: i ? `F${r - 1}+D${r}-E${r}` : `D${r}-E${r}`, result: e.bal }].forEach((v, j) => { const x = row.getCell(j + 1); x.value = v; x.font = F; x.border = BD });
        ["D", "E", "F"].forEach(k => ws.getCell(`${k}${r}`).numFmt = "#,##0.00") });
      const tr = 5 + ev.length; ws.getCell(`A${tr}`).value = "合计"; ws.getCell(`D${tr}`).value = { formula: `SUM(D5:D${tr - 1})`, result: a.due }; ws.getCell(`E${tr}`).value = { formula: `SUM(E5:E${tr - 1})`, result: a.paid }; ws.getCell(`F${tr}`).value = { formula: `D${tr}-E${tr}`, result: a.owe };
      for (let k = 1; k <= 6; k++) { const x = ws.getRow(tr).getCell(k); x.font = FB; x.border = BD; x.fill = fill("D9E1F2") } ["D", "E", "F"].forEach(k => ws.getCell(`${k}${tr}`).numFmt = "#,##0.00");
      [12, 8, 40, 15, 15, 15].forEach((w, i) => ws.getColumn(i + 1).width = w);
      await shareFile(new Blob([await wb.xlsx.writeBuffer()], { type: XT }), `对账单_${safe(c.name)}_${mmdd(today())}.xlsx`); msg("已导出对账单。", "ok");
    } catch (e) { console.error(e); msg("导出失败，请再试一次。", "err") }
  }

  /* ---------- 渲染 ---------- */
  function render() {
    for (const b of $("bar").querySelectorAll("button")) b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false");
    const old = $("msg"), om = old ? [old.textContent, old.className] : null, fq = document.activeElement && document.activeElement.id === "q";
    $("app").innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${tab === "home" ? viewHome() : tab === "cust" ? (sel ? viewCust() : viewCustList()) : (tab === "quote" || tab === "order") ? (ed ? viewEditor() : viewDocList(tab)) : tab === "acct" ? viewAcct() : viewMore()}</div>`;
    if (om && $("msg")) { $("msg").textContent = om[0]; $("msg").className = om[1] }
    if (ed) paintTotals();
    if (fq && $("q")) { const i = $("q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length) }
  }
  const app = $("app");
  app.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "q") { q = t.value; render(); return }
    if (ed) {
      const tr = t.closest("tr[data-i]"); if (tr && t.dataset.f) { const l = ed.lines[+tr.dataset.i]; l[t.dataset.f] = t.dataset.f === "m" ? t.value.toUpperCase() : t.value; paintTotals(); return }
      if (t.id === "e_d") ed.d = t.value; else if (t.id === "e_note") ed.note = t.value;
      else if (t.id === "lnQ") { const k = norm(t.value), box = $("lnRes"); if (!k) { box.hidden = true; return }
        const hits = catalog().filter(c => norm(c.m).includes(k)).sort((a, b) => (norm(a.m) === k ? -1 : 0) - (norm(b.m) === k ? -1 : 0) || (a.m < b.m ? -1 : a.m > b.m ? 1 : a.L - b.L)).slice(0, 40);
        box.innerHTML = hits.map(c => `<button type="button" data-spec="${esc(JSON.stringify(c))}">${esc(c.m)} · <span style="color:var(--len)">${c.L} 米</span> · <span style="color:var(--wt)">支重 ${c.w}</span>${(() => { const p = lastPrice(ed.cust, c); return p ? ` · <span class="sub">上次 ${n0(p)} 元/吨</span>` : "" })()}</button>`).join("") || `<div class="sub" style="padding:8px 10px">型号库里没有，点“手动加一行”自己填。</div>`; box.hidden = false }
    }
    if (shipEd) { if (t.dataset.sq) shipEd.q[t.dataset.sq] = t.value; else if (t.id === "sp_d") shipEd.d = t.value; else if (t.id === "sp_car") shipEd.car = t.value; else if (t.id === "sp_driver") shipEd.driver = t.value; else if (t.id === "sp_kg") shipEd.kg = t.value }
    if (payEd) { if (t.id === "py_amt") payEd.amt = t.value; else if (t.id === "py_d") payEd.d = t.value; else if (t.id === "py_way") payEd.way = t.value; else if (t.id === "py_note") payEd.note = t.value }
  });
  app.addEventListener("change", e => {
    const t = e.target;
    if (ed && t.id === "e_cust") { ed.cust = t.value; $("e_newc_f").hidden = t.value !== "__new"; if (t.value === "__new") $("e_newc").focus(); else ed.lines.forEach(l => { if (!(+l.price > 0) && l.m) { const p = lastPrice(ed.cust, l); if (p) { l.price = p; l.hint = p } } }); if (t.value !== "__new") render() }
    if (payEd && t.id === "py_cust") payEd.cust = t.value;
  });
  app.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "lnQ") { const b = $("lnRes").querySelector("[data-spec]"); if (b) { e.preventDefault(); b.click() } } });
  app.addEventListener("click", async e => {
    const t = e.target, b = t.closest("button, [data-go], [data-stmt]"); if (!b) return;
    const ds = b.dataset;
    if (ds.go) { if (ds.go === "quote" || ds.go === "order") { setTab(ds.go); openDoc(ds.go, ds.id); render() } else setTab(ds.go, ds.id); return }
    if (ds.stmt !== undefined) { setTab("acct", ds.stmt); return }
    if (ds.back) { setTab(ds.back); return }
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
