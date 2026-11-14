#!/bin/bash
# 在仓库根目录运行：bash tools/mkxsbeta.sh  → 用当前 xiaoshou/ 生成销售 App 测试版 xiaoshou-beta/（数据用 _beta 后缀，和正式版分开）
set -e
cd "$(git rev-parse --show-toplevel)"
rm -rf xiaoshou-beta && cp -r xiaoshou xiaoshou-beta
python3 - <<'PY'
import json,re,time
p="xiaoshou-beta/index.html";s=open(p,encoding="utf-8").read()
s=s.replace('<script>window.CLOUD_LOG="xs_log";','<script>window.CLOUD_SUFFIX="_beta";window.CLOUD_LOG="xs_log";',1)
s=s.replace('content="PETRJASON 销售">','content="PETRJASON 销售测试">',1)
open(p,"w",encoding="utf-8").write(s)
p="xiaoshou-beta/manifest.webmanifest";m=json.load(open(p,encoding="utf-8"));m["name"]="PETRJASON 销售（测试版）";m["short_name"]="销售测试";json.dump(m,open(p,"w",encoding="utf-8"),ensure_ascii=False)
p="xiaoshou-beta/sw.js";s=open(p,encoding="utf-8").read();s=re.sub(r'const CACHE="[^"]*";','const CACHE="xsbeta-'+time.strftime("%m%d%H%M")+'";',s,1);s=s.replace('k.startsWith("xiaoshou-")','k.startsWith("xsbeta-")');open(p,"w",encoding="utf-8").write(s)
PY
grep -q 'CLOUD_SUFFIX="_beta"' xiaoshou-beta/index.html && echo "xiaoshou-beta ready"
