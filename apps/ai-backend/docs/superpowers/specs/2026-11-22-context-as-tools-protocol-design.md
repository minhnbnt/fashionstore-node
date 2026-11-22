# Context-as-Tools Chat Protocol — Design

## Intent

Protocol `/api/chat` hiện tại đóng băng `{ filters, product }` vào `metadata` của từng tin nhắn user tại lúc gửi; backend quét tin nhắn cuối rồi nhét snapshot vào system prompt. Snapshot này bị stale khi khách chuyển trang hoặc khi hydrate lịch sử cũ. Đổi sang: client gửi context **tươi theo từng request**, agent gọi tool `getPageContext()` để kéo context vào working memory khi cần.

## Goals

- `POST /api/chat` nhận `{ messages, context }`; context gồm đúng 3 field: `route`, `filters`, `productId?`.
- Context là request-scoped: mỗi request lấy state hiện tại từ URL, không đóng băng trong message.
- Tool `getPageContext` trả context của request hiện tại; output tool vào context theo cơ chế tool result thường.
- System prompt tĩnh; không còn suy luận context từ lịch sử.

## Non-goals

- Không đổi 4 tool cũ (`searchProducts`, `listCategories`, `getProductDetail`, `showProducts`) về mặt I/O.
- Không đổi model / provider / UI tool pills.
- Không fetch giỏ hàng / đơn hàng (hướng 3) trong lần này.
- Không giữ tương thích với client cũ gửi context trong `metadata`.

## Constraints

- Backend: Express 5, `ai@7.0.156`, `zod@4.6.7`; pnpm; test bằng `vp test`.
- Frontend: Vite + React 19, `ai@^7.0.156`, `@ai-sdk/react@^4.0.160`; pnpm; **không dùng ternary**, dùng `if` + early return.
- Frontend phải chạy `pnpm format`, `pnpm lint`, `pnpm build` xanh.
- `metadata` trong DB message là JSON chứa `parts` (agentHistory), **không phải** agent message metadata — không đụng vào.

## Approach đã chọn

Hướng 1 trong 3 hướng đã thảo luận: context theo request + tool đọc context. `prepareSendMessagesRequest` của `DefaultChatTransport` (đã xác nhận trong docs AI SDK v7) chèn `body.context`. Không dùng `dynamic-tool` part (hướng 2) vì khóa vào format part và vẫn để context cũ trong history. Không tự fetch từ backend chính (hướng 3) vì nằm ngoài mục tiêu lần này.

## Quyết định thiết kế

- Context thiếu / sai shape → HTTP 400, không fallback im lặng.
- `getPageContext` không render UI trong AgentTab (context là nội bộ).
- Lịch sử chat cũ vẫn đọc bình thường: agent không còn tin bất kỳ context nào nằm trong message.
- `contextRef` trong AgentTab đọc state mới nhất mỗi lần render, để transport không bị stale closure.
- Tách `src/lib/ai/context.ts` chứa type + schema dùng chung; `agent.ts` re-export để giữ import cũ.

## Flow

```
AgentTab render → contextRef.current = { route, filters, productId? }
submit → prepareSendMessagesRequest → POST /api/chat { messages, context }
server → validate context (400 nếu sai) → streamText(system tĩnh, tools có getPageContext)
agent → gọi getPageContext() → output vào context → gọi searchProducts / getProductDetail / showProducts
```
