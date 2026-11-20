/* 语音盘点：把一句话拆成 型号 / 长度 / 支重 / 支数，并和型号库比对。
   例：“8065，六米，支重一点二五，120支” → {m:"8065", L:6, w:1.25, q:120}
   也认：上一条数量改成130支 / 上一条长度改成5.8 / 上一条支重改成0.189 / 上一条型号改成8066 / 删掉上一条 / 撤销 / 切换已入库|包装中|刚生产 / 暂停 / 结束
   浏览器和 node 都能用（node 里用来测试）。 */
(function (root) {
  const D = { 零: 0, 〇: 0, 洞: 0, 一: 1, 幺: 1, 壹: 1, 二: 2, 两: 2, 贰: 2, 三: 3, 叁: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 拐: 7, 八: 8, 捌: 8, 九: 9, 玖: 9, 勾: 9 };
  const U = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000 };
  const CN = "零〇洞一幺壹二两贰三叁四肆五伍六陆七柒拐八捌九玖勾十拾百佰千仟万";
  // 一段中文数字 → 数字。“一百二十”=120，“一千二”=1200（口语），“八零六五”=8065（逐位念），“一点二五”=1.25
  function cnNum(s) {
    if (/^[\d.]+$/.test(s)) return parseFloat(s);
    let [ip, dp] = s.split(/[点.]/);
    let v;
    if (![...ip].some(c => U[c])) v = ip ? +[...ip].map(c => /\d/.test(c) ? c : D[c] ?? "").join("") : 0;   // 逐位念
    else {
      let total = 0, sec = 0, cur = 0, lastU = 1;
      for (const c of ip) {
        if (/\d/.test(c)) { cur = cur * 10 + +c; continue }
        if (c in D) { cur = D[c]; continue }
        const u = U[c]; if (!u) continue;
        if (u === 10000) { total += (sec + cur) * u; sec = 0; cur = 0; lastU = u; continue }
        sec += (cur || (u === 10 ? 1 : 0)) * u; cur = 0; lastU = u;
      }
      if (cur && lastU >= 100) cur = cur * lastU / 10;   // 一千二 → 1200，三百五 → 350
      v = total + sec + cur;
    }
    if (dp !== undefined && dp !== "") v = parseFloat(v + "." + [...dp].map(c => /\d/.test(c) ? c : D[c] ?? "").join(""));
    return v;
  }
  // 整句里的中文数字段换成阿拉伯数字
  const CD = "零〇洞一幺壹二两贰三叁四肆五伍六陆七柒拐八捌九玖勾", CU = "十拾百佰千仟万";
  function numify(t) {
    t = t.replace(/上一条|上条/g, "〖上条〗");   // “上一条”里的“一”不是数字
    // “一点二五一百二十”：小数后面紧跟着下一个数，把最后一位还给下一个数 → “一点二五 一百二十”
    t = t.replace(new RegExp(`点([${CD}]{2,})(?=[${CU}])`, "g"), (m, d) => "点" + d.slice(0, -1) + " " + d.slice(-1));
    t = t.replace(new RegExp(`[${CD}${CU}]+(?:点[${CD}]+)?`, "g"), m => " " + String(cnNum(m)) + " ");   // 中文数字和阿拉伯数字分开算（“8065六米”）
    return t.replace(/\s+/g, " ").trim();
  }
  function clean(t) {
    t = String(t || "").replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, " ");
    t = t.replace(/[，。、；;！!？?：:,]/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ").trim();
    // 型号里的“-”：念成“杠/横杠/线/横线/减”，常被听成汉字（5006CX线1 → 5006CX-1）
    t = t.replace(/([A-Za-z0-9])\s*(?:横杠|横线|中杠|中横|杠|线|减号|减|dash)\s*(?=[A-Za-z0-9零一二三四五六七八九两〇幺])/gi, "$1-");
    t = t.replace(/只重|值重|枝重|支中|只中|直重/g, "支重").replace(/(\d)\s*[只枝根条]/g, "$1支").replace(/(\d)\s*[根条只枝]$/, "$1支").replace(/公尺|M\b/gi, "米");
    return t;
  }
  const STATUS = { 已入库: "已入库", 入库: "已入库", 包装中: "包装中", 包装: "包装中", 刚生产: "刚生产", 生产: "刚生产", 在炉里: "刚生产", 时效: "刚生产" };
  function parse(raw) {
    let t = clean(raw); const n = numify(t).replace(/(\d)\s*[只枝根条]/g, "$1支");
    // 命令
    if (/^(撤销|撤回)$/.test(t.replace(/\s/g, ""))) return { cmd: "undo" };
    if (/(删除|删掉|取消|作废)\s*上一?条/.test(t)) return { cmd: "del" };
    if (/^(暂停|停一下)$/.test(t.replace(/\s/g, ""))) return { cmd: "pause" };
    if (/^(确认|确认上一?条|上一?条确认|没错|对的|对)$/.test(t.replace(/\s/g, ""))) return { cmd: "ok" };
    if (/^(结束|结束盘点|完成|盘点完成)$/.test(t.replace(/\s/g, ""))) return { cmd: "end" };
    let m = /(切换|改成|现在是|状态)\s*(已入库|入库|包装中|包装|刚生产|生产|在炉里|时效)/.exec(t); if (m && !/上一?条/.test(t)) return { cmd: "status", s: STATUS[m[2]] };
    if (/〖上条〗/.test(n)) {
      const p = {};
      if ((m = /(数量|支数|数)\s*(?:改|换)?(?:成|为|到)?\s*(\d+)/.exec(n))) p.q = +m[2];
      if ((m = /长度?\s*(?:改|换)?(?:成|为|到)?\s*(\d+(?:\.\d+)?)/.exec(n))) p.L = +m[1];
      if ((m = /支重\s*(?:改|换)?(?:成|为|到)?\s*(\d+(?:\.\d+)?)/.exec(n))) p.w = +m[1];
      if ((m = /型号\s*(?:改|换)?(?:成|为|到)?\s*([A-Z0-9][A-Z0-9 \-]*)/i.exec(n))) p.m = m[1].replace(/\s/g, "").toUpperCase();
      if (!Object.keys(p).length && (m = /(?:改|换)(?:成|为|到)?\s*(\d+)\s*支?$/.exec(n))) p.q = +m[1];
      if (Object.keys(p).length) return { cmd: "fix", p };
    }
    // 记录：支数（xx支，不是“支重”）、支重、长度、型号
    const r = { raw: String(raw || "") }; let s = " " + n + " ";
    // “5006CX杠一三米”：杠后面的数字和长度连在一起念成了“13米”，长度不可能大于 8 米 → 拆成 -1 和 3米
    s = s.replace(/-\s*(\d+(?:\.\d+)?)\s*米/, (m0, d) => { if (+d <= 8) return m0; const x = /^(\d+?)([2-7](?:\.\d+)?)$/.exec(d); return x ? "-" + x[1] + " " + x[2] + "米" : m0 });
    if ((m = /支重\s*(?:是|为)?\s*(\d+(?:\.\d+)?)/.exec(s))) { r.w = +m[1]; s = s.replace(m[0], " ") }
    if ((m = /(\d+(?:\.\d+)?)\s*米/.exec(s))) { r.L = +m[1]; s = s.replace(m[0], " ") }
    if ((m = /(\d+)\s*支(?!重)/.exec(s))) { r.q = +m[1]; s = s.replace(m[0], " ") }
    else if ((m = /(?:数量|共|一共)\s*(\d+)/.exec(s))) { r.q = +m[1]; s = s.replace(m[0], " ") }
    s = s.replace(/型号|长度|长|数量|是|的|呃|嗯|那个|这个/g, " ");
    // 型号：剩下最前面的一串字母数字（允许中间有空格、横杠）
    // 型号：从最前面开始拼，字母和数字分开念的（q g 902 b）拼在一起；两段纯数字（8065 120）不拼
    const toks = s.trim().split(/\s+/).filter(x => /^[A-Za-z0-9\-]+$/.test(x)), hasL = x => /[A-Za-z]/.test(x);
    if (toks.length) { let mdl = toks[0], used = 1; while (used < toks.length && (hasL(toks[used - 1]) || hasL(toks[used]) || toks[used].length === 1 || /-$/.test(toks[used - 1]))) { mdl += toks[used]; used++ }
      r.m = mdl.replace(/-+$/, "").toUpperCase(); toks.slice(0, used).forEach(x => { s = s.replace(x, " ") }) }
    // 没说“支”，最后剩一个整数当支数；没说“米”，剩下的小数 2–7 当长度
    const rest = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (r.L == null) { const i = rest.findIndex(x => x >= 2 && x <= 7.5); if (i >= 0) r.L = rest.splice(i, 1)[0] }
    if (r.w == null) { const i = rest.findIndex(x => x > 0 && x < 3 && !Number.isInteger(x)); if (i >= 0) r.w = rest.splice(i, 1)[0] }
    if (r.q == null) { const i = rest.findIndex(x => Number.isInteger(x) && x > 0); if (i >= 0) r.q = rest.splice(i, 1)[0] }
    return { rec: r };
  }

  /* ---------- 型号库比对 ---------- */
  const norm = s => String(s || "").toUpperCase().replace(/[\s\-－_]/g, "");
  // 读音容易混的：O/0、I/1、L/1、S/5、Z/2、B/8、G/6
  const look = s => norm(s).replace(/O/g, "0").replace(/[IL]/g, "1").replace(/S/g, "5").replace(/Z/g, "2");
  function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length] }
  function makeLib(catalog) {
    const byM = new Map(); (catalog || []).forEach(x => { if (!x || !x.m) return; const k = norm(x.m); if (!byM.has(k)) byM.set(k, { m: x.m, specs: [] }); const g = byM.get(k); if (!g.specs.some(y => +y.L === +x.L && +y.w === +x.w)) g.specs.push({ L: +x.L, w: +x.w }) });
    const models = [...byM.values()];
    function matchModel(said) {
      const k = norm(said), lk = look(said); if (!k) return { best: null, cands: [] };
      if (byM.has(k)) return { best: byM.get(k), exact: true, cands: [byM.get(k)] };
      const sc = models.map(g => { const gk = norm(g.m), gl = look(g.m); let d = Math.min(lev(k, gk), lev(lk, gl));
        if (gk.endsWith(k) || gk.startsWith(k)) d = Math.min(d, (gk.length - k.length) * 0.6);   // 只念了一部分
        const dg = s => s.replace(/[^0-9]/g, ""); if (dg(k) && dg(k) === dg(gk)) d = Math.min(d, 0.8);   // 数字一样、字母听错
        return { g, d } }).sort((a, b) => a.d - b.d);
      const top = sc.filter(x => x.d <= Math.max(1, Math.floor(k.length / 4))).slice(0, 5);
      return { best: top.length && (top.length === 1 || top[0].d < top[1].d) ? top[0].g : null, cands: top.map(x => x.g) };
    }
    // 补全并检查一条记录：返回 {m,L,w,q,flags:[...], cands:[...]}；flags 里有东西就标黄、提醒重说
    function resolve(r) {
      const out = { m: r.m || "", L: r.L, w: r.w, q: r.q, flags: [], cands: [] };
      if (!r.m) out.flags.push("没听到型号");
      else { const mt = matchModel(r.m); out.cands = mt.cands.map(g => g.m);
        if (mt.best) { if (!mt.exact) out.flags.push(`型号听成“${r.m}”，按型号库改成 ${mt.best.m}`); out.m = mt.best.m; out.lib = mt.best }
        else if (mt.cands.length) out.flags.push(`型号“${r.m}”不确定，请点候选`);
        else out.flags.push(`型号库里没有“${r.m}”`) }
      const g = out.lib;
      if (g && out.L == null) { const ls = [...new Set(g.specs.map(s => s.L))]; if (ls.length === 1) out.L = ls[0]; else out.flags.push("没听到长度") }
      else if (out.L == null) out.flags.push("没听到长度");
      if (g && out.L != null) { const ws = [...new Set(g.specs.filter(s => s.L === out.L).map(s => s.w))];
        if (!ws.length) out.flags.push(`型号库里 ${out.m} 没有 ${out.L} 米`);
        if (out.w == null) { if (ws.length === 1) { out.w = ws[0]; out.autoW = true } else if (ws.length) { out.flags.push("这个型号有几种支重，请说支重"); out.wOpts = ws } else out.flags.push("没听到支重") }
        else if (ws.length && !ws.includes(out.w)) { const near = ws.slice().sort((a, b) => Math.abs(a - out.w) - Math.abs(b - out.w))[0]; out.flags.push(`支重 ${out.w} 在库里没有（库里最近的是 ${near}）`) } }
      else if (out.w == null) out.flags.push("没听到支重");
      if (out.q == null || !(out.q > 0)) out.flags.push("没听到支数");
      out.kg = out.w > 0 && out.L > 0 && out.q > 0 ? out.w / 6 * out.L * out.q : null;
      return out;
    }
    return { matchModel, resolve, size: models.length };
  }
  const api = { cnNum, numify, clean, parse, makeLib, norm };
  if (typeof module !== "undefined") module.exports = api; else root.VP = api;
})(typeof window !== "undefined" ? window : globalThis);
