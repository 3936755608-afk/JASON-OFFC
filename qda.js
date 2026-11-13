/* 数据分析引擎：每天一份“当天汇总”→ 看板 / 大数据要用的数。算法和“产品大数据库” Excel 一样。
   汇总格式：{d, n, flags, sp:[[k, m, L, w, 已入库支, 包装中支, 刚生产支, 需核对行数], ...]} */
(function (root) {
  const ST = ["已入库", "包装中", "刚生产"];
  const ALIAS = { "8020CX1": "8020CX", "QG7048": "QG704B", "CHEN801B": "CHZN801B", "Y8029": "STY8029" };
  const norm = m => String(m).toUpperCase().replace(/[\s\-_]/g, "");
  const key = m => { const n = norm(m); return ALIAS[n] || n };
  const kgOf = (w, L, q) => w / 6 * L * q;
  const BINS = [[0, 0.15, "<0.15"], [0.15, 0.20, "0.15–0.20"], [0.20, 0.25, "0.20–0.25"], [0.25, 0.30, "0.25–0.30"], [0.30, 0.40, "0.30–0.40"], [0.40, 0.60, "0.40–0.60"], [0.60, 1.0, "0.60–1.00"], [1.0, 99, "≥1.00"]];
  const binof = w => (BINS.find(b => b[0] <= w && w < b[1]) || BINS[BINS.length - 1])[2];
  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 };

  // 一天的记录 → 当天汇总（不含“已出货”和支数为 0 的行）
  function summarize(day, rows) {
    const map = new Map(); let n = 0, flags = 0;
    rows.forEach(r => {
      if (!(r.q > 0) || !ST.includes(r.s)) return; n++;
      const f = String(r.n || "").startsWith("【需核对】") ? 1 : 0; flags += f;
      const k = key(r.m), id = k + "|" + r.m + "|" + (+r.L) + "|" + (+r.w);
      const a = map.get(id) || [k, r.m, +r.L, +r.w, 0, 0, 0, 0];
      a[4 + ST.indexOf(r.s)] += +r.q; a[7] += f; map.set(id, a);
    });
    const sp = [...map.values()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] - b[2] || a[3] - b[3] || (a[1] < b[1] ? -1 : 1));
    return { id: day, d: day, v: 1, n, flags, sp };
  }

  // 多天汇总 → 分析结果
  function analyze(sums) {
    sums = sums.filter(s => s && s.d && Array.isArray(s.sp)).sort((a, b) => a.d < b.d ? -1 : 1);
    const days = sums.map(s => s.d);
    const disp = {}, variants = {}, flag = {}, prod = {}, model = {}, modelq = {}, spec = {}, specSt = {}, stOf = {};
    const daily = {};
    sums.forEach(s => {
      const t = daily[s.d] = { n: s.n, flags: s.flags, q: 0, kg: 0 }; ST.forEach(x => { t[x] = 0; t[x + "kg"] = 0 });
      s.sp.forEach(([k, m, L, w, a, b, c, f]) => {
        if (!(k in disp)) disp[k] = m; (variants[k] = variants[k] || new Set()).add(m); flag[k] = (flag[k] || 0) + f;
        const qs = [a, b, c], q = a + b + c, kg = kgOf(w, L, q);
        model[k] = model[k] || {}; modelq[k] = modelq[k] || {};
        model[k][s.d] = (model[k][s.d] || 0) + kg; modelq[k][s.d] = (modelq[k][s.d] || 0) + q;
        const sk = k + "|" + L + "|" + w; spec[sk] = spec[sk] || { k, L, w, ser: {} }; spec[sk].ser[s.d] = (spec[sk].ser[s.d] || 0) + q;
        prod[k] = prod[k] || [0, 0]; prod[k][0] += c; prod[k][1] += kgOf(w, L, c);
        ST.forEach((x, i) => { if (qs[i]) { t[x] += qs[i]; t[x + "kg"] += kgOf(w, L, qs[i]); (stOf[s.d + "|" + k] = stOf[s.d + "|" + k] || new Set()).add(x) } });
        t.q += q; t.kg += kg;
      });
    });
    // 每天出货(估)/新增(估)（按型号比上一次）
    const flow = {};
    for (let i = 1; i < days.length; i++) {
      const a = days[i - 1], b = days[i]; let ok = 0, oq = 0, ik = 0, iq = 0;
      Object.keys(model).forEach(k => {
        const x = model[k][a] || 0, y = model[k][b] || 0, qa = modelq[k][a] || 0, qb = modelq[k][b] || 0;
        if (x > y) { ok += x - y; oq += qa > qb ? qa - qb : 0 } else { ik += y - x; iq += Math.max(0, qb - qa) }
      });
      flow[b] = { oq, ok, iq, ik };
    }
    // 每个型号
    const np = Math.max(0, days.length - 1), last = days[days.length - 1];
    const MI = Object.keys(model).map(k => {
      const ser = days.map(d => modelq[k][d] || 0), serk = days.map(d => model[k][d] || 0);
      const pres = days.filter(d => (modelq[k][d] || 0) > 0);
      let oq = 0, iq = 0, ok = 0, ik = 0, nout = 0;
      for (let i = 1; i < ser.length; i++) { oq += Math.max(0, ser[i - 1] - ser[i]); iq += Math.max(0, ser[i] - ser[i - 1]); ok += Math.max(0, serk[i - 1] - serk[i]); ik += Math.max(0, serk[i] - serk[i - 1]); if (ser[i] < ser[i - 1]) nout++ }
      const cur = ser[ser.length - 1] || 0, avg = ser.reduce((x, y) => x + y, 0) / (ser.length || 1), mx = Math.max(...ser, 0), mn = Math.min(...ser);
      const dq = np ? oq / np : 0, din = np ? iq / np : 0;
      const h = Math.floor(ser.length / 2), first = h ? ser.slice(0, h).reduce((x, y) => x + y, 0) / h : 0, lastA = ser.length - h ? ser.slice(h).reduce((x, y) => x + y, 0) / (ser.length - h) : 0;
      let tr;
      if (pres.length >= 10 && new Set(pres.map(d => modelq[k][d])).size === 1) tr = "呆货(没动过)";
      else if (cur === 0 && mx > 0) tr = "已清空";
      else if (pres.length < 3) tr = "偶尔出现";
      else if (lastA > first * 1.25 && ser[ser.length - 1] >= ser[0]) tr = "上涨(可能积压)";
      else if (lastA < first * 0.75 || (mx > 0 && cur < 0.3 * mx)) tr = "下降(快没了)";
      else tr = "平稳";
      const specs = Object.values(spec).filter(s => s.k === k), ws = [...new Set(specs.map(s => s.w))].sort((a, b) => a - b), Ls = [...new Set(specs.map(s => s.L))].sort((a, b) => a - b);
      const sts = [...(stOf[last + "|" + k] || [])].sort();
      return { k, name: disp[k], nspec: specs.length, Ls, ws, bin: binof(median(ws)), first: pres[0] || "", last: pres[pres.length - 1] || "", ndays: pres.length,
        cur, curk: serk[serk.length - 1] || 0, avg, mx, mn, oq, ok, iq, ik, nout, dq, din, sell: dq > 0 ? cur / dq : null, prodq: (prod[k] || [0])[0], prodk: (prod[k] || [0, 0])[1],
        tr, flag: flag[k] || 0, var: [...variants[k]].sort(), st: sts.join("/") || "今天没有", ser, serk };
    });
    const binstat = BINS.map(([, , b]) => {
      const sps = Object.values(spec).filter(s => binof(s.w) === b);
      return { band: b, specs_now: sps.filter(s => s.ser[last]).length, stock_kg: sps.reduce((a, s) => a + kgOf(s.w, s.L, s.ser[last] || 0), 0),
        out_kg: MI.filter(m => m.bin === b).reduce((a, m) => a + m.ok, 0), prod_kg: MI.filter(m => m.bin === b).reduce((a, m) => a + m.prodk, 0) };
    });
    return { days, daily, flow, MI, binstat, spec, BINS: BINS.map(b => b[2]) };
  }
  root.QDA = { summarize, analyze, key, norm, binof, ST };
  if (typeof module !== "undefined") module.exports = root.QDA;
})(typeof window !== "undefined" ? window : globalThis);
