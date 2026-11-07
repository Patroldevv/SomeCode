# SomeCode — Tasarım Spec'i (v0.1)

Tarih: 2026-11-07 · Durum: İnceleme bekliyor

## 1. Amaç ve kapsam

SomeCode, Linux'ta çalışan, Electron kullanmayan bir AI kodlama ajanı masaüstü uygulamasıdır. Claude Code, Codex, OpenCode, OpenHands ve T3 Code gibi uygulamalara benzer. Ajanlarla **ACP (Agent Client Protocol)** üzerinden konuşur ve kullanıcılar ajanları kendi hesaplarıyla kullanır. Modeller ve modlar T3 Code'daki gibi ajandan dinamik çekilir.

**Başarı ölçütü:** Kullanıcı bir projeyi açar, Claude, OpenCode veya Antigravity ile oturum başlatır; thinking adımlarını, araç çağrılarını ve diff'leri canlı görür; izinleri onaylar; terminal ve dosya ağacını kullanır. Hepsi Claude Code kalitesinde bir arayüzde.

### v0.1 kapsamı

- Ajanlar: **Claude, OpenCode, Antigravity** (bu makinede üçü de kurulu).
- Çekirdek: çoklu proje ve oturum, akışlı sohbet, thinking blokları, araç çağrıları, plan, izin kartları, model/mod/çaba seçici.
- Ek özellikler: diff görünümü, entegre terminal, dosya ağacı ve `@dosya` ekleme.

### v0.1 dışında (v0.2+)

Git entegrasyonu ve worktree'ler, Gemini ve Codex sürücüleri, MCP sunucu yönetim arayüzü, çok kullanıcılı veya uzak erişim.

### Kısıtlar ve varsayımlar

