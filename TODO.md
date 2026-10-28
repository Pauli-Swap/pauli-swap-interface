# PauliSwap: TODO

Cập nhật 2026-10-28. File này gom việc của cả 4 repo:

- `pauli-swap`: hợp đồng swap
- `pauli-swap-interface`: giao diện
- `pauli-swap-indexer`
- `pauli-swap-prediction-market`: Predict, quest, faucet

Mỗi giai đoạn gồm một số batch. Làm xong giai đoạn này rồi mới sang giai đoạn sau. Các batch trong cùng một giai đoạn làm song song được, trừ khi có ghi chú khác.

Mốc cứng: **season 1 kết thúc ngày 2026-11-25** (`endsAt` 1795581833).

---

## Giai đoạn 0: Giữ an toàn cho code (nửa ngày)

Làm trước tiên, để những thay đổi về sau còn quay lại được.

### Batch 0.1: Git

- [x] `git init` cho `pauli-swap-interface` và `pauli-swap-indexer`. Kiểm `.gitignore` phải loại trừ `.env*` (trừ `*.example`), `node_modules`, `dist`, `data/`, các file sync `src/contracts/*` (nếu chọn không commit chúng) và `sybil-season-*.json`.
- [x] Commit phần đang dở ở `pauli-swap-prediction-market` (16 file, gồm `contracts/`, `scripts/`, `quests/` và `deployments/`).
- [x] Commit phần đang dở ở `pauli-swap` (69 file).
- [x] Trước khi commit, rà lại lần nữa: không có mnemonic nào nằm trong file được track.

### Batch 0.2: Remote

- [x] Push lên org `Pauli-Swap`, cả 4 repo public, bật secret scanning và push protection (2026-10-28).

---

## Giai đoạn 1: Chạy được season 1 (gấp, 2–3 ngày)

Mục tiêu: người dùng thật làm được **mọi** nhiệm vụ, và faucet cùng attester chạy 24/7.

### Batch 1.1: Công cụ quản trị market (`pauli-swap-prediction-market`)

- [ ] `scripts/qrvm/market.js` với 4 lệnh `create`, `resolve`, `cancel`, `list`. Mặc định chạy thử, chỉ gửi giao dịch khi có `--send`. Ký bằng ví owner.
- [ ] Thêm các npm script `market:create`, `market:resolve`, `market:cancel`, `market:list`.
- [ ] Tạo 3–5 market thử, mỗi cái có `closeTime` khác nhau (1 ngày, 3 ngày, 7 ngày).
- [ ] Kiểm trên giao diện:
  - Nút "Predict" trong Quests dẫn tới market đang mở.
  - Mua ≥ 10 XP thì nhiệm vụ #2 được ghi.
- [ ] Ghi lịch market (ai tạo, lúc nào, câu hỏi gì) vào README.

### Batch 1.2: Đưa faucet và attester vào process manager

- [ ] Chọn pm2 hoặc systemd trên VPS. Viết `ecosystem.config.cjs` hoặc unit file cho:
  - `npm run faucet`
  - `npm run attester -- --send`
- [ ] Tự khởi động lại khi crash. Log xoay vòng. Lưu `data/faucet-claims.jsonl` ra ổ bền.
- [ ] `/health` cho attester, ghi lần chạy cuối và số lần ghi XP lỗi. Có cảnh báo khi faucet còn dưới 1.000 QRL.
- [ ] Nạp thêm QRL cho ví deployer, tức ví attester (hiện còn 8,1 QRL).

### Batch 1.3: Deploy giao diện production

- [ ] `npm run build` rồi đẩy lên VPS (nginx static).
- [ ] Thêm `location /faucet/` vào nginx, rồi đặt `FAUCET_TRUSTED_PROXY=127.0.0.1` cho service faucet.
- [ ] Đặt `VITE_INDEXER_URL` trỏ tới indexer production.
- [ ] Smoke test bằng một ví mới:
  1. connect
  2. Get 50 QRL
  3. check-in
  4. swap
  5. predict
  6. chờ bot ghi XP
  7. nhiệm vụ ẩn #201 lộ tên

### Batch 1.4: Indexer trên VPS

