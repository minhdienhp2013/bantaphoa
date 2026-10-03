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

Cloudflare Pages dùng project mới, repo này, lệnh `npm run build`, thư mục output `dist`. Chỉ cấu hình dịch vụ ảnh Worker/R2 riêng nếu cần.

Không dùng Firebase, Pages, Worker/R2 hoặc dữ liệu production của Minh Điến. Bản này không thay đổi repo cũ.

## Phạm vi hiện tại

Giữ Authentication, Owner/Staff và phân quyền; hàng hóa, danh mục, barcode/QR; POS, khách hàng/NCC; nhập/xuất/kho/kiểm kê; công nợ, chi phí, báo cáo; sao lưu, in hóa đơn/in tem; Electron, máy in và két tiền.

POS chỉ bán sản phẩm: tìm/quét mã → giỏ hàng → số lượng/giảm giá/khách hàng → tiền mặt/chuyển khoản → lưu đơn và trừ tồn qua CAS → mở két khi tiền mặt → lựa chọn in hóa đơn. Mã nghiệp vụ được giữ khi lưu lỗi để thử lại chống trừ tồn hai lần.

Đã bỏ AI, dịch vụ nhanh, các nhánh dữ liệu liên quan khỏi POS, báo cáo, Dashboard, sao lưu/reset và Rules. Backup có node ngoài schema sẽ bị từ chối; không nhập backup Minh Điến vào project mới. Dữ liệu báo cáo dùng giá vốn được lưu lúc bán. Tồn kho CAS được giữ nguyên.

Chưa bổ sung quy đổi lon/lốc/thùng, barcode đa đơn vị, giá theo đơn vị, giá sỉ/lẻ hoặc lô/hạn sử dụng. Chưa kết nối Firebase/Cloudflare thật và chưa kiểm tra máy in/két thực tế. Icon Electron đang dùng mặc định.
