# SomeCode Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec'in 3. aşamasını teslim etmek: web istemcisindeki düz olay listesi yerine Claude Code kalitesinde bir sohbet arayüzü (akışlı markdown, canlı thinking, araç kartları, satır içi diff, yapışkan plan, izin kartı, çok oturumlu kenar çubuğu, composer).

**Architecture:** `apps/web` içinde saf durum katmanı (reducer + çok oturumlu store) ile bileşenler ayrılır. Reducer'ın ürettiği kararlı anahtarlı öğeler sanallaştırılmış bir listede bileşenlere dağıtılır. Sunucu ve protocol değişmez; tek istisna sahte ajana eklenen `rich` senaryosudur (demo ve doğrulama için).

**Tech Stack:** React 19, Vite 8, Tailwind 4 (mevcut); eklenecek: `react-markdown` 10 + `remark-gfm` 4, `shiki` 4 (`shiki/core` + tembel yüklenen diller), `@tanstack/react-virtual` 3, `diff` 9, Vitest 5 + `@testing-library/react` 16 + `@testing-library/user-event` 14 + `jsdom` 31 (bileşen testleri).

**Spec:** `docs/superpowers/specs/2026-11-07-somecode-design.md` (bu plan §3 UI, §5 UI testleri, §6 aşama 3'ü uygular). Önceki plan: `docs/superpowers/plans/2026-11-07-somecode-foundation-acp-core.md` (tamamlandı; web iskeleti ve protocol orada).

## Global Constraints

- Spec §3: "Koyu tema varsayılan, açık tema da var. Renkler CSS değişkenleriyle tanımlanır. Vurgu rengi tek, süs gölge ve gradyan yok." "Yanıt metni serif, arayüz sans-serif." "Arayüz dili Türkçe ve İngilizce; metinler baştan i18n dosyalarında." "Sohbet listesi sanallaştırılır. Markdown akışı parça parça render edilir. Kod blokları Shiki ile renklendirilir."
- Spec §3 sohbet akışı: Thinking "akarken canlı açık görünür. Bittiğinde süre etiketiyle tek satıra katlanır, tıklayınca açılır." Araç çağrıları "kompakt satırlar; çalışırken spinner, bitince onay işareti, hata olursa kırmızı; tıklayınca girdi ve çıktı açılır." Diff: "`+n -m` özetiyle gelir; genişletince satır içi diff görünür." Plan: "mesajların üstünde yapışkan bir kontrol listesi". İzin kartı akış içinde, düğmeler ajanın kendi seçenekleridir (ek "Reddet" düğmesi yok; `null` yanıt turu iptal eder).
- Kullanıcıya görünen her metin `apps/web/src/i18n/{tr,en}.ts` içinde (iki dilde de aynı anahtarlar; `MessageKey` tipi eksikleri derleme hatası yapar). Araç durumu gibi protokol sabitleri de çevrilir; ham enum gösterilmez.
- Güvenlik: ajan çıktısı güvenilmezdir. Markdown içinde ham HTML render edilmez (`rehype-raw` eklenmez), bağlantılar yalnızca `http`, `https`, `mailto`; uzak görseller yüklenmez; `dangerouslySetInnerHTML` yok. Token hiçbir yerde görüntülenmez veya loglanmaz.
- Mevcut davranışlar korunur: `applyEvent` saftır (girdi değişmez, `seq <= lastSeq` yok sayılır), iyimser yerel kullanıcı öğesi sunucunun `user_message` yankısıyla onaylanır, izin kartı tek yanıt gönderir (`planAnswer`), yenilemede aktif oturum geri gelir (`activeSession.ts`), yeniden bağlanmada son görülen seq'ten abone olunur.
- Sunucu ve protocol değişmez (`apps/server/test-support/fake-agent.ts` hariç). Server kodu için type stripping kuralları geçerli; web kodu Vite ile derlenir (`erasableSyntaxOnly`, `verbatimModuleSyntax` açık).
- `npm test`, `npm run typecheck` ve `npm -w apps/web run build` her görev sonunda temiz olmalı. Commit'ler yerel `main`'de (daha önce onaylandı), push yok; her commit mesajı `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` satırıyla biter.

## Review Focus

1. Ajan markdown'ı içinde `javascript:` bağlantısı, ham `<script>`/HTML ve uzak görsel (`![](http://…)`): hiçbiri çalışmaz veya ağ isteği yapmaz. → Task 4.
2. Çok uzun tek satırlık çıktı, çok büyük kod bloğu veya araç çıktısı, 5 000+ öğelik oturum: yerleşim bozulmaz (kaydırmalı bloklar, satır sarma), DOM'da yalnızca görünür satırlar bulunur, çıktı görünüm başına sınırlanır. → Task 5, 6.
3. Kullanıcı yukarı kaydırmışken akış sürerse görünüm zıplamaz; "en sona git" göstergesi çıkar; en alttaysa akış takip edilir. → Task 6.
4. Composer: IME bileşimi sırasındaki Enter göndermez, Shift+Enter satır ekler, boş/yalnız boşluk gönderilmez, tur sürerken Enter göndermez. → Task 7.
5. Reducer: `tool_call_update` bilinmeyen kimlik için yok sayılır, replay'i iki kez uygulamak aynı öğeleri ve aynı anahtarları üretir, tur bitiminden sonra gelen thought/plan öğeleri bozulmaz, thought süresi replay'de de aynıdır. → Task 1.

**Bu planın dışında:** model/mod/çaba çipleri ve giriş durumu (aşama 4), `@`/`/`/görsel composer özellikleri, Değişiklik/Dosyalar/Terminal sağ paneli ve yan yana diff (aşama 5–6), tema düğmesi, kısayol listesi, paketleme (aşama 7), başka oturumların canlı durum noktaları (sunucudan oturum özeti gerekir), oturum kapatma/silme, istemci `unsubscribe`.

---

### Task 1: Reducer v2 — kararlı anahtarlar, thought süresi, plan, tipli araç içeriği

**Files:**
- Modify: `apps/web/src/lib/sessionState.ts`
- Modify: `apps/web/src/lib/sessionState.test.ts`

**Interfaces:**
- Consumes: `StoredEvent`, `NormalizedEvent` (`@somecode/protocol`); `ts` her `StoredEvent`'te milisaniye.
- Produces (aynı dosyadan):
  - `ToolContentView = {type:'text';text:string} | {type:'diff';path:string;oldText:string|null;newText:string} | {type:'terminal';terminalId:string}`; `PlanEntry = {content:string;status:string;priority:string}`.
  - `Item` her varyantta `key: string` kazanır (oluşturan olayın `String(seq)`'i; iyimser yerel öğe için `local-<n>`, onaylanınca anahtarını korur). `thought` öğesi `startedAt: number` ve `endedAt?: number` taşır. `tool` öğesi `content: ToolContentView[]`, `rawInput?`, `rawOutput?` taşır.
  - `ThoughtItem = Extract<Item, {kind:'thought'}>` ve `ToolItem = Extract<Item, {kind:'tool'}>` dışa aktarılır (Task 5 bileşenleri kullanır).
  - `SessionState = {lastSeq:number; items:Item[]; status:SessionStatus; plan:PlanEntry[]|null; localSeq:number}`; `initialState()` ve `addLocalUserMessage(state, text)` aynı imzayla.

- [ ] **Step 1: Write the failing tests** (isimler ve doğrulamalar): `keys are the creating event's seq and stay stable when chunks append` (iki `agent_message` parçası → tek öğe, `key === String(ilk seq)`); `replaying the same events twice yields identical items and keys` (iki ayrı durumdan aynı olay listesi → `toEqual`); `thought records startedAt from the first chunk and endedAt from the next non-thought event` (`ts` 1000 ve 7000 → süre 6000; `status:running` olayı thought'u kapatmaz, `agent_message`/`tool_call`/`turn_end`/`status:disconnected` kapatır); `a thought arriving after turn_end starts a new item`; `tool_call_update for an unknown id is ignored` (durum değişmez, `lastSeq` ilerler); `tool_call content is converted to typed views` (text/diff/terminal; `oldText` undefined→null); `tool_call_update carries rawOutput and replaces content only when provided`; `plan replaces the previous plan and user_message clears it`; `local optimistic item keeps its key when confirmed`.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/lib/sessionState` — Expected: FAIL.
- [ ] **Step 3: Implement** yukarıdaki tipler ve `applyEvent` değişiklikleri. Tool `content`'i `unknown[]`'dan `ToolContentView[]`'a çeviren küçük bir `toToolContent(raw: unknown[]): ToolContentView[]` dosya içi yardımcı olsun; tanınmayan öğe `{type:'text', text:''}` yerine atlanır.
- [ ] **Step 4: Run** the same command and `npm run typecheck` — Expected: PASS (`App.tsx` yeni tiplerle derlenmiyorsa orada yalnızca tip uyumu için gereken en az değişikliği yap).
- [ ] **Step 5: Commit** — `feat(web): reducer v2 with stable keys, thought timing and plan state`.

### Task 2: Çok oturumlu store

**Files:**
- Create: `apps/web/src/lib/sessionsStore.ts`
- Test: `apps/web/src/lib/sessionsStore.test.ts`

**Interfaces:**
- Consumes: `SessionState`, `applyEvent`, `addLocalUserMessage`, `initialState` (Task 1); `StoredEvent`.
- Produces: `createSessionsStore(): SessionsStore` ve
  `SessionsStore { get(sessionId:string): SessionState; apply(sessionId:string, stored:StoredEvent): void; addLocalUser(sessionId:string, text:string): void; reset(sessionId:string): void; getDraft(sessionId:string): string; setDraft(sessionId:string, text:string): void; subscribe(listener:()=>void): ()=>void }`; `useSession(store:SessionsStore, sessionId:string|null): SessionState` (`useSyncExternalStore`; `null` için sabit boş durum).

- [ ] **Step 1: Write the failing tests:** `sessions are independent`; `get returns the same reference until that session changes` (başka oturuma olay uygulamak referansı değiştirmez; yinelenen seq referansı değiştirmez ve dinleyiciyi çağırmaz); `subscribe is notified once per effective change and stops after unsubscribe`; `reset forgets one session only`; `drafts are kept per session and survive apply`; `get for an unknown id returns a stable empty state`.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/lib/sessionsStore` — Expected: FAIL.
- [ ] **Step 3: Implement** `Map<string, SessionState>` + `Set` dinleyiciler; `useSession` için `useSyncExternalStore(store.subscribe, () => store.get(id))`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): multi-session store`.

### Task 3: Tasarım belirteçleri, bileşen test altyapısı, i18n parametreleri

**Files:**
- Modify: `apps/web/src/index.css`, `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/tr.ts`, `vitest.config.ts`, `apps/web/package.json`
- Create: `apps/web/src/test-setup.ts`
- Test: `apps/web/src/i18n/i18n.test.ts`, `apps/web/src/components/smoke.test.tsx` (altyapı doğrulaması; Task 5'te silinebilir)

**Interfaces:**
- Produces: `t(key: MessageKey, params?: Record<string, string|number>): string` — `{name}` yer tutucularını doldurur; yerelleştirme `navigator.language` ile (mevcut kural). Test için `setLanguageForTests(lang: string | null)` dışa aktarılır. CSS belirteçleri `:root` (koyu, varsayılan) ve `[data-theme='light']` altında: `--bg`, `--bg-elevated`, `--bg-subtle`, `--text`, `--text-muted`, `--border`, `--accent` (tek vurgu), `--danger`, `--success`, `--warning`, `--font-ui` (sans), `--font-voice` (serif: `ui-serif, Georgia, 'Times New Roman', serif`), `--font-mono`. Gölge ve gradyan yok.
- Test altyapısı: kök `vitest.config.ts` iki proje çalıştırır — mevcut `node` projesi (`*.test.ts`) ve `apps/web/src/**/*.test.tsx` için `jsdom` projesi (`test-setup.ts`: `@testing-library/react` `cleanup` her testten sonra, `afterEach`).

- [ ] **Step 1: Write the failing tests:** `i18n.test.ts` — `t('chat.send')` Türkçe dilde Türkçe, `en` dilinde İngilizce; `t(key, {n: 6})` yer tutucuyu doldurur; **her `MessageKey` tr ve en tablosunda vardır ve iki tablodaki `{param}` kümeleri aynıdır**. `smoke.test.tsx` — `render(<p>merhaba</p>)` jsdom'da `screen.getByText('merhaba')` bulur.
- [ ] **Step 2: Run** `npx vitest run apps/web` — Expected: FAIL.
- [ ] **Step 3: Implement.** Bağımlılıkları kur (`@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@testing-library/jest-dom` isteğe bağlı). Vitest projelerini yapılandır; mevcut `npm test` hâlâ tüm paketleri çalıştırsın. `index.css`'e belirteçleri yaz ve `body` arka planını/yazı tipini belirteçlerden ver.
- [ ] **Step 4: Run** `npm test` ve `npm run typecheck` — Expected: tümü PASS, jsdom testi dahil.
- [ ] **Step 5: Commit** — `feat(web): design tokens, jsdom component test setup, i18n params`.

### Task 4: Güvenli markdown ve Shiki

**Files:**
- Create: `apps/web/src/lib/safeUrl.ts`, `apps/web/src/lib/highlight.ts`, `apps/web/src/components/Markdown.tsx`, `apps/web/src/components/CodeBlock.tsx`
- Test: `apps/web/src/lib/safeUrl.test.ts`, `apps/web/src/components/Markdown.test.tsx`

**Interfaces:**
- Produces: `safeHref(url: string): string | null` (izinli: `http:`, `https:`, `mailto:`, `#…`; büyük/küçük harf, boşluk, kontrol karakteri ve `java\tscript:` gibi kamufle şemalar reddedilir); `highlightTokens(code: string, lang: string | undefined): Promise<HighlightedLine[] | null>` (`HighlightedLine = {text:string; color?:string}[]`; bilinmeyen dil veya yükleme hatasında `null` — düz metin gösterilir; Shiki `shiki/core` + JS regex motoru, diller tembel `import()` ile; tema renkleri koyu/açık temaya göre seçilir); `<Markdown text: string />` (react-markdown + remark-gfm; kod blokları `CodeBlock` ile; `CodeBlock` önce düz metni gösterir, vurgulama gelince değiştirir; kopyala düğmesi yok).

- [ ] **Step 1: Write the failing tests:** `safeHref` — `https://a.b` ve `mailto:x@y.z` ve `#bolum` geçer; `javascript:alert(1)`, `JaVaScRiPt:1`, ` javascript:1`, `java\tscript:1`, `data:text/html,x`, `vbscript:x`, `file:///etc/passwd` `null` döner. `Markdown.test.tsx` — (a) `[x](javascript:alert(1))` hiçbir `a[href^="javascript"]` üretmez ve metin `x` yine görünür; (b) `<script>alert(1)</script>` ve `<img src=x onerror=y>` DOM'da öğe olmaz, metin olarak görünür; (c) `![alt](http://evil.example/p.png)` `<img>` üretmez, `alt` metni görünür; (d) harici bağlantı `target="_blank"` ve `rel="noopener noreferrer"` taşır; (e) GFM tablosu `<table>` üretir; (f) kapanmamış çit (```` ```ts\nconst a ````) çökmeden `<pre>` içinde kod gösterir; (g) örnek bir belgenin **her önekini** sırayla render etmek hata fırlatmaz (akış simülasyonu); (h) çok uzun tek satırlık kod bloğu `overflow-x: auto` sınıfı/stiline sahip kapsayıcıdadır.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/lib/safeUrl apps/web/src/components/Markdown` — Expected: FAIL.
- [ ] **Step 3: Implement** yukarıdaki arayüzlerle. react-markdown `components` ile `a` → `safeHref` (null ise düz `span`), `img` → `alt` metni; ham HTML için ek eklenti kullanma. Vurgulama sonucunu `useEffect` ile al; bileşen sökülürse iptal et.
- [ ] **Step 4: Run** the same command and `npm -w apps/web run build` — Expected: PASS ve derleme hatasız (Shiki dilleri ayrı parçalara bölünmüş olmalı; ana paket 300 kB gzip altında kalır — `build` çıktısından kontrol et ve rapora yaz).
- [ ] **Step 5: Commit** — `feat(web): safe streaming markdown with shiki code blocks`.

### Task 5: Sohbet öğesi bileşenleri

**Files:**
- Create: `apps/web/src/lib/diffView.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/components/icons.tsx`, `apps/web/src/components/items/{UserMessage,AgentMessage,ThinkingBlock,ToolCard,DiffView,PlanChecklist,PermissionCard,ErrorCard,UnsupportedRow}.tsx`
- Test: `apps/web/src/lib/diffView.test.ts`, `apps/web/src/lib/format.test.ts`, `apps/web/src/components/items/items.test.tsx`
- Modify: `apps/web/src/i18n/{en,tr}.ts` (`thinking.live`, `thinking.done` `{seconds}`, `tool.status.pending|in_progress|completed|failed`, `tool.kind.*`, `tool.input`, `tool.output`, `tool.truncated` `{count}`, `plan.heading`, `plan.status.*`, `diff.added`/`diff.removed` erişilebilir etiketleri vb.)

**Interfaces:**
- Consumes: `Item` türleri, `ToolContentView`, `PlanEntry` (Task 1); `Markdown` (Task 4); `planAnswer`'ın mantığı `PermissionCard` dışında kalır (`onRespond(requestId, optionId)` prop'u).
- Produces:
  - `diffStats(oldText: string | null, newText: string): {added:number; removed:number}`; `diffLines(oldText: string | null, newText: string, context = 3): DiffLine[]` (`DiffLine = {type:'context'|'add'|'del'|'gap'; text:string}`; `diff` paketiyle; sınırsız büyük dosyada en çok 2 000 satır üretir, fazlası tek `gap` ile kısaltılır).
  - `formatDuration(ms: number): string` (`6000` → `6`, saniye yuvarlanır, en az 1); `truncateOutput(text: string, max = 20_000): {text:string; hiddenChars:number}`.
  - Bileşenler: `ThinkingBlock({item, live}: {item: ThoughtItem; live: boolean})` — `live` iken metin açık ve akar; değilken `aria-expanded` düğmesi "Düşündü · N sn" etiketiyle katlıdır, tıklayınca açılır. `ToolCard({item})` — tek satır: tür simgesi, başlık, durum (pending/in_progress → spinner, completed → onay, failed → kırmızı; bilinmeyen durum nötr nokta; durum metni her zaman `aria-label` olarak i18n'den); edit için `+n -m` özeti; tıklayınca `tool.input` (`rawInput` biçimli JSON, `truncateOutput` ile) ve `tool.output` (text blokları monospace; terminal için kimlik etiketi; diff için `DiffView`) açılır. `DiffView({path, oldText, newText})` satır içi diff. `PlanChecklist({plan})` — yapışkan kapsayıcı için sunum bileşeni (durum başına simge + `aria`). `PermissionCard({item, answered, onRespond})` — düğmeler `item.options`'tan, `answered` iken devre dışı, çözülmüşse "Yanıtlandı". `UserMessage`, `AgentMessage` (`--font-voice`, `Markdown`), `ErrorCard` (`errorText(code)`, `role="alert"`), `UnsupportedRow` (soluk satır; ham etiket yalnızca ikincil metin).

- [ ] **Step 1: Write the failing tests:** `diffView.test.ts` — yeni dosya (`oldText: null`) tüm satırlar `add`; aynı metin `{0,0}` ve boş diff; tek satır değişimi `{added:1, removed:1}` ve çevresinde en çok 3 bağlam satırı; sonda yeni satır farkı; 10 000 satırlık dosya `diffLines` sonucu ≤ 2 001 öğe. `format.test.ts` — `formatDuration(6000) === '6'`, `formatDuration(400) === '1'`; `truncateOutput('a'.repeat(30000))` 20 000 karakter ve `hiddenChars: 10000`. `items.test.tsx` — ThinkingBlock canlıyken metin görünür ve düğme yok; canlı değilken metin gizli, "Düşündü" etiketi 6 sn gösterir, tıklayınca metin görünür, tekrar tıklayınca gizlenir; ToolCard `failed` için erişilebilir "failed" etiketi (i18n), `completed` için onay, `in_progress` için `role="status"` spinner; edit kartında `+9 -3` metni; tıklayınca girdi JSON'u ve çıktı görünür; 30 000 karakterlik çıktıda "ilk 20 000 karakter" notu; PermissionCard yalnızca verilen seçenek adlarını düğme yapar (ek "Reddet" yok), `answered` iken tüm düğmeler `disabled`, tıklama `onRespond(requestId, optionId)`'i bir kez çağırır; PlanChecklist üç durumu ayırt edilebilir etiketlerle gösterir.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/lib/diffView apps/web/src/lib/format apps/web/src/components/items` — Expected: FAIL.
- [ ] **Step 3: Implement.** Simgeler `icons.tsx` içinde küçük satır içi SVG'ler (simge kütüphanesi eklenmez). Renkler yalnızca belirteçlerden. Uzun tek satır için kapsayıcılara `overflow-x-auto`/`break-words`.
- [ ] **Step 4: Run** the same command — Expected: PASS. Task 3'teki `smoke.test.tsx` artık gereksizse sil.
- [ ] **Step 5: Commit** — `feat(web): chat item components (thinking, tools, diff, plan, permission)`.

### Task 6: Sanallaştırılmış mesaj listesi

**Files:**
- Create: `apps/web/src/lib/scroll.ts`, `apps/web/src/components/MessageList.tsx`
- Test: `apps/web/src/lib/scroll.test.ts`, `apps/web/src/components/MessageList.test.tsx`
- Modify: `apps/web/src/i18n/{en,tr}.ts` (`list.jumpToLatest`, `list.newItems` `{count}`)

**Interfaces:**
- Consumes: `Item[]`, `SessionState['plan']`, `SessionStatus`; Task 5 bileşenleri.
- Produces: `isNearBottom(m: {scrollTop:number; clientHeight:number; scrollHeight:number}, threshold = 80): boolean`; `<MessageList items plan status answeredRequests onRespond />` — `@tanstack/react-virtual` ile dinamik yükseklikli satırlar, satır anahtarı `item.key`; `plan` varsa liste kapsayıcısının üstünde `position: sticky` olarak `PlanChecklist`; en alttayken yeni içerik listeyi takip eder; kullanıcı yukarı kaydırdıysa takip durur ve "En sona git" düğmesi (`list.jumpToLatest`, yeni öğe sayısıyla) görünür; düğme en sona götürür ve takibi sürdürür. Son thought öğesi `live` yalnızca `status === 'running'` ve `endedAt` yoksa.

- [ ] **Step 1: Write the failing tests:** `scroll.test.ts` — `isNearBottom({scrollTop: 920, clientHeight: 100, scrollHeight: 1000})` `true`; `scrollTop: 500` `false`; eşik sınırı (tam 80) `true`; `scrollHeight < clientHeight` (kısa liste) `true`. `MessageList.test.tsx` (jsdom'da yerleşim olmadığından sanallaştırıcıyı `getBoundingClientRect`/`offsetHeight` taklidiyle sabit yükseklik verecek şekilde yapılandır) — 5 öğe verilince hepsi görünür; 10 000 öğe verilince DOM'daki satır sayısı ≤ 60; `plan` verilince sticky plan kutusu listeden önce gelir; son thought canlıyken açık, `status: 'ready'`'de katlıdır.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/lib/scroll apps/web/src/components/MessageList` — Expected: FAIL.
- [ ] **Step 3: Implement.** Takip mantığını `useStickToBottom` adlı küçük bir hook'ta tut (kapsayıcı `onScroll` + `isNearBottom`; içerik değişince yalnızca takip açıksa `scrollToIndex(last)`). Kaydırma konumu geri yüklemeyi karıştırma: oturum değişince liste yeniden bağlanır ve en alta iner.
- [ ] **Step 4: Run** the same command — Expected: PASS. (Gerçek tarayıcıda zıplama kontrolü Task 9'un elle doğrulama listesindedir.)
- [ ] **Step 5: Commit** — `feat(web): virtualized message list with stick-to-bottom`.

### Task 7: Composer

**Files:**
- Create: `apps/web/src/components/Composer.tsx`
- Test: `apps/web/src/components/Composer.test.tsx`
- Modify: `apps/web/src/i18n/{en,tr}.ts` (`composer.stop`, mevcut `chat.placeholder`/`chat.send`)

**Interfaces:**
- Produces: `<Composer value onChange running disabled onSend onCancel />` — `value`/`onChange` denetimli (taslak Task 2 store'unda tutulur); `onSend(text: string)` kırpılmış metinle çağrılır; `running` iken gönder düğmesi yerine **Durdur** düğmesi (`onCancel`); metin alanı otomatik büyür (en çok 12 satır, sonra kaydırır); Enter gönderir, Shift+Enter yeni satır; `isComposing` iken Enter hiçbir şey yapmaz; boş veya yalnız boşluklu metin gönderilmez; gönderdikten sonra odak metin alanında kalır.

- [ ] **Step 1: Write the failing tests** (`userEvent`): `Enter sends the trimmed text once`; `Shift+Enter inserts a newline and does not send`; `Enter while IME composing does not send` (`fireEvent.keyDown(el, {key:'Enter', isComposing:true})`); `whitespace-only is not sent and the send button is disabled`; `while running Enter does not send and the stop button calls onCancel`; `disabled blocks everything`; `the textarea grows with content but is capped` (inline `style.height`/`maxHeight` kontrolü).
- [ ] **Step 2: Run** `npx vitest run apps/web/src/components/Composer` — Expected: FAIL.
- [ ] **Step 3: Implement** `Composer` (denetimli `<textarea>`; yükseklik `useLayoutEffect` ile `scrollHeight`'tan).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): composer with IME-safe keyboard handling`.

### Task 8: Kabuk, kenar çubuğu, yeni oturum ve App'in yeniden kurulması

**Files:**
- Create: `apps/web/src/components/{Sidebar,NewSessionDialog,ChatView,StatusDot}.tsx`, `apps/web/src/hooks/useConnection.ts`, `apps/web/src/lib/sessionLabel.ts`, `apps/web/src/lib/shortcuts.ts`, `apps/web/src/lib/sidebarPrefs.ts`
- Modify: `apps/web/src/App.tsx` (ince kabuğa indirgenir), `apps/web/src/lib/api.ts` (`projectSessions(projectId): Promise<SessionInfo[]>`; `SessionInfo`'ya `createdAt:number`, `title:string|null`), `apps/web/src/i18n/{en,tr}.ts`
- Test: `apps/web/src/lib/sessionLabel.test.ts`, `apps/web/src/lib/shortcuts.test.ts`, `apps/web/src/lib/sidebarPrefs.test.ts`, `apps/web/src/components/Sidebar.test.tsx`, `apps/web/src/components/NewSessionDialog.test.tsx`

**Interfaces:**
- Consumes: Task 2 store, Task 5–7 bileşenleri, mevcut `createConnection`, `createApi`, `planAnswer`, `loadActiveSession/saveActiveSession/clearActiveSession`.
- Produces: `sessionLabel(row: SessionInfo, state: SessionState | undefined, agents: AgentInfo[], now?: number): string` (state'te ilk `user` öğesi varsa onun ilk satırı, en çok 48 karakter; yoksa `"<ajan etiketi> · <göreli zaman>"`); `matchesShortcut(e: Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'>, combo: string): boolean` (`'ctrl+b'` Linux'ta `ctrlKey`; `metaKey` ile de eşleşir); `loadSidebarOpen(storage?)`/`saveSidebarOpen(open, storage?)` (try/catch'li, enjekte edilebilir depolama); `useConnection(opts): { conn, state }` (mevcut `App.tsx`'teki bağlantı, geri yükleme ve `not_found` temizleme mantığı buraya taşınır; olaylar `store.apply`'a gider; abonelik her zaman `afterSeq: store.get(id).lastSeq`); `StatusDot({state: SessionState})` — durumlar: çalışıyor, izin bekliyor (çözülmemiş `permission` öğesi var), bitti, koptu; renk + `aria-label` (i18n). Kenar çubuğu: proje başına oturum listesi (etkin oturum vurgulu), "Yeni oturum" düğmesi, bağlantı durumu, `Ctrl+B` ile açılır/kapanır (tercih saklanır). `NewSessionDialog`: yerel `<dialog>`; ajan seçimi (yalnızca kurulu olanlar seçilebilir), proje adı ve mutlak yol (`/` ile başlamıyorsa istemci tarafında uyarı; asıl doğrulama sunucudadır); hata `errorText(code)` ile. Boş durum: "İlk oturumunu başlat" başlığı + tek cümlelik açıklama + `Yeni oturum` eylemi (i18n).

- [ ] **Step 1: Write the failing tests:** `sessionLabel` — ilk kullanıcı mesajı 48 karakterde `…` ile kısalır, çok satırlıda yalnız ilk satır; state yoksa ajan etiketi + "5 dk önce" biçimi; ajan listesinde olmayan kimlik ham kimlikle gösterilir. `shortcuts` — `ctrl+b` Ctrl+B ile eşleşir, Ctrl+Shift+B ile eşleşmez, `metaKey` ile eşleşir. `sidebarPrefs` — varsayılan açık; kaydedilen değer okunur; depolama fırlatırsa varsayılan döner ve yazma sessizce geçer. `Sidebar.test.tsx` — iki projenin oturumları gruplanır, etkin oturum `aria-current="true"`, tıklama `onSelect(sessionId)` çağırır, boş durumda "İlk oturumunu başlat" ve eylem düğmesi görünür, `StatusDot` izin bekleyen oturum için "izin bekliyor" etiketi taşır. `NewSessionDialog.test.tsx` — kurulu olmayan ajan seçilemez, göreli yol uyarı gösterir ve gönder düğmesi devre dışıdır, gönderince `onCreate({agentId, name, path})` çağrılır, `ApiError('bad_request')` `errorText` ile gösterilir.
- [ ] **Step 2: Run** `npx vitest run apps/web` — Expected: FAIL.
- [ ] **Step 3: Implement.** Mevcut `App.tsx`'in davranışları değişmeden taşınır: yenilemede aktif oturum geri gelir ve sunucu `not_found` derse sessizce temizlenir, iyimser kullanıcı öğesi, `planAnswer` ile tek yanıt, `network` hatası bandı. `ChatView` = `MessageList` + `Composer` + hata bandı + ajan/durum başlığı; taslak `store.setDraft`. Eski düz form ve `ItemView` silinir.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm -w apps/web run build` — Expected: tümü PASS/temiz.
- [ ] **Step 5: Commit** — `feat(web): app shell with sidebar, new-session dialog and chat view`.

### Task 9: UI demo sunucusu, `rich` senaryosu ve elle doğrulama

**Files:**
- Modify: `apps/server/test-support/fake-agent.ts` (yeni `rich` senaryosu), `package.json` (`"demo": "node scripts/demo.ts"`)
- Create: `scripts/demo.ts`, `docs/ui-verification.md`
- Test: `apps/server/src/acp/session.test.ts` (yeni `rich` testi)

**Interfaces:**
- Produces: `rich` senaryosu — tek turda sırayla: ~3 sn aralıklı parçalara bölünmüş uzun bir `agent_thought_chunk`; `plan` (3 girdi, ilerleyen durumlar); `read` aracı (completed, metin çıktısı); `edit` aracı (diff içerikli, `+9 -3` civarı; ardından `permission_request`); `execute` aracı (failed, uzun çok satırlı çıktı ve 30 000+ karakterlik tek bir satır); parçalara bölünmüş `agent_message_chunk`'larla markdown (başlık, liste, GFM tablosu, kod çiti `ts`, `javascript:` bağlantısı, ham `<script>` ve uzak görsel örnekleri); `turn_end`. `scripts/demo.ts`: geçici veri dizini, `fakeDriver('rich')` kayıt defteriyle `startServer` (rastgele port, `apps/web/dist`), stdout'a `SomeCode demo: <url>#token=<token>`; Ctrl+C ile temiz çıkış.

- [ ] **Step 1: Write the failing test** (`session.test.ts`): `rich scenario emits every item kind the chat UI renders` — olay tipleri sırası `agent_thought … plan … tool_call(read) … tool_call(edit) … permission_request … tool_call(execute, failed) … agent_message … turn_end`, diff içeriği `oldText`/`newText` taşır, bir araç çıktısı ≥ 30 000 karakter, `agent_message` birleşik metni tablo, çit ve `javascript:` örneğini içerir.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/acp/session` — Expected: FAIL (`rich` bilinmiyor).
- [ ] **Step 3: Implement** senaryoyu ve `scripts/demo.ts`'i; `docs/ui-verification.md`'ye elle doğrulama listesini yaz (her madde: ne yapılır, ne beklenir): thinking canlı açık → bitince "Düşündü · N sn" katlı; araç satırları spinner → onay/kırmızı; edit kartında `+n -m` ve satır içi diff; sticky plan; izin kartı tek tıkla yanıtlanır; markdown tablo/kod renklendirme; `javascript:` bağlantısı tıklanamaz, `<script>`/görsel metin olarak görünür; 30 000+ karakterlik çıktı kısaltma notuyla gelir; akış sürerken yukarı kaydırınca görünüm zıplamaz ve "En sona git" çıkar; sayfa yenilenince oturum ve geçmiş aynen döner; `Ctrl+B` kenar çubuğunu açar/kapatır; hem `tr` hem `en` dilinde kontrol; açık tema için `data-theme="light"`'ı elle ver. Sonuçlar bölümü başlıkla boş bırakılır (denetleyici doldurur).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm -w apps/web run build`, ardından `npm run demo` açılıp `curl` ile `/` ve `/api/agents` kontrol edilir — Expected: PASS; demo sunucusu başlar ve SIGTERM ile 0 koduyla çıkar. (Görsel doğrulamayı denetleyici yerleşik tarayıcıda yapar; bu adımda tarayıcı açma.)
- [ ] **Step 5: Commit** — `feat: ui demo server and rich fake-agent scenario`.