- [ ] Đo dung lượng đĩa (gqrl, beacon, tốc độ tăng mỗi ngày). Dùng số đo để đặt `DISK_MIN_FREE_GB`, `EVENT_DAYS`, `HOUR_DATA_DAYS`.
- [ ] Chọn cách nối mạng tới gqrl: 127.0.0.1 hay docker bridge (INDEXER §13).
- [ ] Đặt restart policy cho docker compose. Backup Postgres mỗi ngày.

---

## Giai đoạn 2: Kết thúc season 1 (phải xong trước 2026-11-23)

Mục tiêu: chấm điểm, chọn top 3 và đóng season một cách đúng đắn và kiểm chứng được.

### Batch 2.1: Chốt quy tắc (cần bạn quyết)

- [ ] Định nghĩa "ngày hoạt động" (PROPOSAL-PREDICT §4.2). Đề xuất hiện tại: một ngày UTC có `QuestCompleted`, `Bought` hoặc `Sold`.
- [ ] Định nghĩa "market đã giao dịch".
- [ ] Ngưỡng nhận giải: tối thiểu 7 ngày hoạt động và 3 market.
- [ ] Cách phá hòa. Đề xuất: ví đạt điểm sớm hơn thì xếp trên.
- [ ] Bảng xếp hạng công khai hiện `score` (XP + claimable) hay chỉ hiện số dư XP.

### Batch 2.2: Xuất kết quả (`pauli-swap-indexer`)

Làm sau Batch 2.1.

- [ ] Viết `npm run predict:snapshot -- --season 1 --block <B>`.
- [ ] Mỗi ví ghi ra: `xp_balance`, `claimable` (market hủy thì tính `(yes+no)/2` trên từng vị thế), `score`, số ngày hoạt động, số market, có đủ điều kiện hay không.
- [ ] Ghi ra top 3, đây chính là tham số `winners` của `closeSeason`.
- [ ] Cảnh báo khi:
  - còn market mở tại B;
  - B vượt cursor của indexer;
  - B sau `endsAt`.
- [ ] Gắn cờ sybil từ `predict:sybil` vào kết quả.

### Batch 2.3: Đối chiếu với chain (PROPOSAL-PREDICT §6)

- [ ] `xp_balance` so với `xpOfSeason` cho từng ví.
- [ ] Vị thế so với `positionOf`.
- [ ] `claimable` so với `qrl_call claim(id)` trên từng market đã chốt.
- [ ] Chạy lại kịch bản hủy market trong `e2e.js`: buy, sell có lời, rồi cancel. Claim phải ra `(yes+no)/2`.
- [ ] Đổi `predict-devnet.json` giả lập redeploy. Chỉ các bảng `predict_*` được dựng lại.

### Batch 2.4: Runbook đóng season (`pauli-swap-prediction-market`)

- [ ] `docs/SEASON-END.md` ghi rõ từng bước:
  1. resolve hoặc cancel mọi market;
  2. chờ 48 giờ cho người dùng claim;
  3. chọn `snapshotBlock`;
  4. chạy snapshot;
  5. admin duyệt sybil và sửa `denylist.json`;
  6. gọi `closeSeason`;
  7. chuyển 10 QRL bằng tay;
  8. gửi danh sách WL cho QuantumArk;
  9. `startSeason` cho season 2.
- [ ] Thêm lệnh `season:close` (mặc định chạy thử) vào script quản trị.
- [ ] Thông báo trên giao diện: banner "Season kết thúc sau X ngày, hãy claim XP".

---

## Giai đoạn 3: Giao diện dùng dữ liệu indexer (1 tuần)

Mục tiêu: không đọc log thô trong trình duyệt nữa, và bảng xếp hạng khớp với cách chấm điểm.

### Batch 3.1: API Predict (`pauli-swap-indexer`, PROPOSAL-PREDICT §5)

- [ ] `predictSeason(id)`
- [ ] `predictMarkets(status, first, skip)` và `predictMarket(id)`: giá Yes, volume, số trader.
- [ ] `predictTrades(market, user, first, skip)`
- [ ] `predictPositions(user, market)`: số share và `claimable`.
- [ ] `predictLeaderboard(season, block, first, skip)`

### Batch 3.2: Chuyển giao diện sang API mới (`pauli-swap-interface`)

Làm sau Batch 3.1.

