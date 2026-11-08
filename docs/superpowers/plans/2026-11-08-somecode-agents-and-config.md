# SomeCode Agents and Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec'in 4. aşamasını teslim etmek: Claude ve Antigravity sürücüleri, giriş durumu ve yönlendirme, ajanın bildirdiği model/mod/çaba seçeneklerini composer çipleriyle değiştirme.

**Architecture:** Sürücüler mevcut `AgentDriver` arayüzünü genişletir (kurulum + giriş durumu + giriş ipucu). Sunucu ACP `configOptions`/`modes` verisini tipli bir `config_options` olayına normalize eder; web reducer son listeyi tutar ve composer altındaki çipler `set_config` gönderir (görünen değer her zaman sunucunun onayladığı değerdir). Gerçek ajanlarla el sıkışma doğrulaması prompt göndermeden (kota harcamadan) yapılır.

**Tech Stack:** Mevcut yığın (Node 26 type stripping, `@agentclientprotocol/sdk` stable v1, React 19, Vitest). Eklenecek: `@agentclientprotocol/claude-agent-acp` 0.101.x (apps/server bağımlılığı).

**Spec:** `docs/superpowers/specs/2026-11-07-somecode-design.md` (§2 kimlik ve ajan bağlantıları, §3 composer çipleri ve kenar çubuğu, §4 hata yönetimi, §6 aşama 4). Önceki planlar: `2026-11-07-somecode-foundation-acp-core.md`, `2026-11-07-somecode-chat-ui.md` (ikisi de tamamlandı).

## Keşif bulguları (2026-11-08, bu makinede, prompt gönderilmeden)

- `agy acp` (v1.5.3): `initialize` → `agentCapabilities.loadSession: true`, `authMethods` 4 giriş yöntemi (`oauth-personal`, `oauth-business`, `gemini-api-key`, `agent-platform`); `session/new` başarılı (giriş açıkmış) → `modes` (`default`, `accept-edits`, `plan`) ve `configOptions`: `model` (category `model`; `gemini-4-argon`, `gemini-3.8-flash`, `claude-opus-5-5`, `claude-sonnet-5-5`, `gpt-oss-120b-medium`), `thought_level` (category `thought_level`; low/medium/high), `mode` (category `mode`).
- `@agentclientprotocol/claude-agent-acp` 0.101.0 (adaptör, `dist/index.js`, bin `claude-agent-acp`): `initialize` → `authMethods: []`; `loadSession`, `close`, `delete`, `fork`, `list`, `resume` yetenekleri; `session/new` ~1 sn → `modes` (`default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`) ve `configOptions`: `mode`, `model` (category `model`; `default`, `opus`, `sonnet`, `fable`, `haiku`, tam model kimlikleri…), `effort` (category `thought_level`; default/low/medium/high/xhigh/max), `agent` (kategorisiz; ajan listesi). Giriş durumu için `claude auth status --json` var (`loggedIn`, `authMethod`, `email`, `subscriptionType`, …); `claude auth login` giriş komutu.
- OpenCode `opencode acp`: yalnız `model` seçeneği gözlendi; `opencode acp --login` giriş komutu; `opencode auth list` boş.
- Gerçek bir tur henüz hiçbir ajanla tamamlanmadı (OpenCode ücretsiz modeli aşırı yüklüydü).

## Global Constraints

