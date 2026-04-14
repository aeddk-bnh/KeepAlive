# Project Context: KeepAlive

## Mục tiêu
Dự án nhằm mục đích duy trì sự sống (KeepAlive) cho các trang web trên trình duyệt bằng cách mô phỏng hành vi của người dùng hoặc đơn giản là giữ phiên làm việc (session) thông qua trình duyệt thực tế.

## Yêu cầu cốt lõi
1. **Automation:** Mở các địa chỉ (URL) được chỉ định trên tab trình duyệt.
2. **Session Persistence:** Sử dụng Cookie/Profile tương ứng cho từng URL để giữ trạng thái đăng nhập.
3. **No Manual Login:** Hệ thống hoạt động tự động hoàn toàn, không yêu cầu người dùng phải đăng nhập thủ công trên trình duyệt của server (sử dụng session đã được import sẵn qua cookie).
4. **Control Dashboard:** Giao diện quản lý trạng thái các tab, thêm/sửa URL và Cookie.
4. **Reliability:** Tự động khởi động lại nếu trình duyệt crash hoặc tab bị đóng.

## Stack đề xuất
- **Backend:** Node.js (Express/Fastify)
- **Browser Control:** Playwright hoặc Puppeteer (Playwright được ưu tiên vì hỗ trợ đa trình duyệt tốt hơn).
- **Frontend:** React + Tailwind CSS (Vite).
- **Storage:** SQLite hoặc JSON file (cho cấu hình URL & Cookie).
