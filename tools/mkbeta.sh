#!/bin/bash
# 在仓库根目录运行：bash tools/mkbeta.sh <分支>  → 用该分支的代码生成 main 上的 beta/（云端数据用 _beta 后缀，和正式版分开）
# 用法：mkbeta.sh <分支>  —— 把分支的代码放进 main 的 beta/（测试数据单独存放）
set -e
B=$1; S=$(mktemp -d)
cd "$(git rev-parse --show-toplevel)"
mkdir -p $S && git archive $B | tar -x -C $S
git checkout -q main && git pull -q
rm -rf beta && mkdir beta
for f in index.html qd.js qdx.js qda.js qdbig.js ch.js scan.js catalog.js template.js exceljs.min.js sw.js manifest.webmanifest; do [ -f $S/$f ] && cp $S/$f beta/; done
cp -r $S/lib beta/
git show 9b3352d:beta/apple-touch-icon.png > beta/apple-touch-icon.png; git show 9b3352d:beta/icon-192.png > beta/icon-192.png; git show 9b3352d:beta/icon-512.png > beta/icon-512.png
python3 - <<'PY'
import json,re
p="beta/index.html";s=open(p,encoding="utf-8").read()
s=s.replace('<script src="lib/firebase-app-compat.js"></script>','<script>window.CLOUD_SUFFIX="_beta";window.CHUHUO_URL="../chuhuo/"</script>\n<script src="lib/firebase-app-compat.js"></script>',1)
s=re.sub(r"<title>.*?</title>","<title>铝型材管理（测试版）</title>",s,1)
s=re.sub(r'<meta name="apple-mobile-web-app-title" content="[^"]*">','<meta name="apple-mobile-web-app-title" content="铝型材测试">',s,1)
s=s.replace("<h1>铝型材管理</h1>","<h1>铝型材管理 <span style=\"font-size:13px;background:#c00000;color:#fff;border-radius:6px;padding:1px 8px;vertical-align:middle\">测试版</span></h1>",1)
open(p,"w",encoding="utf-8").write(s)
p="beta/manifest.webmanifest";m=json.load(open(p,encoding="utf-8"));m["name"]="铝型材管理（测试版）";m["short_name"]="铝型材测试";json.dump(m,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
p="beta/sw.js";s=open(p,encoding="utf-8").read();s=re.sub(r'const CACHE="[^"]*";','const CACHE="lxc-beta-'+__import__("time").strftime("%m%d%H%M")+'";',s,1);open(p,"w",encoding="utf-8").write(s)
PY
grep -q CLOUD_SUFFIX beta/index.html && echo "beta ready"
