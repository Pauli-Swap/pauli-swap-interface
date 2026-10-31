# Proposal: phần giao diện còn nợ season 1

Trạng thái: đề xuất 2026-10-30 từ TODO chung ([TODO.md](../TODO.md)), sửa lại cùng ngày sau quyết định tự trả XP. Season 1 kết thúc lúc **2026-11-25 17:27 UTC** (`endsAt` 1795627668, giữ nguyên sau đợt redeploy).

Proposal này ghi phần giao diện của giai đoạn 1, 3 và 4. Giai đoạn 0 đã xong ngày 2026-10-28. Việc của các repo khác nằm trong proposal của chính repo đó; §7 tóm tắt những gì giao diện cần từ các repo đó.

## Quyết định 2026-10-30: tự trả XP khi market chốt

Người dùng không phải tự claim nữa. Khi market được resolve hoặc cancel, XP tự về ví.

- **`PredictMarket`** có thêm hàm `settle(id, users[])`:
  - ai gọi cũng được, nhưng XP luôn về đúng ví của từng user;
  - chạy theo lô, ví không có gì để nhận thì bỏ qua;
  - mỗi ví phát event `Claimed` như cũ.
- **Bot attester** thấy `MarketResolved` / `MarketCancelled` thì lấy danh sách holder từ `predictPositions(market)` rồi gọi `settle`.
- `claim(id)` vẫn giữ để người dùng tự nhận nếu bot chậm.
- **Redeploy cả Predict (`PauliPredictXP` + `PredictMarket`)**, rồi `startSeason` lại với cùng `endsAt`.
  - Nhân tiện sửa XP để nhận được nhiều market, lần sau chỉ phải thay Market.
  - Mất XP và quest của khoảng 3 ví thử. 4 market thử được tạo lại.
  - Chi tiết ở `PROPOSAL-SEASON-1-OPS.md` §9 của repo prediction-market.

Hệ quả cho TODO:

- **Bỏ khỏi giai đoạn 2:** cửa sổ claim 48 giờ và banner "hãy claim XP".
- **Score:** sau khi bot trả xong thì `claimable` về 0, nên `score` thực chất là XP. Chỉ trong lúc bot chưa chạy tới thì hai số mới khác nhau.
- **Giai đoạn 2 vẫn còn phần chọn top 3:** quy tắc 2.1, snapshot, `closeSeason`. Phần này thuộc indexer và prediction-market, giao diện không phải làm gì.

## 0. Hiện trạng

Kiểm ngày 2026-10-30.

