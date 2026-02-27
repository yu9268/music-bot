# YAY DJ System (Phase 1)

Yay通話中にチャットコマンドでYouTube音楽を再生するローカルDJシステム。

## 🎵 構成

YouTube
↓
yt-dlp
↓
VLC
↓
VoiceMeeter
↓
A1 → ヘッドホン
B2 → Yay通話

---

## 🚀 セットアップ

### 1. 必要ソフト
- Node.js 18+
- yt-dlp
- VLC (HTTP interface 有効化)
- VoiceMeeter Banana

### 2. VLC設定
- HTTPインターフェースON
- パスワード設定
- ネットワークキャッシュ 3000〜5000ms

### 3. VoiceMeeter設定
- A1 = ヘッドホン
- VLC出力 = Voicemeeter Input
- B2 = Yayマイク

### 4. bot起動
node bot.js

### 5. 拡張機能ロード
chrome://extensions → unpacked load

---

## 🎮 コマンド

!p,曲名
!stop
!skip
!pause
!resume
!clear
!state

---

## 🔧 トラブルシュート

### 音が聞こえない
- VLC出力がVoicemeeter Inputか確認
- Virtual InputでA1点灯確認

### プツプツする
- VoiceMeeterバッファ 1024
- VLCネットワークキャッシュ 3000ms
- 48kHz統一

---