# PauliSwap: TODO

Cập nhật 2026-10-29. File này gom việc của cả 5 repo, cộng repo hạ tầng:

- `pauli-swap`: hợp đồng swap
- `pauli-swap-interface`: giao diện
- `pauli-swap-indexer`
- `pauli-swap-prediction-market`: Predict, quest, faucet
- `pauli-swap-ops` (private): nhiệm vụ ẩn, báo cáo sybil
- `Servers/OracleCloud/PauliSwap` (local, không public): deploy lên VPS, backup

Mỗi giai đoạn gồm một số batch. Làm xong giai đoạn này rồi mới sang giai đoạn sau. Các batch trong cùng một giai đoạn làm song song được, trừ khi có ghi chú khác.

Việc của từng repo khác được viết chi tiết thành proposal ngay trong repo đó:

| Repo | Proposal | Batch |
| --- | --- | --- |
| `pauli-swap-prediction-market` | `docs/PROPOSAL-SEASON-1-OPS.md` | 1.1 (CLI), 1.2 (health, cảnh báo), 2.1, 2.3 (cancel e2e), 2.4, 4.1 (attester), 6.1 |
| `pauli-swap-indexer` | `docs/PROPOSAL-SEASON-1.md` (dựa trên `PROPOSAL-PREDICT.md`) | 1.4 (docs), 2.2, 2.3, 3.1, 4.1 (indexer), backlog |
| `pauli-swap` | `docs/PROPOSAL-AUDIT-PHASE-5.md` | 5.1, 5.2 |

Mốc cứng: **season 1 kết thúc 2026-11-25 17:27 UTC** (`endsAt` 1795627668, đặt lại khi deploy lại Predict sau đợt reset devnet 2026-10-28).

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

- [x] Công cụ owner trên giao diện (2026-10-29): nút "New market" ở tab Markets; khối Admin ở trang market với Resolve Yes / No (sau `closeTime`) và Cancel. Chỉ hiện khi ví đang kết nối là `PredictMarket.owner()`, đọc on-chain. Owner là ví deployer `Qa1A64D6E7…34Ca`.
- [ ] `scripts/qrvm/market.js` (`create`, `resolve`, `cancel`, `list`, chạy thử trừ khi `--send`) và các npm script `market:*`: xem proposal của prediction-market §1.
- [x] Tạo 4 market thử, đóng lúc 30/10 12:00, 1/11, 5/11 và 12/11 (UTC), block 1860–1863. Câu hỏi đều kiểm được on-chain.
- [ ] Kiểm trên giao diện bằng ví thật:
  - Nút "Predict" trong Quests dẫn tới market đang mở.
  - New market / Resolve / Cancel với ví owner.
- [x] Mua ≥ 10 XP thì nhiệm vụ #2 được ghi (smoke test 1.3).
- [ ] Ghi lịch market vào README của prediction-market: bảng đã có trong proposal §2, còn chờ chuyển vào README.

### Batch 1.2: Đưa faucet và attester vào process manager

- [x] Docker compose dưới systemd (`pauliswap.service`) trên máy chain, cho faucet và `attester --send --interval 60`. Cấu hình ở repo hạ tầng `deploy/compose.yml`.
- [x] `restart: unless-stopped`, log json-file 10 MB × 3, `data/` nằm ở `/srv/pauli-swap/data` trên host.
- [x] Sửa race condition giới hạn theo IP của faucet (request song song từ cùng một IP đều qua được), đã deploy 2026-10-29.
- [ ] `/health` cho attester, cảnh báo khi faucet dưới 1.000 QRL: xem proposal của prediction-market §3. Hiện bot giám sát chỉ kiểm HTTP 200.
- [x] Ví attester riêng (`Q5d5325B65B8…`), đã nạp 1.000 QRL tiền gas. Deployer còn khoảng 99.980 QRL.

### Batch 1.3: Deploy giao diện production

- [x] https://pauliswap.org (qrl-vps, sau Cloudflare): `push_web.sh pauliswap.org` build rồi đẩy `dist/`. Phải chạy lại sau mỗi lần `sync:contracts`.
- [x] nginx `/faucet/` → máy chain `:8548`. Faucet chỉ tin `X-Forwarded-For` từ edge (`FAUCET_TRUSTED_PROXY`); edge lấy IP thật qua `CF-Connecting-IP`.
- [x] `VITE_INDEXER_URL=https://pauliswap.org/graphql`.
- [x] Seed lại devnet sau đợt reset: ACRN, QUSD, STAR, 2 cặp V2, 3 pool V3, lịch sử swap.
- [x] Smoke test bằng một ví mới, qua https://pauliswap.org, 2026-10-29 00:31–00:35 UTC: **ĐẠT**. Script ký trực tiếp, không qua extension, nên bước 1 "connect" vẫn cần thử tay với QRL Web3 Wallet. Faucet 200 (50 QRL ở block 1865), check-in +10 XP, swap 2 QRL → ACRN, mua Yes #0 với 10 XP; attester ghi #1, #2, #201 trong khoảng 3,5 phút, #201 lộ tên.
  1. connect
  2. Get 50 QRL
  3. check-in
  4. swap
  5. predict
  6. chờ bot ghi XP
  7. nhiệm vụ ẩn #201 lộ tên

### Batch 1.4: Indexer trên VPS

- [ ] Đo dung lượng đĩa. Mốc đầu (2026-10-29, khoảng 7 giờ sau reset): đĩa 96 GB, dùng 25 GB; các volume Docker tổng 828 MB; DB indexer 8,5 MB; build cache 7,3 GB (thu hồi được 4,7 GB). Đo lại sau 1 tuần để có tốc độ tăng mỗi ngày. Season 1 giữ mặc định: xem proposal của indexer §4.
- [x] Nối tới gqrl bằng `network_mode: host`, `RPC_URL` trỏ thẳng vào IP của container gqrl trên bridge của chain. Không dùng hai cách trong INDEXER §13; lý do ghi trong `deploy/compose.yml` của repo hạ tầng.
- [x] Restart policy `unless-stopped`.
- [x] Backup Postgres mỗi ngày: `pauliswap-backup.timer` lúc 03:30 UTC, `pg_dump` ra `/srv/pauli-swap/backups`, giữ 7 ngày (`push_chain_host.sh --backup`).

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
- [x] Đưa nhiệm vụ ẩn sang `quests/hidden.json` (gitignored, cài từ `pauli-swap-ops`).
