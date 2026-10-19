// Tạo bản trang đơn (artifact/) từ dist/ sau khi chạy `npm run build`.
import fs from 'node:fs';
import path from 'node:path';

const dist = 'dist', out = 'artifact';
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const head = html.split('<!--ARTIFACT-START-->')[1].split('<!--ARTIFACT-HEAD-END-->')[0];
const body = html.split('<!--ARTIFACT-BODY-START-->')[1].split('<!--ARTIFACT-BODY-END-->')[0].replace(/<script[^>]*src="\.\/src\/main\.js"[^>]*><\/script>/, '');
const js = html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'maps'), { recursive: true });
fs.mkdirSync(path.join(out, 'textures'), { recursive: true });
fs.copyFileSync(path.join(dist, js), path.join(out, 'app.js'));
for (const f of fs.readdirSync(path.join(dist, 'maps'))) fs.copyFileSync(path.join(dist, 'maps', f), path.join(out, 'maps', f));
for (const f of fs.readdirSync(path.join(dist, 'textures'))) fs.copyFileSync(path.join(dist, 'textures', f), path.join(out, 'textures', f));
fs.writeFileSync(path.join(out, 'index.html'), `${head.trim()}\n${body.trim()}\n<script type="module" src="./app.js"></script>\n`);
console.log('Đã tạo', out, 'với', fs.readdirSync(path.join(out, 'maps')).length, 'tệp bản đồ');
