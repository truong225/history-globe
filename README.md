# Địa cầu Lịch sử

Ứng dụng web hiển thị địa cầu 3D với biên giới các quốc gia, đế quốc, nền văn hóa và các sự kiện lịch sử, theo thanh thời gian chạy từng tháng, từ năm 3000 TCN đến nay.

## Chạy trên máy

Cần Node.js 18 trở lên.

```bash
npm install
npm run dev        # mở http://localhost:5173
npm run build      # bản dựng tĩnh trong dist/
npm run preview    # xem thử bản dựng
```

Tính năng "Tải thêm sự kiện từ Wikidata" cần chạy trên máy (dev hoặc preview) vì trang phải gọi được `query.wikidata.org`.

## Triển khai lên Cloudflare Pages

Bản build là trang tĩnh trong `dist/` (khoảng 58 tệp, 23 MB, tệp lớn nhất dưới 2 MB), nằm trong giới hạn của Cloudflare Pages.
`public/_headers` đặt thời gian lưu đệm cho mã, bản đồ và ảnh vệ tinh.

Cách 1, kéo thả: Cloudflare dashboard → Workers & Pages → Create → Pages → Upload assets, đặt tên dự án, rồi tải lên tệp zip của thư mục `dist/` (hoặc chính thư mục `dist/`).

Cách 2, Wrangler (cần Node.js 18+):

```bash
npm install
npx wrangler login                 # đăng nhập Cloudflare trong trình duyệt
npx wrangler pages project create dia-cau-lich-su --production-branch main   # chỉ lần đầu
npm run deploy                     # build rồi tải dist/ lên dự án ghi trong wrangler.toml
```

Đổi `name` trong `wrangler.toml` nếu ngài dùng tên dự án khác. Dự án tạo bằng tải lên trực tiếp không chuyển sang kết nối Git được về sau.

Cách 3, kết nối GitHub: đẩy mã lên một kho GitHub, rồi trong Cloudflare chọn Pages → Connect to Git, với lệnh build `npm run build` và thư mục kết quả `dist`.

## Cấu trúc

- `index.html`: giao diện và CSS.
- `src/main.js`: địa cầu (globe.gl / three.js), thanh thời gian, danh sách sự kiện, truy vấn Wikidata.
- `src/flat.js`: chế độ bản đồ 2D (phép chiếu trụ đều trên canvas) và hiệu ứng WebGL trải phẳng / cuộn tròn địa cầu.
- `src/events.js`: bộ sự kiện tuyển chọn tiếng Việt. Mỗi dòng: `[năm, tháng, vĩ độ, kinh độ, loại, tiêu đề, mô tả]`; năm âm là TCN, tháng 0 là không rõ tháng.
- `src/names_vi.js`: từ điển tên quốc gia Anh–Việt và quy tắc dịch tự động theo mẫu.
- `public/maps/`: bản đồ đã giản lược, mỗi tệp một mốc năm (`-3000.json` … `2010.json`, `2020.json`).
- `public/textures/`: ảnh vệ tinh Blue Marble (NASA), bản đồ địa hình, mặt nước, mây và bầu trời sao (lấy từ ví dụ của three-globe).
- `scripts/prepare-maps.sh`: tạo lại `public/maps/` từ dữ liệu gốc.
- `scripts/build-artifact.mjs`: tạo bản trang đơn trong `artifact/` sau khi build.

## Giới hạn dữ liệu

- Biên giới chỉ có ở 50 mốc năm. Thời điểm trên thanh trượt dùng bản đồ của mốc gần nhất trước đó; ghi chú dưới tiêu đề cho biết đang dùng mốc nào.
- Mốc 2020 dùng ranh giới hiện đại của Natural Earth.
- Năm của các sự kiện cổ đại là ước tính theo sử liệu phổ biến; một số mốc (Văn Lang 2879 TCN) là niên đại truyền thuyết.

## Nguồn dữ liệu và giấy phép

- Bản đồ lịch sử: [historical-basemaps](https://github.com/aourednik/historical-basemaps) của André Ourednik, giấy phép GPL-3.0. Vì dùng dữ liệu này, khi phân phối lại cần tuân theo GPL-3.0.
- Ảnh bề mặt Trái Đất: NASA Blue Marble (phạm vi công cộng), qua bộ ảnh ví dụ của [three-globe](https://github.com/vasturiano/three-globe) (MIT).
- Bản đồ hiện đại: [Natural Earth](https://www.naturalearthdata.com/) qua gói [world-atlas](https://github.com/topojson/world-atlas) (phạm vi công cộng).
- Sự kiện bổ sung: [Wikidata](https://www.wikidata.org/) (CC0).
- Thư viện: [globe.gl](https://github.com/vasturiano/globe.gl), [three.js](https://threejs.org/), [d3-geo](https://github.com/d3/d3-geo).
