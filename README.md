# Bán Tạp Hóa

Phần mềm quản lý bán hàng tạp hóa độc lập trong repo `minhdienhp2013/bantaphoa`.

## Chạy và kiểm tra

Yêu cầu Node.js 24 trở lên; Java 21 để chạy Firebase Rules Emulator.

```bash
npm ci
npm test
npm run test:rules
npm run build
npm run build:desktop
```

Đóng gói installer trên Windows:

```bash
npm run desktop:build
```

Installer xuất vào `release/`. Bản Linux cần Wine nếu đóng gói Windows. CI kiểm tra web, Rules và installer Windows; không deploy production.

## Cấu hình riêng

Tạo Firebase Project mới, bật Authentication và Realtime Database. Copy `.env.example` thành `.env.local`, chỉ điền cấu hình project tạp hóa. Không commit `.env.local`. Áp dụng `database.rules.json` vào project mới sau khi cấu hình tài khoản Owner. Không cấu hình sẽ hiển thị trang hướng dẫn thay vì khởi tạo Firebase.

Owner đầu tiên được tạo bằng Firebase Console/Admin trong **project mới**: tạo tài khoản Authentication, lấy UID rồi tạo `/users/<UID mới>` trong Realtime Database với `uid` đúng UID đó, `displayName` là tên chủ cửa hàng, `role: "owner"`, `active: true`, `createdAt` và `updatedAt` là thời gian mili giây (giá trị `Date.now()`). Có thể thêm `email`. Console/Admin bỏ qua client Rules; không mở quyền database để bootstrap. Sau đó đăng nhập Owner và tạo Staff trong ứng dụng. Client không thể tự tạo Owner hoặc nâng Staff thành Owner; Owner hiện có không thể tự hạ vai trò/khóa mình qua ứng dụng.

Cloudflare Workers có thể triển khai repo này bằng Workers Builds: tên Worker `bantaphoa` (khớp `wrangler.jsonc`), nhánh `main`, build `npm run build`, deploy `npx wrangler deploy`. Static Assets phục vụ `dist` với fallback SPA cho các route của React Router. Đặt `NODE_VERSION=24` và các biến `VITE_FIREBASE_*` của Firebase tạp hóa trong **Build variables** trước khi build; biến runtime/bindings không thay thế được biến Vite lúc build. Không có `.env.local` trên GitHub. Cấu hình Firebase không đầy đủ sẽ hiện trang hướng dẫn. Worker này chỉ phục vụ frontend; Auth/Rules của Firebase tiếp tục bảo vệ dữ liệu.

Cloudflare Pages vẫn dùng được nếu chọn project mới, repo này, lệnh `npm run build`, thư mục output `dist`. Chỉ cấu hình dịch vụ ảnh Worker/R2 riêng nếu cần.

Không dùng Firebase, Pages, Worker/R2 hoặc dữ liệu production của Minh Điến. Bản này không thay đổi repo cũ.

## Phạm vi hiện tại

Giữ Authentication, Owner/Staff và phân quyền; hàng hóa, danh mục, barcode/QR; POS, khách hàng/NCC; nhập/xuất/kho/kiểm kê; công nợ, chi phí, báo cáo; sao lưu, in hóa đơn/in tem; Electron, máy in và két tiền.

POS chỉ bán sản phẩm: tìm/quét mã → giỏ hàng → số lượng/giảm giá/khách hàng → tiền mặt/chuyển khoản → lưu đơn và trừ tồn qua CAS → mở két khi tiền mặt → lựa chọn in hóa đơn. Mã nghiệp vụ được giữ khi lưu lỗi để thử lại chống trừ tồn hai lần.

Đã bỏ AI, dịch vụ nhanh, các nhánh dữ liệu liên quan khỏi POS, báo cáo, Dashboard, sao lưu/reset và Rules. Backup có node ngoài schema sẽ bị từ chối; không nhập backup Minh Điến vào project mới. Dữ liệu báo cáo dùng giá vốn được lưu lúc bán. Tồn kho CAS được giữ nguyên.

Chưa bổ sung quy đổi lon/lốc/thùng, barcode đa đơn vị, giá theo đơn vị, giá sỉ/lẻ hoặc lô/hạn sử dụng. Cần kiểm tra đăng nhập/đọc ghi trên Firebase riêng sau khi triển khai; chưa kiểm tra máy in/két thực tế. Icon Electron đang dùng mặc định.