- Spec §2: "Sunucu token veya API anahtarı saklamaz. ACP `initialize` yanıtındaki `authMethods` ile giriş durumunu okur. Modeller ve modlar oturum yeteneklerinden dinamik okunur." Ajan komutları: `opencode acp`, `agy acp`, Claude için `@agentclientprotocol/claude-agent-acp` adaptörü. SomeCode hiçbir ajanı `--dangerously-skip-permissions` veya benzeri izin atlama bayrağıyla başlatmaz.
- Spec §3: "Ajan, model, mod ve çaba çipleri. Seçenekler ACP'den dinamik gelir; ajanın desteklemediği çip hiç gösterilmez." Kenar çubuğunun altında ajan listesi ve giriş durumu.
- Spec §4: "Ajan kurulu değil: soluk görünür; kurulum komutu ve belge bağlantısı gösterilir." "Giriş gerekli: giriş akışını başlatan düğme." Bu planda giriş akışı terminal sekmesi (aşama 6) olmadığı için **gösterilen komuttur** (kopyalanabilir ipucu); terminalde otomatik başlatma aşama 6'ya kalır.
- Hata metinleri tek cümle (ne oldu + ne yapılmalı), ham sunucu/ajan metni kullanıcıya gösterilmez; tüm kullanıcı metinleri `apps/web/src/i18n/{tr,en}.ts` içinde (parity testi). Ajanın verdiği seçenek adları ve açıklamaları veridir (çevrilmez).
- Güvenlik: ajan çıktısı güvenilmezdir; seçenek adları/açıklamaları metin olarak render edilir. Sürücü komutları sabittir, kullanıcı girdisinden türetilmez. Adaptör yolu `apps/server` bağımlılığından çözülür (PATH'ten değil).
- Server kodu Node type stripping ile çalışır (`.ts` uzantılı göreli import, `enum` ve parametre özelliği yok); web kodu Vite ile derlenir. `npm test`, `npm run typecheck`, `npm -w apps/web run build` her görev sonunda temiz ve test çıktısı sessiz olmalı. Ana web parçası < 300 kB gzip.
- Commit'ler yerel `main`'de (onaylı), push yok; her commit mesajı `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` ile biter.
- Paralel iş: ayrı bir UI-cila oturumu (başlatılırsa) kendi worktree'sinde görsel katmanı değiştirecek; `Composer.tsx`, `Sidebar.tsx` ve `ErrorCard` bu planın dokunduğu yerlerdir — dışa açık prop'lar kararlı ve diff'ler küçük tutulur.

## Review Focus

1. Ajan veya adaptör kurulu değil/çözülemiyor, sürüm komutu takılıyor: `installed:false`, durum sorgusu tek sürücüdeki hatayla tamamen başarısız olmaz, her tespit sınırlı sürede biter. → Task 3.
2. Alışılmadık seçenek şekilleri: gruplu seçenekler, boolean seçenek, `currentValue` listede yok, boş liste, yinelenen kimlik, yüzlerce model: çipler çökmez, kullanılabilir kalır, bilinmeyen şekil atılmaz ama görünmez de bozmaz. → Task 1, 5.
3. Model/mod değişimi tur sürerken veya ajan koptuğunda: temiz hata, görünen değer sunucunun onayından sapmaz. → Task 2, 5.
4. Ajan geçersiz değeri reddeder veya `session/set_config_option` hata döner: banner, çip önceki değerde kalır. → Task 2, 5.
5. Ajan `initialize` veya `session/new` yanıtını hiç vermez: `createSession` asılı kalmaz (başlatma zaman aşımı). → Task 2.

**Bu planın dışında:** terminalde giriş akışını başlatma ve ACP `authenticate` çağrısı (aşama 6), boolean seçenek anahtarları, Gemini/Codex sürücüleri (v0.2), `session/load` ile oturum sürdürme, ajan başına oturum filtreleme.

---

### Task 1: Tipli yapılandırma seçenekleri (protocol + normalleştirici + reducer)

**Files:**
- Modify: `packages/protocol/src/events.ts`, `apps/server/src/acp/normalize.ts`, `apps/web/src/lib/sessionState.ts`
- Test: `packages/protocol/src/protocol.test.ts`, `apps/server/src/acp/normalize.test.ts`, `apps/web/src/lib/sessionState.test.ts`
- Create: `apps/server/test-fixtures/config-options.ts` (aşağıdaki gerçek şekiller)

**Interfaces:**
- Produces (`@somecode/protocol`): `ConfigChoice = {value:string; name:string; description?:string}`; `ConfigOption = {id:string; name:string; category?:string; description?:string; currentValue:string; choices:ConfigChoice[]}`; olay `config_options{options: ConfigOption[]}` (şimdiki `options: unknown` yerine; eski saklanmış olaylar şemayı geçemezse `unsupported`'a düşmemeli — replay güvenliği için `config_options` şemasında `options` `ConfigOption[]` değilse reducer yok sayar, parse hatası fırlatmaz).
- Produces (server): `normalizeConfigOptions(options: SessionConfigOption[]): {type:'config_options'; options: ConfigOption[]}` — yalnız `type:'select'` seçenekler; gruplu seçenekler düzleştirilir; `boolean` seçenekler atlanır; `currentValue` string'e çevrilir; boş `choices`'lı seçenek atlanır; yinelenen `id`'de ilki kalır. `config_option_update` (SDK'da `configOptions` tam liste taşır — tipi kontrol et) `config_options` olayına normalize edilir (şu an `unsupported`).
- Produces (web): `SessionState.configOptions: ConfigOption[] | null` (son `config_options` olayı tüm listeyi değiştirir).

- [ ] **Step 1: Write the failing tests:** normalleştirici, Claude şekliyle (`mode`, `model`, `effort` category `thought_level`, kategorisiz `agent`) ve agy şekliyle (`model`, `thought_level`, `mode`) fixture'larını sınar: `kimlik/ad/kategori/currentValue/choices` doğru; gruplu seçenek düzleşir; boolean atlanır; `currentValue` listede olmasa da seçenek tutulur (UI karar verir); yinelenen kimlik; boş seçenek atlanır; `config_option_update` bir `config_options` olayı üretir. Reducer: `config_options` listeyi değiştirir (`plan` gibi), `lastSeq` ilerler, eski/şemaya uymayan `options` durumu bozmaz. Protocol: şema geçerli/geçersiz örnekler.
- [ ] **Step 2: Run** `npx vitest run packages/protocol apps/server/src/acp/normalize apps/web/src/lib/sessionState` — Expected: FAIL.
- [ ] **Step 3: Implement** yukarıdaki arayüzleri; fixture dosyası keşif bulgularındaki gerçek `session/new` yanıtlarının (adlar kısaltılabilir) birebir şeklini taşır.
- [ ] **Step 4: Run** the same command and `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat: typed config options event end to end`.

### Task 2: AcpSession — modlar, set_config hataları, başlatma zaman aşımı

**Files:**
- Modify: `apps/server/src/acp/session.ts`, `apps/server/src/sessions/manager.ts`, `apps/server/test-support/fake-agent.ts`
- Test: `apps/server/src/acp/session.test.ts`, `apps/server/src/sessions/manager.test.ts`, `apps/server/src/http/server.test.ts`

**Interfaces:**
- Consumes: Task 1 `normalizeConfigOptions`.
- Produces: `AcpSession.setConfig(configId, value)` mevcut imzayla; davranış: `configId==='mode'` ve seçenek yalnızca `modes`'tan türetilmişse `session/set_mode`, aksi halde `session/set_config_option`; tur sürerken `turn_in_progress`, bağlantı yokken `disconnected` (`SomeCodeError`), ajan hatası `bad_request` (geçersiz değer) veya `internal`; başarıda yeni liste `config_options` olarak yayınlanır. `session/new` yanıtında `configOptions` yoksa ama `modes` varsa `{id:'mode', name:'Mode', category:'mode', currentValue:modes.currentModeId, choices: availableModes→{value:id,name,description}}` seçeneği sentezlenir ve `current_mode_update` olayı bu seçeneğin `currentValue`'sunu günceller (yeni `config_options` olayı). Başlatma zaman aşımı: `initialize` + `session/new` toplamı `START_TIMEOUT_MS = 30_000` (ortam değişkeni `SOMECODE_AGENT_START_TIMEOUT_MS` ile geçersiz kılınabilir; testler kısa değer verir) aşılırsa süreç öldürülür ve `SomeCodeError('disconnected','agent did not start in time')`.
- Fake agent: yeni senaryolar `modes_only` (yalnız `modes` döner, `session/set_mode` kabul eder ve `current_mode_update` gönderir), `config_reject` (`set_config_option` JSON-RPC `invalidParams` döner), `slow_start` mevcut (zaman aşımı testinde kullanılır).

- [ ] **Step 1: Write the failing tests:** (a) `modes_only` → ilk olaylarda sentezlenmiş `mode` seçeneği; `setConfig('mode','plan')` `session/set_mode` çağırır ve yeni `config_options` olayı gelir; (b) `config_reject` → `setConfig` `bad_request` ile reddedilir ve hiçbir `config_options` olayı yayınlanmaz; (c) tur sürerken (`slow`) `setConfig` `turn_in_progress`; kopmuş oturumda `disconnected`; (d) `slow_start` + kısa zaman aşımı → `createSession` zaman aşımında `disconnected` ile reddedilir, ajan süreci kalmaz (`pgrep -f '[f]ake-agent'` boş), `status:disconnected` günlüğe düşer; (e) manager/WS düzeyinde `set_config` hataları `error{code}` olarak döner ve bağlantı açık kalır.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/acp/session apps/server/src/sessions apps/server/src/http` — Expected: FAIL.
- [ ] **Step 3: Implement** yukarıdaki davranışlar; zaman aşımını `AbortController` ile mevcut kapatma yoluna bağla (yeni süreç yönetimi yolu açma).
- [ ] **Step 4: Run** the same command and `npm test` — Expected: PASS, orphan süreç yok.
- [ ] **Step 5: Commit** — `feat(server): session modes, set_config errors and agent start timeout`.

### Task 3: Claude ve Antigravity sürücüleri, giriş durumu, dayanıklı ajan listesi

**Files:**
- Create: `apps/server/src/agents/claude.ts`, `apps/server/src/agents/antigravity.ts`, `apps/server/src/agents/exec.ts` (ortak sınırlı `execFile` yardımcısı; `opencode.ts`'in `runVersion`'u buraya taşınır)
- Modify: `apps/server/src/agents/types.ts`, `apps/server/src/agents/opencode.ts`, `apps/server/src/agents/registry.ts`, `apps/server/src/http/app.ts`, `apps/server/package.json`
- Test: `apps/server/src/agents/{claude,antigravity,registry}.test.ts`, `apps/server/src/http/server.test.ts`

**Interfaces:**
- Produces: `AgentStatus` genişler: `{installed:boolean; version?:string; auth?:'signed_in'|'signed_out'|'unknown'; signInHint?:string; installHint?:string}` (`signInHint`/`installHint` komut metinleridir, çevrilmez; her ikisi de sabit). `createClaudeDriver(env?)`: `id:'claude'`, `label:'Claude'`, `launch()` → `{command: process.execPath, args:[<claude-agent-acp dist/index.js yolu>]}` (yol `createRequire(import.meta.url).resolve('@agentclientprotocol/claude-agent-acp/package.json')`'dan çözülür; çözülemezse `detect()` `installed:false` döner ve `launch()` `SomeCodeError('agent_not_installed')` fırlatır); `detect()`: `claude --version` (kurulu mu + sürüm) ve `claude auth status --json` (`loggedIn` true → `signed_in`, false → `signed_out`, hata/ayrıştırma → `unknown`); `signInHint:'claude auth login'`. `createAntigravityDriver(env?)`: `id:'agy'`, `label:'Antigravity'`, `launch()` → `{command:'agy', args:['acp']}`, `detect()`: `agy --version`; `auth:'unknown'` (durum komutu yok; giriş hatası oturum başlarken `auth_required` olur); `signInHint`: önce `agy --help` ve `agy acp --help` çıktısından gerçek giriş komutunu doğrula, yoksa ipucu verme (`undefined`). OpenCode: `signInHint:'opencode acp --login'`, `auth:'unknown'`. `defaultRegistry()` sırası: Claude, OpenCode, Antigravity. `registry.statuses()` her sürücü için `detect()` hatasını yakalar → `{installed:false}`; her tespit 5 sn ile sınırlı. `GET /api/agents` yeni alanları döner.
- Sürücü testlerinde ajan kimlik bilgileri gerçek sistemden okunmaz: sahte PATH betikleri (`claude`, `agy`) kullanılır.

- [ ] **Step 1: Write the failing tests:** sahte `claude` betiği (`--version` → `2.1.319 (Claude Code)`; `auth status --json` → `{"loggedIn":true,...}`) → `{installed:true, version:'2.1.319 (Claude Code)', auth:'signed_in'}`; `loggedIn:false` → `signed_out`; bozuk JSON/zaman aşımı/sıfır olmayan çıkış → `unknown` (kurulu kalır); `claude` yoksa `installed:false` + `installHint`; adaptör yolu çözülüyor (`launch().args[0]` var olan bir dosya); `agy` sürümü okunur, `auth:'unknown'`; PATH boşken ikisi de `installed:false`; bir sürücünün `detect()`'i reddeder → `statuses()` yine tüm sürücüleri döner (reddeden `installed:false`); `GET /api/agents` yeni alanları içerir ve kimlik bilgisi/e-posta içermez (`claude auth status` çıktısındaki e-posta, kuruluş adı gibi alanlar sızdırılmaz — yalnız `loggedIn`'den türetilen durum).
- [ ] **Step 2: Run** `npx vitest run apps/server/src/agents apps/server/src/http` — Expected: FAIL.
- [ ] **Step 3: Implement.** Bağımlılığı kur: `npm install @agentclientprotocol/claude-agent-acp -w apps/server` (0.101.x). Ortak `exec.ts`: `runBounded(command, args, env, timeoutMs): Promise<{ok:boolean; stdout:string}>`.
- [ ] **Step 4: Run** the same command and `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server): claude and antigravity drivers with sign-in status`.

### Task 4: El sıkışma doğrulama betiği ve ajan belgesi

**Files:**
- Create: `apps/server/src/launcher/handshake.ts`, `scripts/handshake.ts`, `docs/agents.md`
- Modify: `package.json` (`"handshake": "node scripts/handshake.ts"`)
- Test: `apps/server/src/launcher/handshake.test.ts`

**Interfaces:**
- Produces: `runHandshake(driver: AgentDriver, cwd: string, timeoutMs?: number): Promise<{ok:boolean; agentInfo?:unknown; authMethods?:Array<{id:string;name:string}>; loadSession?:boolean; options?:ConfigOption[]; modes?:string[]; error?:{code:string;message:string}}>` — yalnızca `AcpSession.start` ile oturum açar, **hiç prompt göndermez**, bitince oturumu kapatır. `scripts/handshake.ts <agentId> [dir]`: kayıt defterinden ajanı bulur, özeti okunur çıktı olarak yazar, başarıda 0, hatada 1 (`auth_required` ayrı mesajla).
- `docs/agents.md`: her ajanın nasıl bağlandığı (komut/adaptör), giriş yolu, keşif bulguları, bilinen kısıtlar, el sıkışmanın nasıl çalıştırılacağı ve **gerçek tur (kota harcar) ayrı ve açık onayla** çalıştırılır uyarısı; sonuçlar bölümü boş başlık (denetleyici doldurur).

- [ ] **Step 1: Write the failing tests:** sahte ajanla (`fakeDriver('basic')`) `runHandshake` seçenekleri ve `ok:true` döner, `prompt` çağrısı yapılmaz (fake agent'ın prompt sayacı/bayrağı yoksa günlükte `user_message` yok); `fakeDriver('prompt_auth_error')` yerine `session/new` auth hatası veren yeni küçük senaryo gerekiyorsa `new_auth_error` ekle → `error.code === 'auth_required'`; zaman aşımı `ok:false`; süreç kalmaz.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/launcher/handshake` — Expected: FAIL.
- [ ] **Step 3: Implement** betik ve belge; `README` yok, belge `docs/agents.md`.
- [ ] **Step 4: Run** the same command, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat: agent handshake check and agents guide`.

### Task 5: Composer çipleri (model, mod, çaba)

**Files:**
- Create: `apps/web/src/components/ConfigChips.tsx`, `apps/web/src/components/Menu.tsx`, `apps/web/src/lib/configChips.ts`
- Modify: `apps/web/src/components/ChatView.tsx`, `apps/web/src/i18n/{en,tr}.ts`
- Test: `apps/web/src/lib/configChips.test.ts`, `apps/web/src/components/ConfigChips.test.tsx`, `apps/web/src/App.test.tsx` (mevcut entegrasyon testine ekleme)

**Interfaces:**
- Consumes: `SessionState.configOptions` (Task 1), `conn.send({type:'set_config', sessionId, configId, value})`.
- Produces: `chipOrder(options: ConfigOption[]): ConfigOption[]` — sıra: category `mode`, `model`, `thought_level`, diğer kategoriler (kategorisiz dahil) sonda; yalnız `choices.length >= 1` olanlar; `chipLabel(option): string` (`option.name` + seçili `choices[].name` ya da `currentValue` listede yoksa ham değer). `<ConfigChips options disabled pendingId onChange />` — her seçenek için bir çip düğmesi (adı ve seçili değer), tıklayınca `Menu` (klavye: ok tuşları, Enter, Esc, ilk harfe atlama; `role="menu"`/`menuitemradio`, seçili öğe `aria-checked`), uzun listelerde (> 8) kaydırılabilir ve filtre kutulu; `onChange(configId, value)`. Diğer (kategorisiz/bilinmeyen) seçenekler tek "Diğer" menüsünde toplanır. `disabled` iken (tur sürüyor veya ajan koptu) çipler görünür ama etkin değil. Seçim sonrası çip `pendingId` boyunca "bekliyor" durumunda kalır ve **yalnız sunucunun yeni `config_options` olayıyla** değer değişir (iyimser güncelleme yok); `error` mesajı gelirse bekleme biter ve banner gösterilir (mevcut hata akışı). Çipler `Composer`'ın altında, `ChatView` içinde; `Composer` dışa açık prop'ları değişmez. Ajanın hiç seçeneği yoksa (`null` veya boş) çip satırı hiç render edilmez.

- [ ] **Step 1: Write the failing tests:** `chipOrder` (Claude fixture'ı: mod, model, çaba, sonra `agent` "Diğer"de; agy: model, thought_level, mode → mod, model, thought_level; boş/`null` → boş), `chipLabel` (`currentValue` listede yok → ham değer); `ConfigChips` (jsdom): çipler adlarıyla görünür; tıklama menüyü açar, ok tuşları + Enter `onChange('model','opus')` çağırır, Esc kapatır ve odağı çipe döndürür; 30 seçenekli listede filtre yazınca daralır; `disabled` iken tıklama menü açmaz; `pendingId` iken ilgili çip `aria-busy`; seçenek adı `<img onerror>` içerse metin olarak görünür; yinelenen kimlikli iki seçenek anahtar uyarısı üretmez. App entegrasyonu (fake socket): `config_options` olayı gelince çipler çıkar; menüden seçim `set_config` mesajı yazar ve değer yalnız yeni `config_options` olayı gelince değişir; `error{bad_request}` gelince banner çıkar ve çip eski değerde kalır; tur sürerken çipler devre dışı.
- [ ] **Step 2: Run** `npx vitest run apps/web` — Expected: FAIL.
- [ ] **Step 3: Implement.** Tüm metinler i18n'de (çip erişilebilir adı `{name}: {value}` biçimli bir anahtar; filtre placeholder'ı; "Diğer"; boş sonuç); renkler yalnız belirteçlerden; menü açıldığında odak yönetimi ve dışarı tıklayınca kapanma; mevcut `Composer`'ın otomatik odak mantığıyla çakışmasın.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm -w apps/web run build` — Expected: PASS, test çıktısı sessiz.
- [ ] **Step 5: Commit** — `feat(web): composer config chips for model, mode and effort`.

