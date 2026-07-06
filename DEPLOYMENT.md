# Deploy Production — Novel Downloader

Tool gồm Express API (scrape truyện) + frontend tĩnh (`index.html`, `change-version.js`).

| Môi trường | Cách chạy | URL |
|------------|-----------|-----|
| **Dev** | `.\dev.cmd` hoặc `npm run dev` | http://localhost:3456 |
| **Prod** | Render / Railway / Docker / VPS | URL public do bạn đặt |

---

## Chuẩn bị (bắt buộc)

### 1. Đẩy code lên GitHub

```powershell
cd D:\OneDrive\TOOL_AI\Change_Version
git init
git add .
git commit -m "feat: novel downloader tool"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

**Không commit** `node_modules/` (đã có trong `.gitignore`).

---

## Cách 1 — Render (khuyên dùng, miễn phí)

Phù hợp app Node.js chạy liên tục, có scrape HTTP ra ngoài.

1. Đăng nhập https://render.com → **New** → **Blueprint**
2. Kết nối repo GitHub vừa push
3. Render đọc file `render.yaml` và tạo service `novel-downloader`
4. Chờ build xong → nhận URL dạng `https://novel-downloader-xxxx.onrender.com`
5. Kiểm tra:
   - `https://<url>/api/health` → `{"ok":true,...}`
   - Mở `https://<url>/` → dùng tool

**Lưu ý gói Free:**
- Sau ~15 phút không ai truy cập, server **ngủ** — lần mở đầu có thể chờ 30–60 giây
- Tải truyện dài (50+ chương) mất vài phút — giữ tab mở, không refresh giữa chừng

**Tùy chọn:** Đổi region trong `render.yaml` (`singapore` / `oregon`).

---

## Cách 2 — Railway

1. https://railway.app → **New Project** → **Deploy from GitHub repo**
2. Chọn repo, Railway tự nhận `npm start`
3. **Settings** → **Networking** → **Generate Domain**
4. Biến môi trường (tùy chọn): `NODE_ENV=production`

Railway tự gán `PORT` — không cần cấu hình thêm.

---

## Cách 3 — Docker (VPS, NAS, bất kỳ host nào)

```bash
docker build -t novel-downloader .
docker run -d -p 3456:3456 --name novel-downloader novel-downloader
```

Truy cập: `http://<ip-server>:3456`

Production nên đặt **Nginx/Caddy** phía trước + HTTPS (Let's Encrypt).

---

## Cách 4 — VPS + PM2

Trên server Linux (Ubuntu):

```bash
# Cài Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

git clone https://github.com/<user>/<repo>.git
cd <repo>
npm ci --omit=dev

sudo npm install -g pm2
NODE_ENV=production pm2 start server.js --name novel-downloader
pm2 save
pm2 startup
```

Mở port firewall (ví dụ 3456) hoặc reverse proxy qua Nginx.

---

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `PORT` | `3456` | Port (Render/Railway tự gán) |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | — | Đặt `production` khi deploy |

Không cần API key hay database.

---

## Checklist sau deploy

- [ ] `/api/health` trả về `ok: true`
- [ ] Trang chủ load được CSS/JS
- [ ] Tải thử 1 truyện ngắn (vài chương)
- [ ] Chuyển version + tải file `.html` thành công

---

## Lưu ý vận hành

- Tool scrape nội dung từ trang truyện bên thứ ba — chỉ dùng cho mục đích cá nhân/nội bộ; tuân thủ điều khoản trang nguồn.
- Không đặt rate limit phía server hiện tại — nếu public rộng, cân nhắc giới hạn IP hoặc auth sau.
- File `Change_Version_Novel_v2.html` là bản standalone cũ — **không** cần deploy (logic đã gộp vào `index.html`).