- [ ] Leaderboard: hiện `score`, `claimable`, có đủ điều kiện hay không, số ngày hoạt động.
- [ ] Rewards và biểu đồ market lấy dữ liệu từ indexer. Khi indexer không chạy thì quay về đọc log.
- [ ] Vị thế của tôi: tổng XP chờ claim trên mọi market.

### Batch 3.3: Hiển thị `$` (tùy chọn)

- [ ] Hiện USD khi `USD_SOURCE` khác `none` (INDEXER §11). Hiện tại devnet chưa có stablecoin thật, nên làm xong để sẵn đó.

---

## Giai đoạn 4: Chất lượng và test (song song với giai đoạn 3)

### Batch 4.1: Test tự động

- [ ] Giao diện:
  - unit test cho `lib/trade.ts`, `lib/v3.ts`, `lib/format.ts`;
  - Playwright smoke test (swap, quests, faucet) với ví stub, dựa trên `quests-shot.mjs` trong scratchpad.
- [ ] Indexer:
  - test SQL quy tắc quest (`src/quests.ts`) trên DB mẫu;
  - test che nhiệm vụ ẩn.
- [ ] Attester: test giới hạn 500 XP mỗi ngày, mốc dời sang ngày sau, denylist, không ghi trùng.
- [ ] CI chạy `tsc`, build và test cho từng repo.

### Batch 4.2: Kiểm tra giao diện

- [ ] Chạy `/frontend-check` trên mọi route, ở desktop và 375 px.
- [ ] Rà lại trạng thái lỗi:
  - RPC chết;
  - indexer chết;
  - faucet hết tiền;
  - ví sai mạng.

---

## Giai đoạn 5: Audit sâu hợp đồng (trước public testnet)

### Batch 5.1: Kiểm thử bổ sung (`pauli-swap`)

- [ ] Fuzz và kiểm thử bất biến cho pool V2/V3 trên QRVM.
- [ ] So oracle V2 (`price*CumulativeLast`) và V3 (`observe`) với bản tham chiếu theo thời gian.
- [ ] Replay test upstream của `snapshotCumulativesInside` lên lens.
- [ ] Thử deploy và giao dịch qua RPC công khai hoặc proxy ví có giới hạn kích thước request.

### Batch 5.2: Upstream và compiler

- [ ] Báo lỗi Q7 (mất lý do revert của SQRC-TN1 receiver) cho `qrl-contracts`.
- [ ] Theo dõi các bản phát hành `hypc`. Biên dịch lại và chạy lại toàn bộ audit trên bản mới. Rà lại lint OC-V3-02.

---

## Giai đoạn 6: Chuyển lên public testnet

### Batch 6.1: Hạ tầng và hợp đồng

- [ ] Deploy lại PauliSwap V2/V3, Predict và `QrlFaucet` lên public testnet.
- [ ] Nguồn QRL cho faucet trên testnet. Xem lại mức 50 QRL mỗi lần, cooldown 24 giờ, giới hạn 5 lần mỗi IP.
- [ ] Ví riêng cho từng vai trò: owner, attester, operator faucet. Không dùng chung deployer.

### Batch 6.2: Đồng bộ

- [ ] Chạy `sync:predict` cùng script sync của swap ở giao diện và indexer. Indexer đọc lại từ đầu.
- [ ] Thêm cấu hình mạng testnet cho giao diện (chainId, RPC, explorer).

### Batch 6.3: Ví

- [ ] Hỗ trợ QRL Connect / qrlwallet.com (dApp Connect qua QR), song song với extension QRL Web3 Wallet.

---

## Backlog (chưa xếp giai đoạn)

- [ ] Indexer:
  - vị thế V3/V2 kèm snapshot;
  - bảng `Tick`, event `Collect` / `Flash`;
  - day data toàn giao thức.
- [ ] Indexer: lọc giá đột biến, giá TWAP của V3, `where` filter và truy vấn theo thời điểm.
- [ ] Indexer: tự kiểm `balanceOf` (`getterSuspect`) và đối chiếu `slot0()` ở đầu chain.
- [ ] Danh mục quest cho season 2: xem tỷ lệ hoàn thành của season 1 rồi chỉnh XP và mốc.
- [ ] Đưa nhiệm vụ ẩn sang `quests/hidden.json`, chỉ có trên server, để không lộ qua repo.
