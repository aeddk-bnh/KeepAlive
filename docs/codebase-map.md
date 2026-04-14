# Codebase Map: KeepAlive

## Cấu trúc dự kiến
```
KeepAlive/
├── docs/                 # Tài liệu dự án
│   ├── context.md        # Bối cảnh và mục tiêu dự án
│   └── codebase-map.md   # Bản đồ mã nguồn
├── server/               # Backend API & Controller
│   ├── src/
│   │   ├── server.ts     # Điểm vào của server
│   │   ├── routes/       # API endpoints
│   │   └── services/     # Logic nghiệp vụ
├── client/               # Dashboard (Frontend)
│   ├── src/
│   │   ├── App.tsx       # Điểm vào của client
│   │   └── components/   # UI Components
├── browser/              # Cấu hình và quản lý trình duyệt
│   ├── contexts/         # Các trình duyệt/profile riêng biệt
├── tests/                # Test cases
└── package.json          # Quản lý dependencies
```

## Thành phần chính
1. **Browser Engine:** Quản lý các phiên làm việc trình duyệt (Playwright instances).
2. **Scheduler:** Quản lý việc mở lại tab, làm mới trang (refresh), hoặc điều hướng (navigate) theo lịch trình.
3. **API Gateway:** Cung cấp REST API cho Dashboard giao tiếp.
4. **Config Manager:** Quản lý cấu hình URL, Cookies, và lịch trình KeepAlive.
