# SIGNAL/US — 米国株 売買シグナル

テクニカル × ファンダメンタルで、保有株・検討株の **買い時 / 売り時** をルールベースで示唆するスマホ向け PWA。

## 特徴
- **リアルタイム株価**: Finnhub WebSocket（約定）＋ REST ポーリングで二重化
- **日足チャート**: Twelve Data の OHLCV。MA20/50/200・ボリンジャー・RSI・MACD、売買ラインを表示
- **スコアリング**: テクニカル 8 要因 + ファンダ 6 要因 → 総合 0–100 → 5 段階シグナル。根拠を全開示
- **アクションプラン**
  - 検討株: 押し目ゾーン / 損切り (2×ATR or 20日安値) / 目標 (2R) / リスク許容から推奨株数
  - 保有株: 損切り・売却・一部利確・利確・買い増し・保有継続 (シャンデリア・トレーリングストップ)
- **データ品質ゲート**（厳格運用）: 以下のどれかに該当すると判定を **保留** にし、売買を示唆しない
  - 取引時間中に株価が 15 分以上未更新
  - 日足が 2 営業日以上古い / OHLC 異常値
  - 2 ソース間で前日終値が 1% 超乖離（分割・調整漏れ検知）
  - 日足 200 本未満
- 決算 7 日前からは強シグナルを 1 段階抑制
- NYSE 取引時間・休場日・短縮取引に対応

## セットアップ
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 指標・判定ロジックのテスト
npm run build    # dist/ を静的ホスティング
```
1. [Finnhub](https://finnhub.io/register) と [Twelve Data](https://twelvedata.com/pricing) で無料 API キーを取得
2. アプリの「設定」でキーを入力 →「保存して接続テスト」→ 成功で実データモードに切替
3. スマホのブラウザで開き「ホーム画面に追加」

`main` への push で GitHub Pages に自動デプロイ（リポジトリ設定 → Pages → Source: GitHub Actions）。

## 構成
```
src/lib/indicators.ts   SMA/EMA/RSI/MACD/BB/ATR/ADX (純関数)
src/lib/analysis.ts     スコアリング・判定・エントリー/保有プラン
src/lib/integrity.ts    データ品質ゲート
src/lib/market.ts       NYSE カレンダー
src/lib/providers/      Finnhub / Twelve Data / デモ
src/state/              設定・保有・ウォッチ (localStorage), データハブ
src/pages/              ホーム / 保有 / ウォッチ / 銘柄詳細 / 設定
```

## 注意
本アプリの示唆は機械的なルール判定であり投資助言ではありません。無料 API の制限（Finnhub 60回/分、Twelve Data 8回/分・800回/日）により、目安として監視銘柄は 30 程度までを推奨します。
