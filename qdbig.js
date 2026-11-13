/* 产品大数据库 Excel（和以前每月发的“产品大数据库_YYYY-MM.xlsx”同样的 13 张表）。
   QDBIG.build(ExcelJS, records, {charts:true}) → ArrayBuffer；records = 所有天的盘点记录 */
(function (root) {
  const ST = ["已入库", "包装中", "刚生产"];
  const A = () => root.QDA;
  const argb = c => ({ argb: "FF" + c });
  const fill = c => ({ type: "pattern", pattern: "solid", fgColor: argb(c) });
  const th = { style: "thin", color: argb("BFBFBF") }, BD = { top: th, left: th, bottom: th, right: th };
  const F = { name: "Arial", size: 10 }, FB = { name: "Arial", size: 10, bold: true }, FH = { name: "Arial", size: 10, bold: true, color: argb("FFFFFF") };
  const CA = { horizontal: "center", vertical: "middle", wrapText: true };
  const kg = (w, L, q) => w / 6 * L * q;
  const g = x => String(+x);
  const CL = n => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s };
  const month = d => d.slice(0, 7);
  const fx = (formula, result) => ({ formula, result });
  function head(ws, cols, row, h) { cols.forEach((c, i) => { const x = ws.getCell(row || 1, i + 1); x.value = c; x.font = FH; x.fill = fill("305496"); x.border = BD; x.alignment = CA }); ws.getRow(row || 1).height = h || 32 }
  function body(ws, row, vals, fmts, bold, bg) {
    vals.forEach((v, i) => { const x = ws.getCell(row, i + 1); x.value = v === undefined ? null : v; x.font = bold ? FB : F; x.border = BD; x.alignment = { horizontal: "center", vertical: "middle" }; if (bg) x.fill = fill(bg); if (fmts && fmts[i]) x.numFmt = fmts[i] });
  }
  const widths = (ws, a) => a.forEach((w, i) => { ws.getColumn(i + 1).width = w });
  const freeze = (ws, x, y) => { ws.views = [{ state: "frozen", xSplit: x, ySplit: y }] };

  /* ---- 画图（canvas → PNG，放进 Excel；Excel 里看到的是图片） ---- */
  function chartPNG(o) {
    if (typeof document === "undefined") return null;
    const W = o.w || 900, H = o.h || 360, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.font = "bold 18px Arial, sans-serif"; x.fillStyle = "#222"; x.fillText(o.title, 16, 28);
    const pl = 80, pr = 20, pt = 64, pb = 48, cats = o.cats, ser = o.series;
    let mx = 0; ser.forEach(s => s.data.forEach(v => { if (v > mx) mx = v })); mx = mx || 1;
    const p = Math.pow(10, Math.floor(Math.log10(mx))), f = mx / p; mx = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    x.font = "12px Arial, sans-serif"; x.strokeStyle = "#ddd"; x.fillStyle = "#555"; x.textAlign = "right";
    for (let i = 0; i <= 4; i++) { const y = H - pb - i / 4 * (H - pb - pt); x.beginPath(); x.moveTo(pl, y); x.lineTo(W - pr, y); x.stroke(); x.fillText(Math.round(mx * i / 4).toLocaleString("en-US"), pl - 6, y + 4) }
    const bw = (W - pl - pr) / Math.max(1, cats.length); x.textAlign = "center";
    const every = Math.ceil(cats.length / 14);
    cats.forEach((c_, i) => { if (i % every === 0 || i === cats.length - 1) x.fillText(c_, pl + i * bw + bw / 2, H - pb + 18) });
    const bars = ser.filter(s => s.type !== "line"), nb = bars.length;
    bars.forEach((s, k) => { x.fillStyle = s.color; s.data.forEach((v, i) => { const h = (v || 0) / mx * (H - pb - pt); x.fillRect(pl + i * bw + bw * .1 + k * bw * .8 / nb, H - pb - h, bw * .8 / nb - 2, h) }) });
    ser.filter(s => s.type === "line").forEach(s => { x.strokeStyle = s.color; x.lineWidth = 3; x.beginPath(); s.data.forEach((v, i) => { const X = pl + i * bw + bw / 2, Y = H - pb - (v || 0) / mx * (H - pb - pt); i ? x.lineTo(X, Y) : x.moveTo(X, Y) }); x.stroke(); x.lineWidth = 1 });
    let lx = 16; x.textAlign = "left"; x.font = "13px Arial, sans-serif";
    ser.forEach(s => { x.fillStyle = s.color; x.fillRect(lx, 40, 14, 10); x.fillStyle = "#333"; x.fillText(s.name, lx + 18, 50); lx += x.measureText(s.name).width + 40 });
    return c.toDataURL("image/png");
  }
  function addChart(wb, ws, png, col, row, w, h) { if (!png) return; const id = wb.addImage({ base64: png, extension: "png" }); ws.addImage(id, { tl: { col: col, row: row }, ext: { width: w || 720, height: h || 288 } }) }

  function build(XL, records, opt) {
    opt = opt || {};
    const R = records.filter(r => r && r.d && r.q > 0 && ST.includes(r.s)).map(r => ({ d: r.d, m: r.m, k: A().key(r.m), L: +r.L, w: +r.w, q: +r.q, s: r.s, p: r.p || "", n: r.n || "", t: r.t || 0 }))
      .sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.t - b.t);
    const days = [...new Set(R.map(r => r.d))].sort(), months = [...new Set(days.map(month))].sort();
    const by = new Map(); R.forEach(r => { (by.get(r.d) || by.set(r.d, []).get(r.d)).push(r) });
    const AN = A().analyze(days.map(d => A().summarize(d, by.get(d))));
    const disp = {}, firstIdx = {}; R.forEach((r, i) => { if (!(r.k in disp)) { disp[r.k] = r.m; firstIdx[r.k] = i } });
    const MIo = AN.MI.slice().sort((a, b) => firstIdx[a.k] - firstIdx[b.k]); MIo.forEach(m => { m.name = disp[m.k] });
    const korder = MIo.map(m => m.k);
    const binof = A().binof, BINS = AN.BINS;
    const spec = new Map(); R.forEach(r => { const k = r.k + "|" + r.L + "|" + r.w; const s = spec.get(k) || { k: r.k, L: r.L, w: r.w, ser: {} }; s.ser[r.d] = (s.ser[r.d] || 0) + r.q; spec.set(k, s) });
    const model = {}, modelq = {}; R.forEach(r => { (model[r.k] = model[r.k] || {})[r.d] = (model[r.k][r.d] || 0) + kg(r.w, r.L, r.q); (modelq[r.k] = modelq[r.k] || {})[r.d] = (modelq[r.k][r.d] || 0) + r.q });
    const dt = AN.daily, dflow = AN.flow;
    const wb = new XL.Workbook(); wb.calcProperties = { fullCalcOnLoad: true };
    const charts = opt.charts !== false;

    // 0 说明
    const s0 = wb.addWorksheet("说明");
    const miss = []; if (days.length) { const a = new Date(days[0] + "T12:00:00"), b = new Date(days[days.length - 1] + "T12:00:00"); for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) { const x = d.toISOString().slice(0, 10); if (!by.has(x)) miss.push(+x.slice(5, 7) + "/" + +x.slice(8, 10)) } }
    const lines = [["产品大数据库（App 导出）", true], [`数据来源：每天的铝型材清单（车间盘点导入文件），共 ${days.length} 天：${days[0] || ""} 至 ${days[days.length - 1] || ""}${miss.length ? "（" + miss.join("、") + " 无数据）" : ""}，${R.length} 行记录。`, false], ["", false], ["一、基本口径", true],
      ["1. 规格 = 型号 + 长度 + 理论支重；同型号支重不同算不同规格。", false], ["2. 型号比对时去掉“-”和空格；几个写法不统一的已合并：8020CX-1→8020CX，QG7048→QG704B，CHEN801B→CHZN801B，Y8029→ST-Y8029。", false],
      ["3. 重量 = 理论支重 ÷ 6 × 长度 × 支数（理论重量 kg）。", false], ["4. 库存 = 当天盘点的全部支数（已入库 + 包装中 + 刚生产）。", false], ["", false], ["二、出货和生产怎么估算（重要）", true],
      ["5. 没有出货单时，用“相邻两次盘点的变化”来推算：按型号合计（不分支重，减少抄写误差），", false], ["   今天比上一次少的部分 → 记为【出货(估)】；今天比上一次多的部分 → 记为【新增(估)】（新生产入账）。", false],
      ["6. 【生产产量】另外用一个更直接的口径：当天单上“刚生产”的支数和重量（刚出炉/未进炉的那部分）。", false], ["7. 热销 = 本月出货(估)的重量最多的型号；同时看“出货天数”（本月有几天在减少），天数多说明一直在走货，不是偶尔一次。", false],
      ["", false], ["三、局限（请注意）", true], ["8. 估算会受抄错、漏抄、型号写法变化影响；某天整批货漏抄或重复，会同时虚增出货和新增。", false], ["9. 数据天数少的月份，月度对比参考意义有限。", false],
      ["10. 以后接上出货 App 的提货记录 / 销售单后，出货量可以换成真实数字，并能加上客户、金额分析。", false], ["", false], ["四、各工作表", true],
      ["月度总览：每月关键数字 + 每日库存/出货/生产走势图。", false], ["支重区间：按理论支重分 8 档，看每档有多少规格、库存多少、出货和生产多少。", false], ["热销排行：每月按出货(估)重量排名前 30 的型号。", false],
      ["生产产量：每天“刚生产”的支数和重量，以及每月生产最多的型号。", false], ["产品数据库：每个规格一行（首次出现、最近库存、平均库存、出货/新增、可卖天数等）。", false], ["每日库存矩阵：每个规格每天的库存支数，一眼看出变化。", false], ["原始明细：所有天的全部记录，可以自己筛选、做数据透视。", false],
      ["型号数据库 / 库存变化 / 出货生产速度 / 排行榜 / 数据质量：按型号合计的分析（见各表下方说明）。图表是图片。", false]];
    lines.forEach(([t, b], i) => { const c = s0.getCell(i + 1, 1); c.value = t; c.font = { name: "Arial", size: i === 0 ? 14 : 10, bold: b } }); s0.getColumn(1).width = 120;

    const md = wb.addWorksheet("型号数据库"), mo = wb.addWorksheet("月度总览"), kc = wb.addWorksheet("库存变化"), sd = wb.addWorksheet("出货生产速度"), ph = wb.addWorksheet("排行榜"), dq_ = wb.addWorksheet("数据质量");
    const bz = wb.addWorksheet("支重区间"), hs = wb.addWorksheet("热销排行"), sc = wb.addWorksheet("生产产量"), db = wb.addWorksheet("产品数据库"), mx = wb.addWorksheet("每日库存矩阵"), raw = wb.addWorksheet("原始明细");

    // 原始明细
    head(raw, ["日期", "月份", "页码", "状态", "型号", "型号(统一)", "长度(米)", "理论支重", "支重区间", "支数", "理论重量(kg)", "备注"]);
    R.forEach((r, i) => { const k = i + 2; body(raw, k, [r.d, month(r.d), r.p, r.s, r.m, disp[r.k], r.L, r.w, binof(r.w), r.q, fx(`H${k}/6*G${k}*J${k}`, kg(r.w, r.L, r.q)), r.n], [null, null, null, null, null, null, "0.00", "0.000", null, "#,##0", "#,##0.0", null]); raw.getCell(k, 12).alignment = { horizontal: "left" } });
    const N = R.length + 1; freeze(raw, 0, 1); raw.autoFilter = `A1:L${N}`; widths(raw, [11, 9, 8, 8, 14, 14, 8, 9, 10, 9, 11, 50]);
    const RG = c => `原始明细!$${c}$2:$${c}$${N}`;
    const sumR = f => R.reduce((a, r) => a + (f(r) || 0), 0);

    // 月度总览
    head(mo, ["月份", "盘点天数", "平均库存(支)", "平均库存(kg)", "月末库存(支)", "月末库存(kg)", "出货(估)支", "出货(估)kg", "新增(估)支", "新增(估)kg", "刚生产合计(支)", "刚生产合计(kg)", "出现过的规格数", "出现过的型号数"]);
    months.forEach((m, i0) => {
      const i = i0 + 2, mdays = days.filter(d => month(d) === m), last = mdays[mdays.length - 1], fl = mdays.filter(d => dflow[d]).map(d => dflow[d]);
      body(mo, i, [m, mdays.length, mdays.reduce((a, d) => a + dt[d].q, 0) / mdays.length, mdays.reduce((a, d) => a + dt[d].kg, 0) / mdays.length, dt[last].q, dt[last].kg,
        fl.reduce((a, x) => a + x.oq, 0), fl.reduce((a, x) => a + x.ok, 0), fl.reduce((a, x) => a + x.iq, 0), fl.reduce((a, x) => a + x.ik, 0),
        fx(`SUMIFS(${RG("J")},${RG("B")},A${i},${RG("D")},"刚生产")`, sumR(r => month(r.d) === m && r.s === "刚生产" ? r.q : 0)), fx(`SUMIFS(${RG("K")},${RG("B")},A${i},${RG("D")},"刚生产")`, sumR(r => month(r.d) === m && r.s === "刚生产" ? kg(r.w, r.L, r.q) : 0)),
        [...spec.values()].filter(s => Object.keys(s.ser).some(d => month(d) === m)).length, new Set(R.filter(r => month(r.d) === m).map(r => r.k)).size],
        [null, "0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "0", "0"]);
    });
    const r0 = months.length + 4;
    mo.getCell(r0 - 1, 1).value = "每日明细（出货/新增(估) = 和上一次盘点比）"; mo.getCell(r0 - 1, 1).font = FB;
    head(mo, ["日期", "记录行数", "库存合计(支)", "库存合计(kg)", "已入库(支)", "包装中(支)", "刚生产(支)", "出货(估)支", "出货(估)kg", "新增(估)支", "新增(估)kg", "刚生产(kg)"], r0);
    days.forEach((d, j0) => {
      const j = r0 + 1 + j0, t = dt[d], f = dflow[d];
      body(mo, j, [d, fx(`COUNTIF(${RG("A")},A${j})`, t.n), fx(`SUMIFS(${RG("J")},${RG("A")},A${j})`, t.q), fx(`SUMIFS(${RG("K")},${RG("A")},A${j})`, t.kg),
        fx(`SUMIFS(${RG("J")},${RG("A")},A${j},${RG("D")},"已入库")`, t["已入库"]), fx(`SUMIFS(${RG("J")},${RG("A")},A${j},${RG("D")},"包装中")`, t["包装中"]), fx(`SUMIFS(${RG("J")},${RG("A")},A${j},${RG("D")},"刚生产")`, t["刚生产"]),
        f ? f.oq : "", f ? f.ok : "", f ? f.iq : "", f ? f.ik : "", fx(`SUMIFS(${RG("K")},${RG("A")},A${j},${RG("D")},"刚生产")`, t["刚生产kg"])],
        [null, "0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0"]);
    });
    const e = r0 + days.length; widths(mo, [11, 9, 13, 13, 13, 13, 12, 12, 12, 12, 14, 14, 13, 13]);
    const lab = days.map(d => d.slice(5));
    if (charts) {
      addChart(wb, mo, chartPNG({ title: "每日库存（支）", cats: lab, series: [{ name: "库存合计", type: "line", color: "#305496", data: days.map(d => dt[d].q) }, ...ST.map((s, i) => ({ name: s, type: "line", color: ["#7fb069", "#6fa8dc", "#f6b26b"][i], data: days.map(d => dt[d][s]) }))] }), 0, e + 2);
      addChart(wb, mo, chartPNG({ title: "每日出货(估) vs 新增(估)（kg）", cats: lab, series: [{ name: "出货(估)kg", color: "#e06666", data: days.map(d => dflow[d] ? dflow[d].ok : 0) }, { name: "新增(估)kg", color: "#7fb069", data: days.map(d => dflow[d] ? dflow[d].ik : 0) }] }), 7, e + 2);
    }

    // 支重区间
    head(bz, ["月份", "支重区间(kg/6米)", "规格数", "最新库存(支)", "最新库存(kg)", "库存占比(kg)", "出货(估)支", "出货(估)kg", "出货占比(kg)", "刚生产(支)", "刚生产(kg)"]);
    let row = 2, lastAgg = null;
    months.forEach(m => {
      const mdays = days.filter(d => month(d) === m), mlast = mdays[mdays.length - 1];
      const agg = {}; BINS.forEach(b => agg[b] = { n: 0, q: 0, kg: 0, oq: 0, ok: 0, nq: 0, nk: 0 });
      spec.forEach(s => {
        const a = agg[binof(s.w)];
        if (Object.keys(s.ser).some(d => month(d) === m)) a.n++;
        a.q += s.ser[mlast] || 0; a.kg += kg(s.w, s.L, s.ser[mlast] || 0);
        for (let i = 1; i < days.length; i++) { if (month(days[i]) !== m) continue; const dq = (s.ser[days[i - 1]] || 0) - (s.ser[days[i]] || 0); if (dq > 0) { a.oq += dq; a.ok += kg(s.w, s.L, dq) } }
      });
      R.forEach(r => { if (month(r.d) === m && r.s === "刚生产") { const a = agg[binof(r.w)]; a.nq += r.q; a.nk += kg(r.w, r.L, r.q) } });
      const tk = Object.values(agg).reduce((x, a) => x + a.kg, 0) || 1, to = Object.values(agg).reduce((x, a) => x + a.ok, 0) || 1;
      BINS.forEach(b => { const a = agg[b]; body(bz, row, [m, b, a.n, a.q, a.kg, a.kg / tk, a.oq, a.ok, a.ok / to, a.nq, a.nk], [null, null, "0", "#,##0", "#,##0", "0.0%", "#,##0", "#,##0", "0.0%", "#,##0", "#,##0"]); row++ });
      row++; lastAgg = agg;
    });
    widths(bz, [10, 16, 9, 14, 13, 12, 12, 12, 12, 12, 12]);
    { const c = bz.getCell(row + 1, 1); c.value = "说明：这张表按“规格”算出货(估)，比按型号算的数字会偏大一些（支重抄写不同会被当成一出一进）。主要看各区间之间的比例。"; c.font = { name: "Arial", size: 9, italic: true, color: argb("7F7F7F") } }
    if (charts && lastAgg) addChart(wb, bz, chartPNG({ title: `${months[months.length - 1]} 各支重区间：库存 vs 出货(估)（kg）`, cats: BINS, series: [{ name: "最新库存kg", color: "#6fa8dc", data: BINS.map(b => lastAgg[b].kg) }, { name: "出货(估)kg", color: "#e06666", data: BINS.map(b => lastAgg[b].ok) }] }), 12, 1);

    // 热销排行
    row = 1;
    months.forEach(m => {
      const c = hs.getCell(row, 1); c.value = `${m} 热销型号 TOP30（按出货(估)重量）`; c.font = { name: "Arial", size: 12, bold: true }; row++;
      head(hs, ["排名", "型号", "出货(估)kg", "出货(估)支", "出货天数", "月末库存(支)", "月末库存(kg)", "可卖天数(估)", "主要支重区间", "规格数"], row); row++;
      const mdays = days.filter(d => month(d) === m), mlast = mdays[mdays.length - 1], pairs = []; for (let i = 1; i < days.length; i++) if (month(days[i]) === m) pairs.push([days[i - 1], days[i]]);
      const res = [];
      korder.forEach(k => {
        const ok = pairs.reduce((a, [x, y]) => a + Math.max(0, (model[k][x] || 0) - (model[k][y] || 0)), 0), oq = pairs.reduce((a, [x, y]) => a + Math.max(0, (modelq[k][x] || 0) - (modelq[k][y] || 0)), 0);
        const nd = pairs.filter(([x, y]) => (modelq[k][x] || 0) > (modelq[k][y] || 0)).length; if (ok <= 0) return;
        const ws = [...spec.values()].filter(s => s.k === k).map(s => s.w).sort((a, b) => a - b), endk = model[k][mlast] || 0, daily = ok / Math.max(1, pairs.length);
        res.push([ok, oq, nd, modelq[k][mlast] || 0, endk, daily ? endk / daily : null, binof(ws[Math.floor(ws.length / 2)]), ws.length, disp[k]]);
      });
      res.sort((a, b) => b[0] - a[0]).slice(0, 30).forEach((x, i) => { body(hs, row, [i + 1, x[8], x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7]], [null, null, "#,##0", "#,##0", "0", "#,##0", "#,##0", "0", null, "0"], false, i < 10 ? "E2EFDA" : null); row++ });
      row += 2;
    });
    { const c = hs.getCell(row, 1); c.value = "出货天数：本月有几次盘点比上一次少；可卖天数 = 月末库存 ÷ 每次盘点平均出货（粗估）。前 10 名绿色。"; c.font = { name: "Arial", size: 9, italic: true, color: argb("7F7F7F") } }
    widths(hs, [7, 14, 12, 12, 10, 13, 13, 12, 13, 8]);

    // 生产产量
    head(sc, ["日期", "刚生产(支)", "刚生产(kg)", "刚生产行数", "新增(估)支", "新增(估)kg"]);
    days.forEach((d, j0) => { const rs = by.get(d).filter(r => r.s === "刚生产"), f = dflow[d]; body(sc, j0 + 2, [d, rs.reduce((a, r) => a + r.q, 0), rs.reduce((a, r) => a + kg(r.w, r.L, r.q), 0), rs.length, f ? f.iq : "", f ? f.ik : ""], [null, "#,##0", "#,##0", "0", "#,##0", "#,##0"]) });
    const e2 = days.length + 1;
    if (charts) addChart(wb, sc, chartPNG({ title: "每日刚生产（kg）", cats: lab, series: [{ name: "刚生产(kg)", color: "#f6b26b", data: days.map(d => dt[d]["刚生产kg"]) }] }), 7, 1, 640, 256);
    row = e2 + 3;
    months.forEach(m => {
      const c = sc.getCell(row, 1); c.value = `${m} 生产最多的型号 TOP20（按“刚生产”重量）`; c.font = { name: "Arial", size: 12, bold: true }; row++;
      head(sc, ["排名", "型号", "刚生产(支)", "刚生产(kg)", "出现天数", "支重区间"], row); row++;
      const agg = new Map(); R.forEach(r => { if (month(r.d) === m && r.s === "刚生产") { const a = agg.get(r.k) || [0, 0, new Set(), []]; a[0] += r.q; a[1] += kg(r.w, r.L, r.q); a[2].add(r.d); a[3].push(r.w); agg.set(r.k, a) } });
      [...agg.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 20).forEach(([k, a], i) => { const ws = a[3].slice().sort((x, y) => x - y); body(sc, row, [i + 1, disp[k], a[0], a[1], a[2].size, binof(ws[Math.floor(ws.length / 2)])], [null, null, "#,##0", "#,##0", "0", null]); row++ });
      row += 2;
    });
    widths(sc, [11, 14, 12, 12, 11, 12]);

    // 产品数据库
    head(db, ["型号", "长度(米)", "理论支重", "实际支重", "支重区间", "首次出现", "最近出现", "出现天数", "最新库存(支)", "最新库存(kg)", "平均库存(支)", "最高库存", "最低库存", "出货(估)支", "新增(估)支", "每次平均出货(支)", "可卖天数(估)", "最新状态"]);
    const lastD = days[days.length - 1];
    const rows = [...spec.values()].map(s => {
      const ds = Object.keys(s.ser).sort(); let o = 0, i_ = 0; for (let i = 1; i < days.length; i++) { const x = s.ser[days[i - 1]] || 0, y = s.ser[days[i]] || 0; o += Math.max(0, x - y); i_ += Math.max(0, y - x) }
      const vals = Object.values(s.ser), cur = s.ser[lastD] || 0, avgout = o / Math.max(1, days.length - 1);
      const lastst = [...new Set(by.get(lastD).filter(r => r.k === s.k && r.L === s.L && r.w === s.w).map(r => r.s))].sort().join("/");
      return [disp[s.k], s.L, s.w, null, binof(s.w), ds[0], ds[ds.length - 1], ds.length, cur, null, vals.reduce((a, b) => a + b, 0) / ds.length, Math.max(...vals), Math.min(...vals), o, i_, avgout, avgout ? cur / avgout : null, lastst || "今天没有"];
    }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2]);
    rows.forEach((r, j0) => { const j = j0 + 2; r[3] = fx(`C${j}/6*B${j}`, r[2] / 6 * r[1]); r[9] = fx(`D${j}*I${j}`, r[2] / 6 * r[1] * r[8]); body(db, j, r, [null, "0.00", "0.000", "0.0000", null, null, null, "0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "0", null]) });
    freeze(db, 1, 1); db.autoFilter = `A1:R${rows.length + 1}`; widths(db, [14, 8, 9, 9, 11, 11, 11, 8, 12, 12, 12, 10, 10, 11, 11, 13, 11, 12]);

    // 每日库存矩阵
    head(mx, ["型号", "长度", "支重", ...days.map(d => d.slice(5)), "变化(首→末)"]);
    const sps = [...spec.values()].sort((a, b) => disp[a.k] < disp[b.k] ? -1 : disp[a.k] > disp[b.k] ? 1 : a.L - b.L || a.w - b.w);
    const lc = CL(3 + days.length);
    sps.forEach((s, j0) => { const j = j0 + 2, vals = days.map(d => s.ser[d] === undefined ? null : s.ser[d]); body(mx, j, [disp[s.k], s.L, s.w, ...vals, fx(`N(${lc}${j})-N(D${j})`, (vals[vals.length - 1] || 0) - (vals[0] || 0))], [null, "0.00", "0.000", ...days.map(() => "#,##0"), "+#,##0;-#,##0;0"]) });
    freeze(mx, 3, 1); mx.autoFilter = `A1:${CL(4 + days.length)}${sps.length + 1}`; widths(mx, [14, 7, 8, ...days.map(() => 8), 11]);
    mx.addConditionalFormatting({ ref: `D2:${lc}${sps.length + 1}`, rules: [{ type: "colorScale", priority: 1, cfvo: [{ type: "min" }, { type: "max" }], color: [argb("FFFFFF"), argb("5B9BD5")] }] });

    // 型号数据库
    const cols = ["型号", "写法(原单)", "规格数", "长度", "支重范围", "主要支重区间", "首次出现", "最近出现", "出现天数", "最新库存(支)", "最新库存(kg)", "平均库存(支)", "最高库存", "最低库存", "出货(估)支", "出货(估)kg", "新增(估)支", "刚生产合计(支)", "刚生产合计(kg)", "出货次数", "每次平均出货(支)", "可卖天数(估)", "库存趋势", "最新状态", "需核对次数"];
    head(md, cols);
    const TRC = { "上涨(可能积压)": "FCE4D6", "下降(快没了)": "FFF2CC", "呆货(没动过)": "EDEDED", "已清空": "F8CBAD" };
    const MIs = MIo.slice().sort((a, b) => b.curk - a.curk);
    MIs.forEach((m, j0) => {
      const j = j0 + 2;
      body(md, j, [m.name, m.var.join("、"), m.nspec, m.Ls.map(g).join("/"), m.ws.length > 1 ? `${g(m.ws[0])}–${g(m.ws[m.ws.length - 1])}` : g(m.ws[0]), m.bin, m.first, m.last, m.ndays, m.cur, m.curk, m.avg, m.mx, m.mn, m.oq, m.ok, m.iq, m.prodq, m.prodk, m.nout, m.dq, m.sell, m.tr, m.st, m.flag],
        [null, null, "0", null, null, null, null, null, "0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "0", "#,##0", "0", null, null, "0"]);
      if (TRC[m.tr]) md.getCell(j, 23).fill = fill(TRC[m.tr]); md.getCell(j, 2).alignment = { horizontal: "left" };
    });
    freeze(md, 1, 1); md.autoFilter = `A1:${CL(cols.length)}${MIs.length + 1}`; widths(md, [13, 22, 7, 12, 13, 12, 11, 11, 8, 12, 12, 12, 10, 10, 11, 11, 11, 13, 13, 8, 13, 11, 15, 12, 9]);
    { const c = md.getCell(MIs.length + 3, 1); c.value = "按最新库存重量从大到小排。可卖天数 = 最新库存 ÷ 每次盘点平均出货(估)。库存趋势：比较前一半天数和后一半天数的平均库存。"; c.font = { name: "Arial", size: 9, italic: true, color: argb("7F7F7F") } }

    // 库存变化
    row = 1;
    [["上涨(可能积压)", "库存一直在涨（可能卖得慢、积压）", "后半段平均库存比前半段多 25% 以上"], ["下降(快没了)", "库存一直在降 / 快没了（可能要安排生产）", "后半段比前半段少 25% 以上，或最新库存不到最高时的 30%"],
    ["已清空", "以前有、今天已经没有", "最近一次盘点为 0"], ["呆货(没动过)", "呆货：10 天以上数量一点没变", "每次盘点支数都一样"]].forEach(([tr, title, tip]) => {
      const lst = MIo.filter(m => m.tr === tr).sort((a, b) => tr !== "已清空" ? b.curk - a.curk : b.ok - a.ok);
      const c = kc.getCell(row, 1); c.value = `${title}（${lst.length} 个型号）`; c.font = { name: "Arial", size: 12, bold: true };
      const c2 = kc.getCell(row, 6); c2.value = "判断标准：" + tip; c2.font = { name: "Arial", size: 9, italic: true, color: argb("7F7F7F") }; row++;
      head(kc, ["型号", "主要支重区间", "最新库存(支)", "最新库存(kg)", "最高库存", "最低库存", "出货(估)支", "可卖天数(估)", ...days.map(d => d.slice(5))], row); row++;
      lst.forEach(m => { body(kc, row, [m.name, m.bin, m.cur, m.curk, m.mx, m.mn, m.oq, m.sell, ...m.ser], [null, null, "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "0", ...days.map(() => "#,##0")]); for (let c3 = 9; c3 < 9 + days.length; c3++) kc.getCell(row, c3).fill = fill(TRC[tr]); row++ });
      row += 2;
    });
    widths(kc, [13, 12, 12, 12, 10, 10, 11, 11, ...days.map(() => 8)]); freeze(kc, 1, 0);

    // 出货生产速度
    head(sd, ["型号", "最新库存(支)", "最新库存(kg)", "每次平均出货(支)", "每次平均新增(支)", "出货次数", "可卖天数(估)", "刚生产合计(支)", "建议"]);
    const slst = MIo.filter(m => m.dq > 0).sort((a, b) => (a.sell !== null ? a.sell : 9e9) - (b.sell !== null ? b.sell : 9e9));
    slst.forEach((m, j0) => { const adv = (m.sell !== null && m.sell < 5 && m.nout >= 3) ? "库存可能不够，考虑安排生产" : (m.sell && m.sell > 40) ? "走得慢，注意积压" : ""; body(sd, j0 + 2, [m.name, m.cur, m.curk, m.dq, m.din, m.nout, m.sell, m.prodq, adv], [null, "#,##0", "#,##0", "#,##0", "#,##0", "0", "0", "#,##0", null], false, adv.startsWith("库存") ? "FCE4D6" : null) });
    freeze(sd, 0, 1); sd.autoFilter = `A1:I${slst.length + 1}`; widths(sd, [13, 12, 12, 14, 14, 9, 12, 13, 26]);
    { const c = sd.getCell(slst.length + 3, 1); c.value = "按可卖天数从少到多排。出货次数≥3 且可卖天数<5 天的标橙色。以“每次盘点”为单位（约等于每天）。"; c.font = { name: "Arial", size: 9, italic: true, color: argb("7F7F7F") } }

    // 排行榜
    let col = 1;
    [["库存最多 TOP20（按重量 kg）", m => m.curk, ["最新库存(kg)", "最新库存(支)"], m => [m.curk, m.cur]], ["库存最多 TOP20（按支数）", m => m.cur, ["最新库存(支)", "最新库存(kg)"], m => [m.cur, m.curk]],
    ["出货最快 TOP20（出货(估) kg）", m => m.ok, ["出货(估)kg", "出货(估)支", "出货次数"], m => [m.ok, m.oq, m.nout]], ["生产最多 TOP20（刚生产 kg）", m => m.prodk, ["刚生产(kg)", "刚生产(支)"], m => [m.prodk, m.prodq]]].forEach(([t, kf, hd, vf]) => {
      const c = ph.getCell(1, col); c.value = t; c.font = { name: "Arial", size: 11, bold: true };
      ["名次", "型号", ...hd].forEach((h, i) => { const x = ph.getCell(2, col + i); x.value = h; x.font = FH; x.fill = fill("305496"); x.border = BD; x.alignment = CA });
      MIo.slice().sort((a, b) => kf(b) - kf(a)).slice(0, 20).forEach((m, r_) => { [r_ + 1, m.name, ...vf(m)].forEach((v, i) => { const x = ph.getCell(r_ + 3, col + i); x.value = v; x.font = F; x.border = BD; x.alignment = { horizontal: "center" }; if (i >= 2) x.numFmt = "#,##0"; if (r_ < 3) x.fill = fill("E2EFDA") }) });
      [6, 13, ...hd.map(() => 12)].forEach((w, i) => { ph.getColumn(col + i).width = w }); col += hd.length + 3;
    });
    ph.getRow(2).height = 30;

    // 数据质量
    head(dq_, ["日期", "记录行数", "需核对处数", "占比"]);
    days.forEach((d, j0) => { const n = by.get(d).length, f = by.get(d).filter(r => r.n.startsWith("【需核对】")).length; body(dq_, j0 + 2, [d, n, f, f / n], [null, "0", "0", "0.0%"]) });
    const e3 = days.length + 1;
    if (charts) addChart(wb, dq_, chartPNG({ title: "每天需核对处数", cats: lab, series: [{ name: "需核对处数", color: "#e06666", data: days.map(d => by.get(d).filter(r => r.n.startsWith("【需核对】")).length) }] }), 5, 1, 560, 240);
    row = e3 + 3; { const c = dq_.getCell(row, 1); c.value = "最常需要核对的型号 TOP20"; c.font = { name: "Arial", size: 11, bold: true } } row++;
    head(dq_, ["型号", "需核对次数", "出现天数"], row); row++;
    for (const m of MIo.slice().sort((a, b) => b.flag - a.flag).slice(0, 20)) { if (!m.flag) break; body(dq_, row, [m.name, m.flag, m.ndays]); row++ }
    row += 2; { const c = dq_.getCell(row, 1); c.value = "写法不一致的型号（同一个型号在单上出现过不同写法）"; c.font = { name: "Arial", size: 11, bold: true } } row++;
    head(dq_, ["型号(统一)", "出现过的写法", "写法数"], row); row++;
    for (const m of MIo.slice().sort((a, b) => b.var.length - a.var.length)) { if (m.var.length < 2) break; body(dq_, row, [m.name, m.var.join("、"), m.var.length]); dq_.getCell(row, 2).alignment = { horizontal: "left" }; row++ }
    [["8020CX1", "8020CX"], ["QG7048", "QG704B"], ["CHEN801B", "CHZN801B"], ["Y8029", "STY8029"]].forEach(([a, b]) => { body(dq_, row, [disp[b] || b, `${a} → 已合并到 ${b}`, ""]); row++ });
    widths(dq_, [13, 40, 10, 9]);

    return wb.xlsx.writeBuffer();
  }
  root.QDBIG = { build };
  if (typeof module !== "undefined") module.exports = { build };
})(typeof window !== "undefined" ? window : globalThis);