### Task 6: Kenar çubuğu ajan listesi ve giriş ipuçları

**Files:**
- Create: `apps/web/src/components/AgentList.tsx`, `apps/web/src/components/SignInHint.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/items/ErrorCard.tsx`, `apps/web/src/components/ChatView.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/i18n/{en,tr}.ts`
- Test: `apps/web/src/components/AgentList.test.tsx`, `apps/web/src/components/items/items.test.tsx`

**Interfaces:**
- Consumes: `GET /api/agents` yeni alanları (Task 3): `AgentInfo` genişler `{auth?:'signed_in'|'signed_out'|'unknown'; signInHint?:string; installHint?:string}`.
- Produces: `<AgentList agents />` kenar çubuğunun altında: ajan başına ad + durum (kurulu değil → soluk + `installHint` kopyalanabilir komut; kurulu ve `signed_out` → "Giriş gerekli" + `signInHint`; `signed_in` → "Giriş yapıldı"; `unknown` → yalnız kurulu) — durum rengi + metin, yalnız renk değil. `<SignInHint agentId hint />`: `auth_required` hatasında `ErrorCard` altında ilgili ajanın giriş komutunu kopyalanabilir kod olarak gösterir ("Terminalde şu komutu çalıştırıp giriş yapın: …"); ajanın `signInHint`'i yoksa yalnız genel metin. `ErrorCard` yalnız `auth_required` için ek `hint` prop'u alır; diğer hata kartları değişmez. Yeni oturum iletişim kutusunda `signed_out` ajan seçilebilir ama uyarı gösterir (engellenmez: durum `unknown` olabilir).

