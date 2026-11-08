# Ajanlar

SomeCode ajanlarla **ACP (Agent Client Protocol)** üzerinden stdio ile konuşur ve token saklamaz: giriş her ajanın kendi CLI'ındadır.

| Ajan | Kimlik | Başlatma | Giriş durumu | Giriş komutu |
|---|---|---|---|---|
| Claude | `claude` | `node <apps/server bağımlılığı>/@agentclientprotocol/claude-agent-acp/dist/index.js` | `claude auth status --json` (`loggedIn`) | `claude auth login` |
| OpenCode | `opencode` | `opencode acp` | bilinmiyor (ücretsiz modeller girişsiz çalışır) | `opencode acp --login` |
| Antigravity | `agy` | `agy acp` | bilinmiyor (durum komutu yok); eksik giriş oturum başlarken `auth_required` olur | doğrulanmış bir komut yok; `agy`'yi terminalde bir kez açıp giriş yapın |

Hiçbir ajan izin atlama bayrağıyla (`--dangerously-skip-permissions` vb.) başlatılmaz: onaylar kullanıcıya ulaşır.

## Keşif bulguları (2026-11-08, prompt gönderilmeden)

- **Antigravity 1.5.3** (`agy acp`): `loadSession: true`; 4 giriş yöntemi duyurur (`oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform`); `session/new` → modlar `default`, `accept-edits`, `plan`; seçenekler `model` (kategori `model`), `thought_level` (kategori `thought_level`), `mode` (kategori `mode`).
- **Claude adaptörü 0.101.0**: `authMethods` boş; `loadSession`, `resume`, `fork`, `list`, `close`, `delete` yetenekleri; `session/new` ≈ 1 sn; seçenekler `mode` (5 mod), `model`, `effort` (kategori `thought_level`) ve kategorisiz `agent`.
- **OpenCode**: `session/new` yalnız `model` seçeneğini bildirdi.
- Seçenekler `config_options` olayı olarak günlüğe yazılır ve web arayüzünde composer çipleri olur; modları yalnız `modes` olarak bildiren ajanlar için sunucu bir `mode` seçeneği türetir.

## El sıkışma kontrolü (kota harcamaz)

```bash
npm run handshake -- claude
npm run handshake -- opencode
npm run handshake -- agy
```

Ajanı başlatır, `initialize` + `session/new` yapar, duyurduklarını yazar ve kapatır. **Hiç prompt göndermez.** Çıkış kodu: 0 başarı, 1 hata, 2 giriş gerekli veya kullanım hatası.

Gerçek bir tur (model kotasını harcar) ayrıca ve bilinçli çalıştırılmalıdır: çalışan bir sunucuya `scripts/smoke.ts` ile (bkz. `docs/smoke-tests.md`).

## Sonuçlar
