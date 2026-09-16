# WordPress.com novel download support

**Date:** 2026-08-09  
**Status:** Approved design  
**Goal:** Cho phép tool tải truyện từ blog `*.wordpress.com` (ví dụ [Hồng Bạch Song Hỉ](https://otruyennhamoctoly.wordpress.com/2025/11/05/hong-bach-song-hi/)) qua UI hiện có.

## Problem

- HTML của WordPress.com trả **403** + challenge JS (`Checking your browser...`), nên `fetchHtml` / axios không scrape được trang.
- `detectSite` hiện không nhận WordPress.com; request rơi vào nhánh truyenfull và fail sớm với 403.
- Tool đã có pattern tương tự cho `truyen66` (WP REST + Cheerio), nhưng blog `*.wordpress.com` không dùng được `/wp-json` trên host (404/chặn).

## Decision

Dùng **WordPress.com Public REST API** (`public-api.wordpress.com`) — đã xác nhận trả 200 cho mục lục và chương, không cần browser.

Không dùng Puppeteer/Playwright trong phạm vi này.

## Architecture

```
UI (index.html)
  → GET /api/story-info?url=...
  → GET /api/chapter?url=... (mỗi chương)
server.js
  detectSite → 'wordpress' khi host khớp *.wordpress.com
  fetchWordpressStoryInfo / fetchWordpressChapter
  → public-api.wordpress.com/rest/v1.1/sites/{hostname}/posts/slug:{slug}
  → Cheerio parse content HTML → cùng pipeline đoạn văn như truyen66
```

Nguồn `truyenfull` / `dammy` / `truyen66` giữ nguyên.

## Components

### 1. `detectSite(url)`
- Thêm: host khớp `*.wordpress.com` → `'wordpress'`.

### 2. `fetchWordpressStoryInfo(storyUrl)`
- Parse hostname + slug từ URL mục lục.
- `GET https://public-api.wordpress.com/rest/v1.1/sites/{hostname}/posts/slug:{slug}`.
- Title từ `title` (decode HTML entities nếu cần).
- Load `content` bằng Cheerio; thu thập `<a>`:
  - cùng hostname
  - loại trừ `/feed`, comment, chính URL mục lục
  - giữ thứ tự xuất hiện trong mục lục
  - title link: text link (vd. `01`, `pn1`) hoặc fallback slug
- Trả `{ title, totalChapters, totalPages: 1, chapters: [{ title, url }] }`.
- Lỗi rõ nếu không có post hoặc không có chapter links.

### 3. `fetchWordpressChapter(chapterUrl)`
- Cùng API theo slug chương.
- Title từ `title` post (hoặc heading trong content nếu rõ hơn).
- Wrap `content` HTML → strip noise WordPress (share, related, ads, nav/footer nếu có).
- Dùng `stripHiddenElements` / `stripNonTextNoise` / `extractParagraphsFromContent` như `truyen66`.
- Trả `{ title, content }` với content là chuỗi `<p>…</p>`.

### 4. API routes
- `/api/story-info`: nếu `site === 'wordpress'` → `fetchWordpressStoryInfo`, không gọi `fetchHtml`.
- `/api/chapter`: tương tự → `fetchWordpressChapter`.

### 5. UI
- Cập nhật placeholder (và gợi ý footer nếu cần) để liệt kê WordPress.com cùng các nguồn khác.

## Data notes (target story)

- Mục lục: ~90 links (chương 01–84 + phiên ngoại pn1–pn6).
- Slug không đều (vd. `hong-bach-song-hi-03` vs `hong-bach-song-hi-4`) — luôn lấy URL từ mục lục, không tự sinh slug.
- Phiên ngoại trong mục lục được tải cùng (không tách bộ).

## Error handling

| Case | Behavior |
|------|----------|
| API 404 / không có post | 500 + message “Không tìm thấy …” |
| Mục lục không có link chương | 500 + message rõ |
| Chapter API fail giữa chừng | UI hiện có đã báo lỗi từng chương; server trả message axios/API |
| Rate limit | Delay ngắn (~200ms) giữa chapter requests phía server nếu gọi tuần tự trong một handler; UI hiện gọi từng chapter — có thể thêm delay nhẹ phía client nếu cần sau khi test |

## Out of scope

- Self-hosted WordPress không phải `*.wordpress.com` (truyen66 đã cover một phần qua `/wp-json`).
- Vượt JS challenge HTML.
- Đổi format xuất HTML / bước chuyển version.

## Testing

1. `story-info` với URL mục lục Hồng Bạch Song Hỉ → title đúng, ~90 chapters, thứ tự đúng, có pn.
2. `chapter` với `.../hong-bach-song-hi-1/` → có đoạn văn, không còn chrome WP.
3. Paste URL vào UI → không còn 403; tải draft HTML thành công.
4. Regression: một URL dammy / truyenfull / truyen66 vẫn chạy như cũ.