- Electron kullanılmaz. Arayüz yerel sunucu + web UI mimarisidir.
- Kimlik doğrulama ajanın kendi CLI girişiyle yapılır. SomeCode token veya API anahtarı saklamaz.
- Hedef sistem: CachyOS/Arch, Wayland, Node 26, Python 3.14. Rust ve webkit2gtk kurulu değil ve gerekmez.
- Ajan komutları: `opencode acp`, `agy acp`, Claude için `@agentclientprotocol/claude-agent-acp` adaptörü (Claude Code'un kendi ACP modu yok).

## 2. Mimari

TypeScript monorepo (npm workspaces).

```
SomeCode/
├─ packages/protocol   UI↔sunucu mesaj tipleri (zod) + normalize olay modeli
├─ apps/server         Hono + WebSocket, yalnızca 127.0.0.1
│   ├─ agents/         claude · opencode · agy sürücüleri (komut, env, giriş durumu)
│   ├─ acp/            AcpSession: ajan alt süreci + ACP bağlantısı + olay normalizasyonu
│   ├─ permissions/    PermissionBroker
│   ├─ fs/             dosya ağacı, okuma, @mention araması
│   ├─ terminal/       node-pty (ACP terminal/* + kullanıcı terminali)
│   └─ store/          node:sqlite: projeler, oturumlar, olay günlüğü
├─ apps/web            React 19 + Vite + Tailwind 4, xterm.js
└─ bin/somecode        sunucuyu başlatır, Chromium --app penceresi açar
```

### Bileşen sorumlulukları

| Birim | Ne yapar | Bağımlılığı |
|---|---|---|
| `protocol` | WebSocket komut ve olay şemalarını tanımlar. Sunucu ve UI aynı tipleri kullanır. | zod |
| `agents/*` | Her ajan için başlatma komutu, ortam değişkenleri ve kurulu/giriş durumu kontrolü. Ortak `AgentDriver` arayüzünü uygular. | — |
| `acp/AcpSession` | Ajan alt sürecini başlatır, `@agentclientprotocol/sdk` ile ACP bağlantısını yönetir, `session/update` olaylarını normalize eder. | `agents`, SDK |
| `permissions` | ACP izin isteklerini UI'a taşır, kararı ajana geri iletir. | `acp` |
| `fs` | Proje köküyle sınırlı dosya ağacı, okuma ve `@` arama. | — |
| `terminal` | Kullanıcı terminali ve ajanın `terminal/*` isteklerini pty ile çalıştırır. | node-pty |
| `store` | Projeleri, oturumları ve sıralı olay günlüğünü SQLite'a yazar. | `node:sqlite` |
| `web` | Sohbet, paneller, composer, tema, i18n. | `protocol` |

### Veri akışı

1. UI, WebSocket ile `prompt`, `cancel`, `set_model`, `set_mode` ve `permission_response` komutlarını gönderir.
2. Sunucu bunları ACP isteklerine çevirir.
3. Ajandan gelen `session/update` olayları (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, diff içeriği) normalize edilir.
4. Her olay sıra numarasıyla SQLite olay günlüğüne yazılır ve bağlı UI'lara yayınlanır.
5. UI yeniden bağlanırsa son görülen sıra numarasından replay alır.

**Sunucunun ömrü pencereden bağımsızdır:** Pencere kapansa da ajan çalışmaya devam eder.

### Kimlik

Sunucu ACP `initialize` yanıtındaki `authMethods` ile giriş durumunu okur. Giriş gerekiyorsa ilgili CLI'ın giriş akışını terminal sekmesinde başlatır. OpenCode için bu `opencode acp --login`'dir; `agy` ve Claude için komut, aşama 4'te ajanın bildirdiği `authMethods`'a göre belirlenir. Modeller ve modlar oturum yeteneklerinden dinamik okunur.

### Güvenlik

- Sunucu yalnızca loopback'te dinler.
- Her başlatmada rastgele oturum token'ı üretilir. WebSocket ve HTTP isteklerinde token ve Origin kontrolü yapılır.
- Dosya servisi proje köküyle sınırlıdır; `..` ve sembolik bağlantı kaçışları reddedilir.
- Ajanın araç izinleri `PermissionBroker` üzerinden geçer; varsayılan davranış kullanıcıya sormaktır.

## 3. Kullanıcı arayüzü

### Yerleşim

Üç sütun, kenarlardan sürüklenerek boyutlanır:

- **Sol:** Projeler ve oturumlar, oturum durum noktası (çalışıyor, izin bekliyor, bitti, koptu). Altta ajan listesi ve giriş durumu.
- **Orta:** Sohbet akışı ve composer.
- **Sağ:** Sekmeli panel: *Değişiklik*, *Dosyalar*, *Terminal*. `Ctrl+B` ve `Ctrl+J` ile açılıp kapanır.

### Sohbet akışı

- **Thinking:** `agent_thought_chunk` akarken canlı açık görünür. Bittiğinde süre etiketiyle tek satıra katlanır, tıklayınca açılır.
- **Araç çağrıları:** Kompakt satırlar. Çalışırken spinner, bitince onay işareti, hata olursa kırmızı. Tıklayınca girdi ve çıktı açılır.
- **Diff'ler:** Edit satırı `+n -m` özetiyle gelir. Genişletince satır içi veya yan yana diff görünür. *Değişiklik* sekmesi oturumun tüm dosya değişikliklerini toplar.
- **Plan:** ACP `plan` olayı, mesajların üstünde yapışkan bir kontrol listesi olarak gösterilir.
- **İzin kartı:** Akış içinde, seçenekler *Bir kez izin ver*, *Her zaman*, *Reddet*. Bekleyen izin sol listede turuncu noktayla da görünür.

### Composer

- `@` ile dosya/klasör arama, görsel yapıştırma, `/` ile ajanın slash komutları.
- Ajan, model, mod ve çaba çipleri. Seçenekler ACP'den dinamik gelir; ajanın desteklemediği çip hiç gösterilmez.

### Görsel dil ve teknik notlar

- Koyu tema varsayılan, açık tema da var. Renkler CSS değişkenleriyle tanımlanır. Vurgu rengi tek, süs gölge ve gradyan yok.
- Yanıt metni serif, arayüz sans-serif. Ajan renkleri küçük noktalarla gösterilir.
- Arayüz dili Türkçe ve İngilizce; metinler baştan i18n dosyalarında.
- Sohbet listesi sanallaştırılır. Markdown akışı parça parça render edilir. Kod blokları Shiki ile renklendirilir.

## 4. Hata yönetimi

| Durum | Davranış |
|---|---|
| Ajan süreci çöker veya kapanır | Oturum "bağlantı koptu" olur, geçmiş korunur. *Yeniden bağlan* düğmesi `session/load` (destekliyorsa) ile sürdürür. |
| Ajan kurulu değil | Sol listede soluk görünür; kurulum komutu ve belge bağlantısı gösterilir. |
| Giriş gerekli | *Giriş yap* düğmesi ajanın giriş akışını terminal sekmesinde başlatır. |
| İzin cevapsız | Ajan bekler, zaman aşımı yok. Oturum noktası turuncu yanar. |
| Bilinmeyen ACP olayı | Atılmaz. Günlüğe yazılır, akışta soluk "desteklenmeyen olay" satırı olarak gösterilir. |
| WebSocket kopar | UI otomatik yeniden bağlanır ve son sıra numarasından replay yapar. |
| Hata metni | Ham istisna gösterilmez. Ne olduğu ve ne yapılacağı tek cümleyle yazılır; ayrıntı "günlüğü aç" ile görünür. |

## 5. Test stratejisi

- **Birim (Vitest):** Olay normalizasyonu, `PermissionBroker`, `store`, protokol şemaları.
- **Sahte ACP ajanı:** Betikli stdio ajanı (thinking, araç çağrısı, diff, izin isteği, çökme). Sunucu entegrasyon testleri gerçek ajan veya ağ olmadan çalışır.
- **Gerçek ajan duman testleri:** `claude`, `opencode`, `agy` ile elle çalıştırılan tek turluk testler. Giriş ve kota gerektirdiği için CI dışında.
- **UI:** Bileşenler için Vitest + Testing Library. Ana akış (mesaj, thinking, izin, diff) için sahte ajanla Playwright uçtan uca testi.

## 6. v0.1 yol haritası

Her aşama kendi içinde çalışır durumda teslim edilir.

1. **İskelet:** Monorepo, `protocol`, sunucu, web uygulaması, `somecode` başlatıcısı, SQLite.
2. **ACP çekirdeği:** `AcpSession` ve OpenCode sürücüsü; sahte ajan testleriyle tek turluk mesajlaşma uçtan uca.
3. **Sohbet UI'ı:** Akışlı mesajlar, thinking, araç çağrıları, plan, izin kartları.
4. **Claude ve Antigravity sürücüleri:** Giriş durumu, dinamik model ve mod seçici.
5. **Diff görünümü, dosya ağacı, `@` ekleme.**
6. **Entegre terminal:** xterm.js + pty, ajanın terminal çıktılarını gösterme.
7. **Cila:** Açık/koyu tema, TR/EN, kısayollar, paketleme (`.desktop` dosyası, Arch için PKGBUILD).

## 7. Açık riskler

- **Ajan başına ACP uyumu değişebilir:** Her ajan ACP yeteneklerinin farklı alt kümesini uygular (ör. `session/load`, `terminal/*`, model listesi). Sürücüler yetenek müzakeresine göre özellik gizler; gerçek davranış aşama 2 ve 4'te canlı doğrulanır.
- **`agy acp` ve Claude adaptörünün belgeleri sınırlı:** Davranışları ilk entegrasyonda deneyle doğrulanacak; bulgular bu spec'e işlenir.
- **node-pty yerel derleme gerektirir:** Derleme araçları (gcc, python) kurulu; başarısız olursa yedek olarak `script`/pty köprüsü değerlendirilir.
- **Chromium `--app` penceresi:** Sistemde uygun bir Chromium tabanlı tarayıcı yoksa varsayılan tarayıcıya düşülür. Sonradan Tauri ile paketleme mümkündür.