- [ ] **Step 1: Write the failing tests:** `AgentList` (jsdom): kurulu olmayan ajan soluk + kurulum komutu; `signed_out` → "Giriş gerekli" metni ve komut; `signed_in`; `unknown` yalnız kurulu; durum metni her durumda var (yalnız renk değil); `signInHint` metin olarak (HTML değil) render edilir; kopyala düğmesi `navigator.clipboard.writeText`'ı çağırır ve başarısızlıkta sessizce düşer (komut yine seçilebilir kalır). `ErrorCard` + `auth_required` → ipucu görünür; diğer kodlar → görünmez. App entegrasyonu: oturum `auth_required` hatasıyla bitince hata kartı ajanın ipucunu gösterir.
- [ ] **Step 2: Run** `npx vitest run apps/web` — Expected: FAIL.
- [ ] **Step 3: Implement** (tüm metinler i18n'de iki dilde; kopyalama yardımcısı küçük ve enjekte edilebilir).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm -w apps/web run build` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): agent list with sign-in status and hints`.

### Task 7: Gerçek ajanlarla doğrulama (denetleyici adımı)

**Files:**
- Modify: `docs/agents.md` (Sonuçlar), `docs/ui-verification.md` (yeni maddeler)

Bu görev kod değil doğrulamadır; uygulayıcı alt ajan değil denetleyici (ben) yapar ve sonucu yazar.

- [ ] **Step 1:** `npm run handshake -- claude`, `-- opencode`, `-- agy` çalıştırılır (kota harcamaz); çıktılar `docs/agents.md` Sonuçlar bölümüne işlenir.
- [ ] **Step 2:** `npm run build -w apps/web` + gerçek sunucu (`npm start -- --no-open`) + yerleşik tarayıcıda: ajan listesi ve durumları, yeni oturum, çiplerin göründüğü ve menü/klavye davranışı gerçek ajan seçenekleriyle (model/mod/çaba değiştirme **tur göndermeden** mümkündür: `set_config` bir tur değildir).
- [ ] **Step 3:** Kullanıcıdan **açık onay alınırsa** her ajanla tek, çok kısa bir gerçek tur ("Merhaba de"); onay yoksa atlanır ve belgede "doğrulanmadı" yazılır.
- [ ] **Step 4:** Commit — `docs: record agent handshake and UI verification results`.
