/* 铝型材清单 Excel 导出：和每天的“铝型材清单_MMDD.xlsx”同样的 7 张表、格式、公式、颜色。
   用法：QDX.build(ExcelJS, {day, rows, yday, yrows, checks}) → ArrayBuffer
   rows/yrows：当天/上一天记录 {m,L,w,q,s,s0,n,p,t}；checks：[{id,lvl,kind,why,sug,res}] */
(function (root) {
  const ST = ["已入库", "包装中", "刚生产"];
  const SCOL = { "已入库": "E2EFDA", "包装中": "DDEBF7", "刚生产": "FCE4D6" };
  const CHG = "FFE699";
  const argb = c => ({ argb: "FF" + c });
  const fill = c => ({ type: "pattern", pattern: "solid", fgColor: argb(c) });
  const cfFill = c => ({ type: "pattern", pattern: "solid", fgColor: argb(c), bgColor: argb(c) });
  const side = (c, s) => ({ style: s || "thin", color: argb(c) });
  const BOX = c => ({ top: side(c), left: side(c), bottom: side(c), right: side(c) });
  const B = BOX("BFBFBF");
  const font = (o) => Object.assign({ name: "Arial" }, o || {});
  const F10 = font({ size: 10 }), FB10 = font({ size: 10, bold: true }), G9 = font({ size: 9, color: argb("A6A6A6") });
  const CEN = { horizontal: "center" }, CA = { horizontal: "center", vertical: "middle", wrapText: true };
  const norm = m => String(m).toUpperCase().replace(/[\s\-_]/g, "");
  const pageNo = p => { const x = /第(\d+)张/.exec(p || ""); return x ? +x[1] : 0 };
  const fx = (formula, result) => ({ formula, result });
  const md = d => d ? (+d.slice(5, 7) + "").padStart(2, "0") + "/" + d.slice(8, 10) : "";
  const pyNum = n => { const s = String(n); return s };            // 与 Python 的 :g 一致（JS 默认足够）
  const cmpStr = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const thou = n => Math.round(n).toLocaleString("en-US");

  function head(ws, cols, row, h, size) {
    cols.forEach((t, i) => {
      const c = ws.getCell(row || 1, i + 1); c.value = t;
      c.font = font(Object.assign({ bold: true, color: argb("FFFFFF") }, size ? { size } : {})); c.fill = fill("305496"); c.border = B; c.alignment = CA;
    });
    ws.getRow(row || 1).height = h || 30;
  }
  const widths = (ws, ws_) => ws_.forEach((w, i) => { ws.getColumn(i + 1).width = w });
  const freeze = (ws, x, y, extra) => { ws.views = [Object.assign({ state: "frozen", xSplit: x, ySplit: y }, extra || {})] };
  const dvList = (ws, ref, list, o) => {
    const [a, b] = ref.split(":"); const col = a.replace(/\d+/g, ""), r0 = +a.replace(/\D+/g, ""), r1 = +b.replace(/\D+/g, "");
    for (let r = r0; r <= r1; r++) ws.getCell(col + r).dataValidation = Object.assign({ type: "list", allowBlank: true, formulae: ['"' + list.join(",") + '"'] }, o || {});
  };

  function build(XL, o) {
    const day = o.day, yday = o.yday || "";
    const rows = o.rows.filter(r => r.q > 0 && ST.includes(r.s)).slice().sort((a, b) => (a.t || 0) - (b.t || 0));
    const yrows = (o.yrows || []).filter(r => r.q > 0 && ST.includes(r.s));
    const N = rows.length, n = N + 1;
    const D = rows.map(r => ({ pg: pageNo(r.p), L: +r.L, m: r.m, w: +r.w, q: +r.q, n: r.n || "", s: r.s, s0: ST.includes(r.s0) ? r.s0 : r.s, id: r.id }));
    const piece = r => r.w / 6 * r.L, kgOf = r => piece(r) * r.q;
    const wb = new XL.Workbook();
    wb.calcProperties = { fullCalcOnLoad: true };
    const R = c => `明细!$${c}$2:$${c}$${n}`;

    // 页码说明
    const pages = {}, extra = {};
    ST.forEach(s => {
      const ps = [...new Set(D.filter(r => r.s0 === s).map(r => r.pg))].sort((a, b) => a - b);
      pages[s] = !ps.length ? "" : ps[0] === ps[ps.length - 1] ? `第${ps[0]}张` : `第${ps[0]}–${ps[ps.length - 1]}张`;
      const firsts = D.filter(r => r.s0 === s).map(r => r.n.replace(/^【需核对】/, "").split("；")[0]);
      extra[s] = firsts.length && firsts.every(x => x && x === firsts[0]) ? firsts[0] : "";
    });

    // ---------------- 今日查错单 ----------------
    const idx = new Map(D.map((r, i) => [r.id, i]));
    const F = (o.checks || []).filter(c => idx.has(c.id));
    const q0 = wb.addWorksheet("今日查错单");
    // ---------------- 型号查询（之后填） ----------------
    const qs = wb.addWorksheet("型号查询");
    const zs = wb.addWorksheet("按状态汇总");
    const v = wb.addWorksheet("按状态排列（自动）");
    const ws = wb.addWorksheet("明细");
    const ss = wb.addWorksheet("按型号汇总");
    const cs = wb.addWorksheet("与昨天对比");

    // ---------------- 明细 ----------------
    head(ws, ["序号", "页码", "状态", "长度(米)", "型号", "理论支重(kg/6米)", "实际支重(kg/支)", "数量(支)", "总米数", "理论重量(kg)", "备注"]);
    ["状态变化", "原始状态", "排序号"].forEach((h, i) => {
      const c = ws.getCell(1, 12 + i); c.value = h; c.font = font({ size: 10, bold: true, color: argb("FFFFFF") }); c.fill = fill("305496"); c.border = B; c.alignment = CA;
    });
    const fmt = { D: "0.00", F: "0.000", G: "0.0000", H: "#,##0", I: "#,##0.0", J: "#,##0.0" };
    const rankOf = r => (ST.indexOf(r.s) + 1) * 100000 + (r.s !== r.s0 ? 0 : 50000);
    D.forEach((r, i) => {
      const k = i + 2;
      const vals = [i + 1, `第${r.pg}张`, r.s, r.L, r.m, r.w, fx(`F${k}/6*D${k}`, piece(r)), r.q, fx(`D${k}*H${k}`, r.L * r.q), fx(`G${k}*H${k}`, kgOf(r)), r.n || null];
      vals.forEach((x, j) => { const c = ws.getCell(k, j + 1); c.value = x; c.font = font(); c.border = B });
      Object.entries(fmt).forEach(([col, f]) => { ws.getCell(col + k).numFmt = f });
      "ABCDFGHIJ".split("").forEach(col => { ws.getCell(col + k).alignment = CEN });
      if (r.n.startsWith("【需核对】")) { const c = ws.getCell("K" + k); c.fill = fill("FFFF00"); c.font = font({ color: argb("C00000"), bold: true }) }
      const L = ws.getCell("L" + k), M = ws.getCell("M" + k), Nn = ws.getCell("N" + k);
      L.value = fx(`IF(C${k}<>M${k},"◆ "&M${k}&" → "&C${k},"")`, r.s !== r.s0 ? `◆ ${r.s0} → ${r.s}` : "");
      M.value = r.s0;
      Nn.value = fx(`MATCH(C${k},{"已入库","包装中","刚生产"},0)*100000+IF(C${k}<>M${k},0,50000)+A${k}`, rankOf(r) + i + 1);
      L.font = font({ size: 10, bold: true, color: argb("C00000") }); M.font = G9; Nn.font = G9;
      [L, M, Nn].forEach(c => { c.border = B; c.alignment = CEN });
    });
    dvList(ws, `C2:C${n}`, ST, { allowBlank: false, showErrorMessage: true, errorTitle: "状态", error: "请从下拉中选择：已入库 / 包装中 / 刚生产", showInputMessage: true, promptTitle: "状态", prompt: "点右边小箭头选择状态" });
    ws.addConditionalFormatting({ ref: `A2:L${n}`, rules: [{ type: "expression", priority: 1, stopIfTrue: true, formulae: ["$C2<>$M2"], style: { fill: cfFill(CHG) } }] });
    ST.forEach((s, j) => ws.addConditionalFormatting({ ref: `A2:J${n}`, rules: [{ type: "expression", priority: 2 + j, formulae: [`$C2="${s}"`], style: { fill: cfFill(SCOL[s]) } }] }));
    ST.forEach((s, j) => ws.addConditionalFormatting({ ref: `K2:K${n}`, rules: [{ type: "expression", priority: 5 + j, formulae: [`AND($C2="${s}",LEFT($K2,5)<>"【需核对】")`], style: { fill: cfFill(SCOL[s]) } }] }));
    const t = n + 1;
    ws.getCell("A" + t).value = "合计";
    const sum = f => D.reduce((a, r) => a + f(r), 0);
    [["H", r => r.q], ["I", r => r.L * r.q], ["J", kgOf]].forEach(([col, f]) => { const c = ws.getCell(col + t); c.value = fx(`SUM(${col}2:${col}${n})`, sum(f)); c.numFmt = fmt[col] });
    for (let c = 1; c <= 11; c++) { const x = ws.getCell(t, c); x.font = font({ bold: true }); x.border = B; x.fill = fill("D9E1F2") }
    const lab = s => pages[s] + (extra[s] && s === "刚生产" ? "，" + extra[s] : "");
    const notes = [["颜色说明（改“状态”列下拉，颜色和汇总会自动跟着变）：", null], [`绿色 = 已入库（${lab("已入库")}）`, SCOL["已入库"]], [`蓝色 = 包装中（${lab("包装中")}）`, SCOL["包装中"]],
      [`橙色 = 刚生产（${lab("刚生产")}）`, SCOL["刚生产"]], ["备注栏黄底红字 = 字迹不清、有改动或疑似重复，请对照原件核对", "FFFF00"], [`备注里 ★新型号/新规格  ▲比昨天多  ▼比昨天少  ◆状态变了（和${md(yday)}清单比）`, null]];
    notes.forEach(([txt, fl], k) => {
      const r = t + 2 + k;
      if (fl) { ws.getCell("B" + r).fill = fill(fl); const c = ws.getCell("C" + r); c.value = txt; c.font = font() }
      else { const c = ws.getCell("A" + r); c.value = txt; c.font = font({ bold: true }) }
    });
    { const c = ws.getCell("A" + (t + 9)); c.value = "实际支重=理论支重÷6×实际长度；理论重量=实际支重×支数（照片上的支重为6米理论支重）。"; c.font = font({ italic: true, color: argb("7F7F7F") }) }
    widths(ws, [6, 8, 9, 9, 14, 12, 12, 10, 11, 13, 52, 20, 9, 9]);
    freeze(ws, 2, 1); ws.autoFilter = `A1:N${n}`;

    // ---------------- 按型号汇总 ----------------
    head(ss, ["型号", "长度(米)", "理论支重(kg/6米)", "实际支重(kg/支)", "已入库(支)", "包装中(支)", "刚生产(支)", "数量合计(支)", "理论重量合计(kg)"]);
    const kmap = new Map(); D.forEach(r => { const k = r.m + "\u0000" + r.L + "\u0000" + r.w; if (!kmap.has(k)) kmap.set(k, { m: r.m, L: r.L, w: r.w }) });
    const keys = [...kmap.values()].sort((a, b) => cmpStr(a.m, b.m) || a.L - b.L || a.w - b.w);
    keys.forEach((g, i) => {
      const k = i + 2, crit = `${R("E")},A${k},${R("D")},B${k},${R("F")},C${k}`;
      const mine = D.filter(r => r.m === g.m && r.L === g.L && r.w === g.w), qs_ = s => mine.filter(r => r.s === s).reduce((a, r) => a + r.q, 0);
      const vals = [g.m, g.L, g.w, fx(`C${k}/6*B${k}`, g.w / 6 * g.L), ...ST.map(s => fx(`SUMIFS(${R("H")},${crit},${R("C")},"${s}")`, qs_(s))),
        fx(`SUM(E${k}:G${k})`, mine.reduce((a, r) => a + r.q, 0)), fx(`SUMIFS(${R("J")},${crit})`, mine.reduce((a, r) => a + kgOf(r), 0))];
      vals.forEach((x, j) => { const c = ss.getCell(k, j + 1); c.value = x; c.font = font(); c.border = B });
      ["0.00", "0.000", "0.0000", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0.0"].forEach((f, j) => { const c = ss.getCell(k, j + 2); c.numFmt = f; c.alignment = CEN });
      ST.forEach((s, j) => { ss.getCell(k, 5 + j).fill = fill(SCOL[s]) });
    });
    const e = keys.length + 1;
    ss.getCell("A" + (e + 1)).value = "合计";
    [["E", r => r.s === "已入库" ? r.q : 0], ["F", r => r.s === "包装中" ? r.q : 0], ["G", r => r.s === "刚生产" ? r.q : 0], ["H", r => r.q], ["I", kgOf]].forEach(([col, f]) => {
      const c = ss.getCell(col + (e + 1)); c.value = fx(`SUM(${col}2:${col}${e})`, sum(f)); c.numFmt = col === "I" ? "#,##0.0" : "#,##0";
    });
    for (let c = 1; c <= 9; c++) { const x = ss.getCell(e + 1, c); x.font = font({ bold: true }); x.border = B; x.fill = fill("D9E1F2") }
    widths(ss, [16, 10, 14, 14, 12, 12, 12, 14, 18]);
    freeze(ss, 2, 1); ss.autoFilter = `A1:I${e}`;

    // ---------------- 按状态汇总 ----------------
    head(zs, ["状态", "原始单子", "行数", "数量合计(支)", "理论重量合计(kg)"]);
    ST.forEach((s, i) => {
      const k = i + 2, mine = D.filter(r => r.s === s);
      const vals = [s, pages[s], fx(`COUNTIF(${R("C")},A${k})`, mine.length), fx(`SUMIFS(${R("H")},${R("C")},A${k})`, mine.reduce((a, r) => a + r.q, 0)), fx(`SUMIFS(${R("J")},${R("C")},A${k})`, mine.reduce((a, r) => a + kgOf(r), 0))];
      vals.forEach((x, j) => { const c = zs.getCell(k, j + 1); c.value = x; c.font = font(); c.border = B; c.fill = fill(SCOL[s]); c.alignment = CEN });
      zs.getCell("D" + k).numFmt = "#,##0"; zs.getCell("E" + k).numFmt = "#,##0.0";
    });
    ["合计", "", fx("SUM(C2:C4)", N), fx("SUM(D2:D4)", sum(r => r.q)), fx("SUM(E2:E4)", sum(kgOf))].forEach((x, j) => {
      const c = zs.getCell(5, j + 1); c.value = x; c.font = font({ bold: true }); c.border = B; c.fill = fill("D9E1F2"); c.alignment = CEN;
    });
    zs.getCell("D5").numFmt = "#,##0"; zs.getCell("E5").numFmt = "#,##0.0";
    widths(zs, [10, 12, 8, 14, 18]);

    // ---------------- 与昨天对比 ----------------
    head(cs, ["型号", "长度(米)", "理论支重(kg/6米)", "昨天支数", "昨天状态", "今天支数", "今天状态", "变化(支)", "说明", "页码"]);
    const kk = (m, L, w) => norm(m) + "\u0000" + (+L) + "\u0000" + (+w);
    const yk = new Map(); yrows.forEach(r => { const k = kk(r.m, r.L, r.w); const a = yk.get(k) || { q: 0, s: new Set(), m: r.m, L: +r.L, w: +r.w }; a.q += +r.q; a.s.add(r.s); yk.set(k, a) });
    const tk = new Map(); D.forEach((r, i) => { const k = kk(r.m, r.L, r.w); const a = tk.get(k) || { q: 0, s: new Set(), rows: [], m: r.m, L: r.L, w: r.w }; a.q += r.q; a.s.add(r.s); a.rows.push(i); tk.set(k, a) });
    const js = s => [...s].sort(cmpStr).join("/");
    const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
    const rowsC = [];
    tk.forEach((a, k) => {
      const y = yk.get(k); const kind = !y ? "新增" : (a.q !== y.q || !sameSet(a.s, y.s)) ? "有变化" : "相同";
      rowsC.push({ kind, m: a.m, L: a.L, w: a.w, yq: y ? y.q : null, ys: y ? js(y.s) : "", ts: js(a.s), o: a.rows[0], pg: `第${D[a.rows[0]].pg}张`, tq: a.q });
    });
    yk.forEach((y, k) => { if (!tk.has(k)) rowsC.push({ kind: "今天没有", m: y.m, L: y.L, w: y.w, yq: y.q, ys: js(y.s), ts: "", o: 1e6 + rowsC.length, pg: "今天没有", tq: 0 }) });
    rowsC.sort((a, b) => a.o - b.o);
    const CK = { "新增": "E2EFDA", "有变化": "FFF2CC", "今天没有": "EDEDED", "相同": null };
    rowsC.forEach((x, i) => {
      const k = i + 2;
      let expl = { "新增": "昨天没有这个规格", "今天没有": "昨天有，今天单上没有", "相同": "支数和状态都和昨天一样" }[x.kind];
      if (x.kind === "有变化") { const dq = x.tq - x.yq, p = []; if (dq) p.push((dq > 0 ? "多" : "少") + ` ${thou(Math.abs(dq))} 支`); if (x.ys !== x.ts) p.push(`状态 ${x.ys}→${x.ts}`); expl = p.join("；") }
      const tq = x.kind !== "今天没有" ? fx(`SUMIFS(${R("H")},${R("E")},A${k},${R("D")},B${k},${R("F")},C${k})`, D.filter(r => r.m === x.m && r.L === x.L && r.w === x.w).reduce((a, r) => a + r.q, 0)) : 0;
      const tqv = typeof tq === "number" ? tq : tq.result;
      const vals = [x.m, x.L, x.w, x.yq !== null ? x.yq : "", x.ys, tq, x.ts, fx(`F${k}-N(D${k})`, tqv - (x.yq || 0)), expl, x.pg];
      vals.forEach((val, j) => { const c = cs.getCell(k, j + 1); c.value = val === "" ? "" : val; c.font = font(); c.border = B; if (CK[x.kind]) c.fill = fill(CK[x.kind]) });
      [["B", "0.00"], ["C", "0.000"], ["D", "#,##0"], ["F", "#,##0"], ["H", "+#,##0;-#,##0;0"]].forEach(([c, f]) => { cs.getCell(c + k).numFmt = f });
    });
    const ce = rowsC.length + 1;
    cs.getCell("A" + (ce + 1)).value = "合计";
    const sD = rowsC.reduce((a, x) => a + (x.yq || 0), 0), sF = rowsC.reduce((a, x) => a + (x.kind !== "今天没有" ? D.filter(r => r.m === x.m && r.L === x.L && r.w === x.w).reduce((a, r) => a + r.q, 0) : 0), 0);
    [["D", sD], ["F", sF], ["H", sF - sD]].forEach(([col, val]) => { const c = cs.getCell(col + (ce + 1)); c.value = fx(`SUM(${col}2:${col}${ce})`, val); c.numFmt = col !== "H" ? "#,##0" : "+#,##0;-#,##0;0" });
    for (let c = 1; c <= 10; c++) { const x = cs.getCell(ce + 1, c); x.font = font({ bold: true }); x.border = B; x.fill = fill("D9E1F2") }
    { const c = cs.getCell("A" + (ce + 3)); c.value = `对比对象：${md(yday)} 的铝型材清单（按“型号+长度+支重”合计比，型号里的“-”不影响比对）。按照片顺序排列（今天没有的放在最后）。绿色=新增，黄色=有变化，灰色=今天没有，白色=相同。`; c.font = font({ italic: true, color: argb("7F7F7F") }) }
    widths(cs, [16, 10, 14, 11, 14, 11, 14, 11, 30, 9]);
    freeze(cs, 2, 1); cs.autoFilter = `A1:J${ce}`;

    // ---------------- 今日查错单 ----------------
    const LC = { "高": "FFC7CE", "中": "FFF2CC", "低": "EDEDED" };
    const cnt = l => F.filter(x => x.lvl === l).length;
    q0.getCell("A1").value = `今日查错单：高 ${cnt("高")} 处、中 ${cnt("中")} 处、低 ${cnt("低")} 处。请按顺序对照原单，先看“高”。`;
    q0.getCell("A1").font = font({ size: 12, bold: true });
    q0.getCell("A2").value = "高 = 很可能写错（型号不在库里、支重和平时不同、重复）；中 = 需要看一眼（数量跳动、长度少见、新规格、抄录时拿不准）；低 = 写法不统一。明细表序号 = 下面“明细序号”。";
    q0.getCell("A2").font = font({ size: 9, italic: true, color: argb("7F7F7F") });
    head(q0, ["级别", "明细序号", "页码", "状态", "长度(米)", "型号", "支重", "支数", "问题", "说明", "可能的正确写法 / 建议", "核对结果"], 4, 28, 10);
    F.forEach((x, j0) => {
      const j = j0 + 5, i = idx.get(x.id), r = D[i];
      const vals = [x.lvl, i + 1, `第${r.pg}张`, r.s, r.L, r.m, r.w, r.q, x.kind, x.why, x.sug || null, x.res || null];
      vals.forEach((val, c0) => {
        const c = q0.getCell(j, c0 + 1); c.value = val; c.font = (c0 === 0 || c0 === 8) ? FB10 : F10; c.border = B;
        c.alignment = c0 < 9 ? { horizontal: "center", vertical: "middle" } : { vertical: "middle", wrapText: true };
      });
      q0.getCell("A" + j).fill = fill(LC[x.lvl] || "EDEDED");
      q0.getCell("E" + j).numFmt = "0.00"; q0.getCell("G" + j).numFmt = "0.000"; q0.getCell("H" + j).numFmt = "#,##0";
    });
    if (F.length) dvList(q0, `L5:L${4 + F.length}`, ["没错", "已改正", "待查"]);
    else { q0.getCell("A5").value = "今天没有发现可疑的地方。"; q0.getCell("A5").font = FB10 }
    widths(q0, [6, 8, 8, 8, 8, 14, 8, 9, 16, 30, 30, 10]);
    freeze(q0, 2, 4); q0.autoFilter = `A4:L${4 + Math.max(1, F.length)}`;

    // ---------------- 按状态排列（自动） ----------------
    head(v, ["明细序号", "型号", "状态", "状态变化", "页码", "长度(米)", "理论支重", "支数", "理论重量(kg)", "备注", "排列"], 1, 30, 10);
    const order = D.map((r, i) => ({ i, key: rankOf(r) + i + 1 })).sort((a, b) => a.key - b.key).map(x => x.i);
    const src = { A: "A", B: "E", C: "C", D: "L", E: "B", F: "D", G: "F", H: "H", I: "J", J: "K" };
    const res = (col, r, i) => ({ A: i + 1, B: r.m, C: r.s, D: r.s !== r.s0 ? `◆ ${r.s0} → ${r.s}` : "", E: `第${r.pg}张`, F: r.L, G: r.w, H: r.q, I: kgOf(r), J: r.n || 0 })[col];
    for (let k = 1; k <= N; k++) {
      const rr = k + 1, i = order[k - 1], r = D[i];
      v.getCell("K" + rr).value = k;
      v.getCell("L" + rr).value = fx(`MATCH(SMALL(${R("N")},K${rr}),${R("N")},0)`, i + 1);
      Object.entries(src).forEach(([col, sc]) => { v.getCell(col + rr).value = fx(`INDEX(${R(sc)},$L${rr})`, res(col, r, i)) });
      for (let c = 1; c <= 11; c++) { const x = v.getCell(rr, c); x.font = F10; x.border = B; x.alignment = { horizontal: "center", vertical: "middle" } }
      v.getCell("J" + rr).alignment = { vertical: "middle" }; v.getCell("D" + rr).font = font({ size: 10, bold: true, color: argb("C00000") }); v.getCell("B" + rr).font = FB10;
      [["F", "0.00"], ["G", "0.000"], ["H", "#,##0"], ["I", "#,##0.0"]].forEach(([c, f]) => { v.getCell(c + rr).numFmt = f });
      v.getCell("K" + rr).font = G9; v.getCell("L" + rr).font = G9;
    }
    const ve = n;
    v.addConditionalFormatting({ ref: `A2:J${ve}`, rules: [{ type: "expression", priority: 1, stopIfTrue: true, formulae: ['LEFT($D2,1)="◆"'], style: { fill: cfFill(CHG) } }] });
    ST.forEach((s, j) => v.addConditionalFormatting({ ref: `A2:J${ve}`, rules: [{ type: "expression", priority: 2 + j, formulae: [`$C2="${s}"`], style: { fill: cfFill(SCOL[s]) } }] }));
    v.addConditionalFormatting({ ref: `A3:J${ve}`, rules: [{ type: "expression", priority: 5, formulae: ["$C3<>$C2"], style: { border: { top: side("305496", "medium") } } }] });
    const vt = ve + 1, chg = D.filter(r => r.s !== r.s0).length;
    v.getCell("A" + vt).value = "合计"; v.getCell("H" + vt).value = fx(`SUM(H2:H${ve})`, sum(r => r.q)); v.getCell("I" + vt).value = fx(`SUM(I2:I${ve})`, sum(kgOf));
    v.getCell("D" + vt).value = fx(`"改过状态："&COUNTIF(D2:D${ve},"◆*")&" 行"`, `改过状态：${chg} 行`);
    for (let c = 1; c <= 11; c++) { const x = v.getCell(vt, c); x.font = FB10; x.border = B; x.fill = fill("D9E1F2") }
    v.getCell("H" + vt).numFmt = "#,##0"; v.getCell("I" + vt).numFmt = "#,##0.0";
    { const c = v.getCell("A" + (vt + 2)); c.value = "在“明细”的状态列下拉改状态：改过的行变黄、写明“◆ 原状态 → 新状态”，并在这里跳到新状态那一组的最前面。这张表只看不改；明细里灰色的“原始状态、排序号”不要改。"; c.font = font({ size: 9, italic: true, color: argb("7F7F7F") }) }
    widths(v, [7, 14, 8, 20, 8, 8, 9, 9, 11, 40, 6, 6]);
    freeze(v, 2, 1);

    // ---------------- 型号查询 ----------------
    {
      const q = qs, NAVY = "1F3864", h = 6, r0 = 7, r1 = r0 + N - 1;
      const W = font({ size: 10, bold: true, color: argb("FFFFFF") }), BL = BOX("D9D9D9");
      q.mergeCells("C1:J1"); q.mergeCells("A1:B1");
      for (const c of "ABCDEFGHIJ") q.getCell(c + "1").fill = fill(NAVY);
      q.getCell("A1").value = "型号查询"; q.getCell("A1").font = font({ size: 16, bold: true, color: argb("FFFFFF") }); q.getCell("A1").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      q.getCell("C1").value = fx(`IF($B$2="","在黄色格子里输入型号",IF(COUNT($O$${r0}:$O$${r1})=0,"没找到这个型号，换个写法试试","找到 "&COUNT($O$${r0}:$O$${r1})&" 行"))`, "在黄色格子里输入型号");
      q.getCell("C1").font = font({ size: 12, bold: true, color: argb("FFE699") }); q.getCell("C1").alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      q.getRow(1).height = 34;
      q.getCell("A2").value = "输入型号 ▶"; q.getCell("A2").font = font({ size: 11, bold: true, color: argb(NAVY) }); q.getCell("A2").alignment = { horizontal: "right", vertical: "middle" };
      const md_ = side("BF8F00", "medium");
      q.getCell("B2").font = font({ size: 16, bold: true, color: argb("C00000") }); q.getCell("B2").fill = fill("FFF2CC"); q.getCell("B2").border = { left: md_, right: md_, top: md_, bottom: md_ }; q.getCell("B2").alignment = CA;
      q.mergeCells("C2:J2");
      q.getCell("C2").value = "可以只输一部分（如 8004、QG7801），不分大小写，有没有“-”都行"; q.getCell("C2").font = font({ size: 9, italic: true, color: argb("808080") }); q.getCell("C2").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      q.getRow(2).height = 32;
      const cards = [["A3:B3", "A4:B4", "合计", `SUM($G$${r0}:$G$${r1})`, '#,##0" 支"', "D9E1F2", NAVY], ["C3:D3", "C4:D4", "已入库", `SUMIFS($G$${r0}:$G$${r1},$C$${r0}:$C$${r1},"已入库")`, '#,##0" 支"', "E2EFDA", "375623"],
        ["E3:F3", "E4:F4", "包装中", `SUMIFS($G$${r0}:$G$${r1},$C$${r0}:$C$${r1},"包装中")`, '#,##0" 支"', "DDEBF7", "1F4E78"], ["G3:H3", "G4:H4", "刚生产", `SUMIFS($G$${r0}:$G$${r1},$C$${r0}:$C$${r1},"刚生产")`, '#,##0" 支"', "FCE4D6", "843C0C"],
        ["I3:J3", "I4:J4", "理论总重", `SUM($H$${r0}:$H$${r1})`, '#,##0.0" kg"', "EDEDED", "3A3A3A"]];
      const wsd = side("FFFFFF", "medium");
      cards.forEach(([lr, vr, lab, fml, nf, bg, fg]) => {
        [lr, vr].forEach(rg => { const [a, b] = rg.split(":"); [a, b].forEach(cl => { const c = q.getCell(cl); c.fill = fill(bg); c.border = { left: wsd, right: wsd } }) });
        const a = q.getCell(lr.split(":")[0]); a.value = lab; a.font = font({ size: 9, bold: true, color: argb(fg) }); a.alignment = { horizontal: "center", vertical: "bottom" };
        const vv = q.getCell(vr.split(":")[0]); vv.value = fx(fml, 0); vv.numFmt = nf; vv.font = font({ size: 15, bold: true, color: argb(fg) }); vv.alignment = { horizontal: "center", vertical: "middle" };
        q.mergeCells(lr); q.mergeCells(vr);
      });
      q.getRow(3).height = 18; q.getRow(4).height = 30; q.getRow(5).height = 8;
      ["序号", "型号", "状态", "页码", "长度(米)", "理论支重", "支数", "理论重量(kg)", "备注", "状态变化"].forEach((t_, i) => {
        const x = q.getCell(h, i + 1); x.value = t_; x.font = W; x.fill = fill(NAVY); x.alignment = CA; x.border = { left: side("FFFFFF"), right: side("FFFFFF") };
      });
      q.getRow(h).height = 26;
      const key = s => `SUBSTITUTE(SUBSTITUTE(UPPER(${s}),"-","")," ","")`;
      const qsrc = { A: "A", B: "E", C: "C", D: "B", E: "D", F: "F", G: "H", H: "J", I: "K", J: "L" };
      for (let k = 1; k <= N; k++) {
        const r = r0 + k - 1;
        q.getCell("O" + r).value = fx(`IF($B$2="","",IF(ISNUMBER(SEARCH(${key("$B$2")},${key(`INDEX(${R("E")},${k})`)})),${k},""))`, "");
        q.getCell("M" + r).value = fx(`IF(${k}>COUNT($O$${r0}:$O$${r1}),"",SMALL($O$${r0}:$O$${r1},${k}))`, "");
        Object.entries(qsrc).forEach(([col, sc]) => { q.getCell(col + r).value = fx(`IF($M${r}="","",INDEX(${R(sc)},$M${r})${"BCDIJ".includes(col) ? '&""' : ""})`, "") });
        for (let c = 1; c <= 10; c++) { const x = q.getCell(r, c); x.font = F10; x.alignment = { horizontal: "center", vertical: "middle" } }
        q.getCell("I" + r).alignment = { vertical: "middle", indent: 1 }; q.getCell("B" + r).font = FB10; q.getCell("J" + r).font = font({ size: 10, bold: true, color: argb("C00000") });
        [["E", "0.00"], ["F", "0.000"], ["G", "#,##0"], ["H", "#,##0.0"]].forEach(([c, f]) => { q.getCell(c + r).numFmt = f });
        q.getCell("M" + r).font = G9; q.getCell("O" + r).font = G9; q.getRow(r).height = 20;
      }
      q.addConditionalFormatting({ ref: `A${r0}:J${r1}`, rules: [{ type: "expression", priority: 1, stopIfTrue: true, formulae: [`LEFT($J${r0},1)="◆"`], style: { fill: cfFill(CHG), border: BL } }] });
      ST.forEach((s, j) => q.addConditionalFormatting({ ref: `A${r0}:J${r1}`, rules: [{ type: "expression", priority: 2 + j, stopIfTrue: true, formulae: [`$C${r0}="${s}"`], style: { fill: cfFill(SCOL[s]), border: BL } }] }));
      widths(q, [12, 18, 9, 8, 9, 9, 11, 13, 46, 18]);
      for (const c of "KLMNO") { q.getColumn(c).width = 13; q.getColumn(c).hidden = true }
      freeze(q, 2, r0 - 1, { showGridLines: false });
    }
    return wb.xlsx.writeBuffer();
  }
  root.QDX = { build };
  if (typeof module !== "undefined") module.exports = { build };
})(typeof window !== "undefined" ? window : globalThis);
