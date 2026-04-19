# Codebase Map: KeepAlive

## Cấu trúc Monorepo (npm workspaces)

Dự án hiện tại được chia thành các ứng dụng (`apps/`) và thư viện dùng chung (`packages/`):

```
KeepAlive/
├── docs/                 # Tài liệu dự án
│   ├── context.md        # Bối cảnh và mục tiêu dự án
│   └── codebase-map.md   # Bản đồ mã nguồn
├── apps/
│   ├── api/              # Backend API & Scheduler (Fastify)
│   │   ├── src/
│   │   │   ├── routes/   # API endpoints (targets, session-sync)
│   │   │   ├── services/ # Session watcher & background jobs
│   │   │   └── server.ts # Điểm vào của server
│   │   └── package.json
│   └── web/              # Dashboard Frontend (React + Vite)
│       ├── public/       # Static assets, bao gồm noVNC (vnc.html)
│       ├── src/          
│       │   ├── App.tsx   # Điểm vào chính của client và Live Session Control
│       │   └── index.css # Tailwind CSS
│       └── package.json
├── packages/
│   ├── browser-core/     # Cấu hình và quản lý trình duyệt (Playwright)
│   │   └── src/index.ts  # Spawn Xvfb, x11vnc, websockify và khởi tạo context
│   ├── database/         # Schema Prisma và SQLite DB
│   │   ├── prisma/       # schema.prisma, dev.db
│   │   └── src/index.ts  # Export Prisma client
│   └── shared-types/     # Interface dùng chung (Target, Status...)
├── Dockerfile            # Môi trường chạy Node.js + Display dependencies
├── docker-compose.yml    # Khai báo stack dịch vụ
└── package.json          # Root package chứa khai báo workspaces
```

## Thành phần chính
1. **Browser Engine (`browser-core`):** Quản lý các phiên làm việc trình duyệt ở chế độ `headless: false` trên các virtual display riêng biệt (Xvfb). Khởi tạo `websockify` và `x11vnc` cho từng phiên để hỗ trợ kết nối noVNC.
2. **Scheduler (`sessionWatcher`):** Chạy ngầm trong `api`, kiểm tra định kỳ (polling/refresh) và mô phỏng hành vi người dùng bằng Playwright để giữ phiên đăng nhập.
3. **API Gateway (`api`):** Cung cấp REST API cho Dashboard, khởi tạo luồng VNC và quản lý cấu hình các URL/Cookies.
4. **Dashboard (`web`):** Giao diện quản lý trạng thái các mục tiêu (targets) và hiển thị iframe noVNC để tương tác trực tiếp với các phiên đang chạy.