- Mọi dữ liệu Predict đều đọc log RPC ngay trong trình duyệt.
  - `contractLog` ([src/lib/predict.ts:113](../src/lib/predict.ts#L113)) quét từ `PREDICT.startBlock`, mỗi lần 20k block.
  - `usePredictLogs`, `useMarkets` và `useLeaderboard` ([src/hooks/predict.ts](../src/hooks/predict.ts)) chạy lại log để tính giá, volume, biểu đồ và bảng xếp hạng.
- Season, XP và vị thế đọc trực tiếp bằng `call()`: `useSeason`, `useXp`, `usePosition`.
- Indexer mới chỉ dùng cho `useQuests` (`questProgress`). Hook này không gọi `indexerBlock`, nên không kiểm độ trễ.
- Ở phần DEX đã có sẵn một mẫu "indexer trước, RPC sau" để làm theo:
  - `fetchRange` ([src/lib/history.ts:118](../src/lib/history.ts#L118)) lấy dữ liệu đã index tới block của indexer, phần còn lại đọc RPC, và chuyển hẳn sang RPC nếu indexer lỗi.
  - `indexerBlock` ([src/lib/indexer.ts:25](../src/lib/indexer.ts#L25)) trả `null` khi indexer lỗi hoặc trễ quá `VITE_INDEXER_MAX_LAG`.
- Claim hiện chỉ làm được ở trang market: `SettledPanel` trong [src/pages/PredictMarket.tsx](../src/pages/PredictMarket.tsx), nút Claim gọi `claim(id)`.
- Thử nghiệm: vitest mới có cho `lib/v3.ts` và `lib/fee.ts`. Chưa có Playwright script, cũng chưa có CI.

## 1. Giai đoạn 1: redeploy và thử bằng ví thật

### 1.1 Đồng bộ sau redeploy

Làm sau khi prediction-market redeploy xong (OPS §9).

- [ ] `npm run sync:predict` để lấy địa chỉ, `startBlock` và ABI mới (có `settle`, có XP nhiều market). Kiểm `tsc` vẫn qua.
- [ ] `SettledPanel`:
  - đổi câu chữ: market đã chốt thì "XP đã được trả tự động về ví";
  - nếu `positionOf` vẫn còn share, nghĩa là bot chưa tới lượt, thì hiện "Đang trả XP…" cùng nút Claim để tự nhận;
  - đọc event `Claimed` của ví để hiện số XP đã nhận và tx hash.
- [ ] Công cụ owner (`PredictAdmin.tsx`): sau Resolve / Cancel, ghi chú rằng bot sẽ trả XP trong khoảng 1–2 phút.
- [ ] Chạy lại `push_web.sh pauliswap.org`.

### 1.2 Thử bằng ví thật

Smoke test ngày 2026-10-29 dùng script ký trực tiếp, không qua extension. Vì vậy những bước dưới đây phải làm tay trên https://pauliswap.org, bằng extension QRL Web3 Wallet, sau khi redeploy. Mỗi dòng ghi lại tx hash hoặc ảnh chụp, rồi tick trong TODO.

- [ ] **Connect:** ví mới connect được. Ví đang ở mạng khác thì thấy "Wrong network", và nút switch hoạt động.
- [ ] **Quests:** nút "Predict" dẫn tới một market đang mở.
- [ ] **Owner, New market:** chỉ hiện khi ví là `PredictMarket.owner()`. Form chặn `closeTime` > `seasonEndsAt`.
- [ ] **Owner, Resolve:** dùng một market đóng sớm, tạo riêng để thử. Sau khi resolve, bên thắng tự nhận XP mà không phải bấm gì. Ghi lại số giây từ lúc resolve tới lúc XP về.
- [ ] **Owner, Cancel:** XP tự về ví, đúng `(yes + no) / 2`.
- [ ] **Swap có phí 0.25%:** swap QRL → ACRN và ACRN → QRL. Số tiền nhận được khớp với quote. Ví treasury `Q2cE73E96…31BD24` nhận đúng 0.25% của output. Wrap / unwrap không mất phí.

## 2. Giai đoạn 2: không còn việc của giao diện

Banner claim và cửa sổ 48 giờ đã bỏ, xem phần quyết định ở đầu file. Đồng hồ "Ends in …" sẵn có ở Leaderboard là đủ. Phần chọn top 3 do indexer và prediction-market làm.

## 3. Giai đoạn 3: chuyển sang API indexer (TODO 3.2, 3.3)

API đã có trên indexer (`pauli-swap-indexer/src/api.ts:351-360`). Indexer phải được deploy lên VPS và đọc lại từ đầu sau redeploy (indexer §7). Nguyên tắc: indexer chết hoặc trễ thì giao diện vẫn chạy bằng đường log hiện tại. Người dùng chỉ thấy mất các cột chỉ indexer mới có.

### 3.0 Lớp dữ liệu

- [ ] Tạo `src/lib/predictIndexer.ts`. Gói 6 query `predictSeason`, `predictMarkets`, `predictMarket`, `predictTrades`, `predictPositions` và `predictLeaderboard`, dùng `gql` / `gqlAll` sẵn có.
- [ ] Thêm `predictIndexerBlock(head)`, giống `indexerBlock` nhưng đọc `_meta.predictBlock`. Áp vào cả `useQuests`.
- Những điểm cần nhớ khi gọi API:
  - XP là chuỗi wei, 18 chữ số thập phân.
  - Truyền `block` vượt cursor thì query lỗi, nên không gửi `block`.
  - Mỗi request tối đa 10 root field. `predictLeaderboard` và `questProgress` là field nặng.

### 3.1 Leaderboard

- [ ] Khi indexer chạy, `useLeaderboard` lấy `predictLeaderboard`. Ngược lại, quay về `leaderboard()` trên log như hiện nay.
- [ ] Cột chính là `score`. Lúc bot đã trả xong thì nó bằng XP. Khi `claimable` > 0 (bot chưa tới) thì hiện thêm "+N đang trả" nhỏ bên cạnh.
- [ ] Cột mới: đủ điều kiện hay chưa, `activeDays` / `minDays`, `marketsTraded` / `minMarkets`.
- [ ] Indexer xếp hạng mọi ví, kể cả ví chưa đủ điều kiện. Cột "Prize", `PrizeDistance` và podium phải chỉ tính trên các ví đủ điều kiện. Ví chưa đủ điều kiện thì gắn nhãn, ví dụ "cần thêm 2 ngày".
- [ ] `YouCard`: hiện tiến độ đủ điều kiện của chính ví đang kết nối, dạng "5/7 ngày · 2/3 market".
- [ ] `winRate` không có trong indexer. Đề xuất giữ cột này và tính từ log như hiện nay (§6).
- Phải sửa: `MiniLeaderboard`, `Leaderboard`, `PodiumCard`, `PlayerRow`, `YouCard`, `PrizeDistance` trong [src/pages/Predict.tsx](../src/pages/Predict.tsx).

### 3.2 Market và biểu đồ

- [ ] Danh sách market và trang market lấy giá, volume, số trader và trạng thái từ `predictMarkets` / `predictMarket`.
- [ ] Biểu đồ giá và `price24h`: indexer **chưa có** query lịch sử giá (§7). Trong lúc chờ, biểu đồ vẫn chạy lại log. Khi indexer có `predictPriceHistory` thì chuyển sang.
- [ ] Danh sách trade gần đây ở trang market lấy từ `predictTrades(market)`.

### 3.3 Vị thế của tôi

- [ ] Tab Rewards có thêm bảng "Vị thế của tôi" từ `predictPositions(user)`: market đang mở, Yes / No, số share, giá trị theo giá hiện tại.
- [ ] Bên dưới là lịch sử XP đã nhận khi market chốt: event `Claimed` của ví, gồm market, số XP và tx.
- [ ] Indexer chết thì bảng này ẩn đi. Trang market vẫn đọc `positionOf` như hiện tại.

### 3.4 `$` (tùy chọn)

- [ ] Hiện giá USD khi indexer báo `USD_SOURCE` khác `none`. Devnet chưa có stablecoin thật, nên làm sau cùng.

## 4. Giai đoạn 4: chất lượng (TODO 4.1, 4.2)

### 4.1 Test tự động

- [ ] Unit test (vitest, `tests/`):
  - [ ] `lib/format.ts`: `parseUnits`, `formatUnits`, `formatAmount`, `toInputString`, `formatPercent`, `formatPrice`, `sqrt`, `applySlippage`, `timeAgo`.
  - [ ] `lib/trade.ts`, phần thuần: `routeLabel`, `wrapKind`. `candidatePaths` và `quote` gọi RPC, nên phải dựng stub `call()` mới test được.
  - [ ] `lib/predict.ts`: `quoteBuy`, `quoteSell`, `maxSellXp`, `priceYes`, `applyTrade`. Đối chiếu với các con số trong `e2e.js` của repo prediction-market.
  - [ ] `leaderboard()` ([src/hooks/predict.ts:213](../src/hooks/predict.ts#L213)): cách phá hòa, ví có XP ≤ 0, lọc theo season.
- [ ] Playwright smoke test (`npm run test:e2e`) với ví stub (provider giả trả chữ ký sẵn), dựa trên `quests-shot.mjs`. Chạy 3 luồng:
  - swap: quote hiện ra, nút đổi trạng thái theo số dư;
  - quests: check-in, rồi danh sách quest hiện ra;
  - faucet: nút có, và báo lỗi khi đang cooldown.
- [ ] CI `.github/workflows/ci.yml`: `npm ci`, `npm run typecheck`, `npm run build`, `npm test`.
  - Playwright tách thành một job riêng, chạy trên `vite preview`.
  - Lấy mẫu từ CI của indexer.

### 4.2 Kiểm giao diện và trạng thái lỗi

- [ ] Chạy `/frontend-check` trên mọi route, ở desktop và 375 px. Sửa hết lỗi tràn, đè hoặc cắt chữ.
- [ ] **RPC chết:** app đã có banner và chip "RPC offline". Nhưng trang Predict nuốt lỗi của `useSeason`, `useXp` và `usePosition` (`.catch(() => undefined)` ở `src/hooks/predict.ts`). Còn `PredictMarket` bỏ qua `logs.error`, nên chỉ hiện "Loading market…" mãi. Cần hiện lỗi thật cùng nút thử lại.
- [ ] **Indexer chết:** hiện giao diện không báo gì. Đề xuất:
  - thêm chip nhẹ "Đang dùng dữ liệu trực tiếp", hiện khi `predictIndexerBlock` trả `null`;
  - ẩn các cột chỉ indexer mới có (§3).
- [ ] **Faucet hết tiền:** hiện chỉ biết sau khi claim lỗi `faucet-empty`. Faucet đã có `GET /status` trả `balancePlanck`. Nên đọc endpoint này trước, rồi khóa nút với nhãn "Faucet đang hết QRL" khi số dư dưới một lượt claim.
- [ ] **Ví sai mạng:**
  - Nút trade và claim của Predict chưa kiểm `wrongNetwork`. Thêm vào giống `SwapWidget`.
  - Nhãn "Switch to QRL Devnet" đang viết cứng ở `SwapWidget.tsx`, `V2Deposit.tsx` và `V3Deposit.tsx`. Đổi sang `CHAIN.name` để chuẩn bị cho testnet (6.2).

## 5. Thứ tự

1. Prediction-market sửa hợp đồng và attester, rồi redeploy (OPS §9). Làm càng sớm càng tốt: mỗi ngày trễ là thêm một ngày người dùng thật có thể mất XP.
2. Giao diện chạy §1.1 (sync, deploy), rồi tới §1.2 (thử tay).
3. Indexer đọc lại từ đầu và lên VPS. Sau đó làm §3.0, §3.1 và §3.3.
4. Song song với bước 3: §4.1 và §4.2.
5. §3.2 biểu đồ: chờ indexer có query lịch sử giá. §3.4 làm sau cùng.

## 6. Cần bạn quyết

- [ ] **Quy tắc 2.1.** Không chặn giao diện, nhưng chặn snapshot. Đề xuất ở OPS §6, và indexer đang dùng sẵn làm mặc định:
  - ngày hoạt động = một ngày UTC có `QuestCompleted`, `Bought` hoặc `Sold`;
  - market đã giao dịch = có ít nhất một `Bought`;
  - đủ điều kiện khi có ≥ 7 ngày và ≥ 3 market;
  - hòa điểm thì ví đạt điểm sớm hơn xếp trên;
  - bảng công khai hiện `score`.
- [ ] Bảng xếp hạng: chỉ gắn nhãn ví chưa đủ điều kiện (đề xuất), hay ẩn hẳn?
- [ ] Giữ cột `winRate` (tính từ log) hay bỏ?

## 7. Cần từ repo khác

Mỗi mục được ghi thêm vào proposal của repo tương ứng.

| Repo | Việc | Ghi ở |
| --- | --- | --- |
| `pauli-swap-prediction-market` | `settle(id, users[])`, XP nhận nhiều market, test, redeploy Predict, `startSeason` cùng `endsAt`, tạo lại market | `docs/PROPOSAL-SEASON-1-OPS.md` §9 |
| `pauli-swap-prediction-market` | Attester tự gọi `settle` khi market chốt; lệnh `market:settle` làm phương án dự phòng | như trên |
| `pauli-swap-prediction-market` | `SEASON-END.md`: bỏ cửa sổ claim 48 giờ, thay bằng bước kiểm mọi market đã chốt và đã trả hết | như trên |
| `pauli-swap-prediction-market` | Ghi quyết định 2.1 vào §6; CI chạy compile, `test:attester`, `test:faucet` | như trên |
| `pauli-swap-indexer` | Đọc lại Predict từ đầu sau redeploy; xử lý event mới của XP (nhiều market) nếu có | `docs/PROPOSAL-SEASON-1.md` §7 |
| `pauli-swap-indexer` | Query `predictPriceHistory(market, from, first)` cho biểu đồ (§3.2), và deploy API lên VPS | như trên |
| `pauli-swap` | CI chạy `npm test` (compile + hardhat) và `check:qrvm`. Runner cần có compiler `hypc` | `docs/PROPOSAL-AUDIT-PHASE-5.md` §5 |
| Hạ tầng `Servers/OracleCloud/PauliSwap` | Đẩy lại attester với địa chỉ mới; ngưỡng gas attester 50 QRL (đã có ở §3) nên đo lại khi attester gọi thêm `settle` | thông qua OPS §9 |
