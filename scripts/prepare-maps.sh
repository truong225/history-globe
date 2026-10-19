#!/usr/bin/env bash
# Tạo lại public/maps/ từ historical-basemaps và world-atlas.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d ../historical-basemaps ] || git clone --depth 1 https://github.com/aourednik/historical-basemaps.git ../historical-basemaps
mkdir -p public/maps
for f in ../historical-basemaps/geojson/world_*.geojson; do
  b=$(basename "$f" .geojson); y=${b#world_}
  if [[ $y == bc* ]]; then n=-${y#bc}; else n=$y; fi
  if (( n >= -3000 )); then
    npx mapshaper -i "$f" -simplify 6% keep-shapes -clean -filter-fields NAME,SUBJECTO,PARTOF \
      -o "public/maps/$n.json" format=geojson precision=0.01
  fi
done
npx mapshaper -i node_modules/world-atlas/countries-50m.json -target countries \
  -simplify 15% keep-shapes -rename-fields NAME=name -o public/maps/2020.json format=geojson precision=0.01
# Sửa vài tên bị lỗi mã hóa ký tự trong dữ liệu gốc.
python3 - <<'PY'
import json, glob
fix = {'Teotihuac�n': 'Teotihuacán', 'Monte Alb�n': 'Monte Albán', 'Arag�n': 'Aragón'}
for f in glob.glob('public/maps/*.json'):
    d = json.load(open(f, encoding='utf-8'))
    for x in d['features']:
        for k, v in list(x['properties'].items()):
            if v in fix: x['properties'][k] = fix[v]
    json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
PY
