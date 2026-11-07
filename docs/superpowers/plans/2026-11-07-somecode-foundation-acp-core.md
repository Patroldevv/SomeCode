# SomeCode Foundation + ACP Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec'in 1. ve 2. aşamasını teslim etmek: `somecode` komutu sunucuyu ve minimal web arayüzünü başlatır; kullanıcı bir proje ve OpenCode oturumu açıp ACP üzerinden mesajlaşır, olaylar SQLite'a yazılır ve canlı akar.

**Architecture:** npm workspaces monorepo. `packages/protocol` (zod şemaları) sunucu ve web arasında paylaşılır. `apps/server` TypeScript'i doğrudan Node 26 ile çalıştırır (derleme adımı yok); ajanları stdio üzerinden `@agentclientprotocol/sdk` ile sürer, olayları normalize eder, `node:sqlite` olay günlüğüne yazar ve Hono + `ws` ile yayınlar. `apps/web` minimal bir Vite + React iskeletidir (tam sohbet arayüzü bir sonraki planda).

**Tech Stack:** Node 26, TypeScript (type stripping), npm workspaces, Hono 4 + `@hono/node-server` 2, `ws` 8, `@agentclientprotocol/sdk` 2.4 (stable v1 giriş noktası), zod, `node:sqlite`, Vitest 5, React 19, Vite 8, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-11-07-somecode-design.md` (bu plan §2 mimari, §4 hata yönetimi, §5 test, §6 aşama 1–2'yi uygular)

## Global Constraints

- Electron yok. Yalnızca yerel sunucu + web UI.
- Sunucu yalnızca `127.0.0.1`'de dinler. Her başlatmada rastgele oturum token'ı üretilir; HTTP'de `Authorization: Bearer`, WebSocket'te `?token=` sorgusu doğrulanır. `Origin` başlığı varsa `http://127.0.0.1:<port>` olmak zorundadır, yoksa 403.
- SomeCode token veya API anahtarı saklamaz; kimlik ajanın kendi CLI girişidir.
- ACP içe aktarımı yalnızca `@agentclientprotocol/sdk` (stable v1); `unstable` ve `experimental` kullanılmaz.
- Sunucu kodu Node type stripping ile çalışır: göreli içe aktarmalar `.ts` uzantılı, `enum` ve parametre özelliği (`constructor(private x)`) yok.
- Olay günlüğü her oturum için `seq` değeri 1'den başlayan, boşluksuz artan tam sayıdır.
- Bilinmeyen ACP olay tipleri atılmaz; `unsupported` olarak saklanır ve yayınlanır.
- Kullanıcıya görünen metinler `apps/web/src/i18n/{tr,en}.ts` dosyalarında; sunucu yalnızca hata `code` değeri döner, çeviri web'dedir.
- Proje klasörü şu an git deposu değildir. Commit adımlarından önce kullanıcıdan `git init` onayı alınır; onay yoksa commit adımları atlanır ve dosyalar çalışma dizininde bırakılır.
- Veri dizini: `$SOMECODE_DATA_DIR`, yoksa `${XDG_DATA_HOME:-~/.local/share}/somecode`; veritabanı `somecode.db`.

## Review Focus

1. Çok büyük araç çıktısı/olay (ör. 5 MB `rawOutput`): olay saklanır ama boyut sınırlanır, sunucu çökmez. → Task 2.
2. Bir tur sürerken ikinci `prompt` gelmesi: sessizce kuyruğa alınmaz, `turn_in_progress` hatasıyla reddedilir. → Task 7.
3. Var olmayan veya dizin olmayan proje yolu: ajan başlatılmadan `bad_request` döner. → Task 8.
4. Ajanın stdout'una JSON olmayan satır yazması veya tur ortasında çökmesi: oturum `disconnected` olur, bekleyen `prompt` ve izinler iptal edilir, sunucu ayakta kalır. → Task 5.
5. WebSocket'te geçersiz `afterSeq` (negatif, ondalık, son sıradan büyük) ve yanlış token/Origin: çökme yok; geçersiz `afterSeq` `bad_request`, büyük `afterSeq` boş replay, yanlış token 401, yanlış Origin 403. → Task 8.

**Bu planın dışında (sonraki planlar):** Claude ve Antigravity sürücüleri, `session/load` ile yeniden bağlanma, tam sohbet UI'ı (thinking, araç kartları, izin kartı), diff, dosya ağacı, terminal, tema ve paketleme.

---

### Task 1: Workspace iskeleti ve protocol paketi

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/protocol/package.json`, `packages/protocol/src/index.ts`, `packages/protocol/src/events.ts`, `packages/protocol/src/messages.ts`, `packages/protocol/src/errors.ts`
- Test: `packages/protocol/src/protocol.test.ts`

**Interfaces:**
- Produces (`@somecode/protocol`, `exports` → `./src/index.ts`):
  - `NormalizedEvent` (zod `normalizedEventSchema`), ayrık birleşim `type` alanıyla: `user_message{text}`, `agent_message{text}`, `agent_thought{text}`, `tool_call{id,title,kind,status,content,rawInput?}`, `tool_call_update{id,patch}`, `plan{entries[{content,status,priority}]}`, `permission_request{requestId,toolCallId,title,options[{id,name,kind}]}`, `permission_resolved{requestId,outcome:'selected'|'cancelled',optionId?}`, `turn_end{stopReason}`, `status{status:'ready'|'running'|'disconnected',reason?}`, `config_options{options}`, `unsupported{sessionUpdate,raw}`.
  - `ToolContent` = `{type:'text',text}` | `{type:'diff',path,oldText:string|null,newText}` | `{type:'terminal',terminalId}`.
  - `StoredEvent = {seq:number; sessionId:string; ts:number; event:NormalizedEvent}`.
  - `ClientMessage` (zod `clientMessageSchema`): `subscribe{sessionId,afterSeq}`, `prompt{sessionId,text}`, `cancel{sessionId}`, `permission_response{sessionId,requestId,optionId:string|null}`, `set_config{sessionId,configId,value}`.
  - `ServerMessage`: `subscribed{sessionId,lastSeq}`, `event{stored:StoredEvent}`, `error{code:ErrorCode,message}`.
  - `ErrorCode = 'bad_request'|'not_found'|'turn_in_progress'|'agent_not_installed'|'auth_required'|'disconnected'|'unauthorized'|'forbidden'|'internal'`; `class SomeCodeError extends Error { constructor(readonly code: ErrorCode, message: string) }` (parametre özelliği yerine alanı gövdede ata).

- [ ] **Step 1: Write the failing test** `protocol.test.ts`: (a) `normalizedEventSchema.parse({type:'agent_thought',text:'x'})` döner; (b) `normalizedEventSchema.safeParse({type:'tool_call'}).success === false`; (c) `clientMessageSchema.safeParse({type:'subscribe',sessionId:'s',afterSeq:-1}).success === false` ve `afterSeq:1.5` da `false` (negatif ve ondalık reddedilir), `afterSeq:0` kabul; (d) `new SomeCodeError('not_found','x').code === 'not_found'`.
- [ ] **Step 2: Run** `npx vitest run packages/protocol` — Expected: FAIL (modül yok).
- [ ] **Step 3: Scaffold + implement.** Kök `package.json`: `private`, `type: "module"`, `workspaces: ["packages/*","apps/*"]`, `engines.node: ">=26"`, betikler `test` (`vitest run`), `typecheck` (`tsc -b`). Bağımlılıkları kur: `zod`, `vitest`, `typescript`. `tsconfig.base.json`: `strict`, `module: nodenext`, `allowImportingTsExtensions`, `noEmit`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. `.gitignore`: `node_modules`, `dist`, `*.db`. Şemaları yukarıdaki arayüze göre yaz; `afterSeq` için `z.number().int().min(0)`.
- [ ] **Step 4: Run** `npx vitest run packages/protocol` — Expected: PASS.
- [ ] **Step 5: Verify Node type stripping across workspaces.** `apps/server/package.json` oluştur (`name: @somecode/server`, bağımlılık `@somecode/protocol: "*"`), `npm install`, sonra `node -e "import('@somecode/protocol').then(m=>console.log(Object.keys(m).length>0))"` (kökten, `apps/server` içinden çalıştır) — Expected: `true`. Hata verirse `exports` yolunu veya `.ts` uzantılarını düzelt.
- [ ] **Step 6: Commit** `feat: workspace skeleton and protocol package` (bkz. Global Constraints: depo yoksa önce kullanıcıdan `git init` onayı al).

### Task 2: SQLite store ve olay günlüğü

**Files:**
- Create: `apps/server/src/store/store.ts`, `apps/server/src/store/schema.sql.ts`
- Test: `apps/server/src/store/store.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent`, `StoredEvent` (Task 1).
- Produces: `openStore(dbPath: string): Store` (`':memory:'` desteklenir) ve
  `Store { addProject(p:{name:string;path:string}): Project; listProjects(): Project[]; getProject(id:string): Project|undefined; createSession(s:{projectId:string;agentId:string}): SessionRow; getSession(id:string): SessionRow|undefined; listSessions(projectId:string): SessionRow[]; setAcpSessionId(id:string, acpSessionId:string): void; appendEvent(sessionId:string, event:NormalizedEvent): StoredEvent; eventsSince(sessionId:string, afterSeq:number): StoredEvent[]; lastSeq(sessionId:string): number; close(): void }`
  `Project = {id,name,path,createdAt:number}`, `SessionRow = {id,projectId,agentId,acpSessionId:string|null,title:string|null,createdAt:number}`. Kimlikler `crypto.randomUUID()`.
  `MAX_EVENT_BYTES = 1_048_576`.

- [ ] **Step 1: Write the failing tests** `store.test.ts`: (a) `appendEvent` üç kez → `seq` `1,2,3`; iki ayrı oturumun sıraları birbirinden bağımsız. (b) `eventsSince(s,1)` yalnızca `seq 2,3`; `eventsSince(s,99)` `[]`. (c) Geçici dosya veritabanı kapatılıp yeniden açılınca projeler ve olaylar durur, sonraki `seq` kaldığı yerden devam eder. (d) 5 MB `rawOutput` içeren `tool_call_update` eklenince saklanan olayın JSON boyutu `MAX_EVENT_BYTES` altındadır ve `patch.rawOutput` `{truncated:true,bytes:<orijinal>}` biçimindedir; `text` içerikleri 64 KiB'a kısaltılıp sonuna `…[kısaltıldı]` eklenir.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/store` — Expected: FAIL.
- [ ] **Step 3: Implement** `openStore` (`node:sqlite` `DatabaseSync`, `PRAGMA journal_mode=WAL`, tablolar `projects`, `sessions`, `events(session_id, seq, ts, json, PRIMARY KEY(session_id, seq))`). `appendEvent` seq'i tek `INSERT … SELECT COALESCE(MAX(seq),0)+1` işleminde atamalı (eşzamanlılık güvenliği için işlem içinde). Boyut sınırını `appendEvent` içinde uygula; sınırlama yalnızca `rawInput`/`rawOutput`/metin içeriğini etkiler.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server): sqlite store with sequenced event journal`.

### Task 3: ACP olay normalizasyonu

**Files:**
- Create: `apps/server/src/acp/normalize.ts`
- Test: `apps/server/src/acp/normalize.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent`; SDK tipleri `SessionUpdate`, `RequestPermissionRequest` (`import type … from '@agentclientprotocol/sdk'`).
- Produces: `normalizeUpdate(update: SessionUpdate): NormalizedEvent | null` (`null` yalnızca tamamen yok sayılabilen güncellemeler için: `usage_update`, `session_info_update`, `available_commands_update`, `current_mode_update`); `normalizePermission(requestId: string, req: RequestPermissionRequest): Extract<NormalizedEvent,{type:'permission_request'}>`; `normalizeConfigOptions(options: SessionConfigOption[]): Extract<NormalizedEvent,{type:'config_options'}>`.

- [ ] **Step 1: Write the failing tests** (her biri SDK şeklinde girdi → beklenen çıktı): `agent_thought_chunk` metin bloğu → `{type:'agent_thought',text}`; `agent_message_chunk` → `agent_message`; `tool_call` + `kind:'edit'` + `content:[{type:'diff',path,oldText:null,newText}]` → `tool_call` ve `content[0]` `{type:'diff',path,oldText:null,newText}`; `tool_call` `status` yoksa `'pending'` olur; `tool_call_update` yalnızca verilen alanları `patch`'e koyar (`null` alanlar atlanır); `plan` girdileri aynen; metin dışı içerik bloğu (ör. görsel) `{type:'text',text:'[görsel]'}`'e düşer; `{sessionUpdate:'brand_new_thing',x:1}` → `{type:'unsupported',sessionUpdate:'brand_new_thing',raw:{…}}`; `usage_update` → `null`.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/acp/normalize` — Expected: FAIL.
- [ ] **Step 3: Implement** yukarıdaki imzalarla; `switch (update.sessionUpdate)`, varsayılan dal `unsupported`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server): normalize ACP session updates`.

### Task 4: PermissionBroker

**Files:**
- Create: `apps/server/src/permissions/broker.ts`
- Test: `apps/server/src/permissions/broker.test.ts`

**Interfaces:**
- Produces: `class PermissionBroker { request(): { requestId: string; decision: Promise<string | null> }; respond(requestId: string, optionId: string | null): boolean; cancelAll(): number }`. `decision` seçilen `optionId` ile ya da iptalde `null` ile çözülür. `respond` bilinmeyen/çözülmüş `requestId` için `false` döner.

- [ ] **Step 1: Write the failing tests:** `respond(id,'allow')` → `decision` `'allow'`; iki kez `respond` → ikincisi `false`; `cancelAll()` bekleyen iki isteği `null` ile çözer ve `2` döner; bilinmeyen id `false`.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/permissions` — Expected: FAIL.
- [ ] **Step 3: Implement** `Map<string, (v: string|null) => void>`; `requestId` `crypto.randomUUID()`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server): permission broker`.

### Task 5: Sahte ACP ajanı, AgentDriver ve AcpSession

**Files:**
- Create: `apps/server/src/agents/types.ts`, `apps/server/test-support/fake-agent.ts`, `apps/server/src/acp/session.ts`
- Test: `apps/server/src/acp/session.test.ts`

**Interfaces:**
- Consumes: `normalizeUpdate`, `normalizePermission`, `normalizeConfigOptions` (Task 3), `PermissionBroker` (Task 4), `NormalizedEvent`.
- Produces:
  - `types.ts`: `AgentLaunch = {command:string; args:string[]; env?:Record<string,string>}`; `AgentStatus = {installed:boolean; version?:string}`; `AgentDriver { id:string; label:string; launch(): AgentLaunch; detect(): Promise<AgentStatus> }`.
  - `fake-agent.ts`: stdio ACP ajanı (SDK `agent({name:'fake'})`); davranışı `FAKE_SCENARIO` ortam değişkeni belirler: `basic` (thought → message → `tool_call` diff'li edit → `tool_call_update completed` → `end_turn`), `permission` (araç çağrısından önce `session/request_permission`, sonuç `selected` ise devam, `cancelled` ise `stopReason:'cancelled'`), `crash` (prompt sırasında `process.exit(1)`), `garbage` (başlarken stdout'a `not json\n` yazar, sonra normal çalışır), `slow` (prompt başlayınca 30 sn bekler; `session/cancel` gelince `cancelled` döner).
  - `session.ts`: `class AcpSession { static start(opts:{driver:AgentDriver; cwd:string; onEvent:(e:NormalizedEvent)=>void}): Promise<AcpSession>; readonly acpSessionId: string; prompt(text:string): Promise<StopReason>; cancel(): Promise<void>; setConfig(configId:string, value:string): Promise<void>; respondPermission(requestId:string, optionId:string|null): boolean; close(): Promise<void> }`. `StopReason` SDK'dan.

- [ ] **Step 1: Write the failing tests** (`launch()` → `process.execPath`, `['apps/server/test-support/fake-agent.ts']`, `env.FAKE_SCENARIO`): (a) `basic`: `onEvent` sırası `status:ready`, `agent_thought`, `agent_message`, `tool_call`(kind `edit`, content diff), `tool_call_update`, `turn_end{end_turn}` ve `prompt()` `'end_turn'` döner. (b) `permission`: `permission_request` olayı gelir; `respondPermission(id,'allow')` sonrası tur biter ve `permission_resolved{selected,'allow'}` yayınlanır; `respondPermission(id,null)` ile `stopReason` `'cancelled'`. (c) `crash`: `prompt()` reddedilir (`SomeCodeError` kodu `'disconnected'`), son olay `status{disconnected}`, ve bekleyen izin varsa `permission_resolved{cancelled}` yayınlanır. (d) `garbage`: JSON olmayan satır oturumu düşürmez, `basic` akışı yine tamamlanır. (e) `slow`: `cancel()` çağrısı 2 sn içinde `prompt()`'u `'cancelled'` ile çözer. (f) `driver.launch().command` olmayan bir komutsa `start()` `SomeCodeError('agent_not_installed')` ile reddedilir.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/acp/session` — Expected: FAIL.
- [ ] **Step 3: Implement** `fake-agent.ts` SDK'nın `agent()` + `onRequest(methods.agent.*)` + `connect(ndJsonStream(...))` ile (Node akışları `Writable.toWeb`/`Readable.toWeb` ile). Implement `AcpSession.start`: `child_process.spawn(command,args,{cwd,env,stdio:['pipe','pipe','inherit']})`, `ndJsonStream`, `client({name:'somecode'}).onNotification(methods.client.session.update, …)` ve `.onRequest(methods.client.session.requestPermission, …)` (izin PermissionBroker'dan çözülene kadar bekler, sonucu `{outcome:{outcome:'selected',optionId}}` veya `{outcome:{outcome:'cancelled'}}` döner) ile `.connect(stream)`; ardından `initialize` (protokol sürümü `PROTOCOL_VERSION`, `clientCapabilities` boş — fs ve terminal henüz ilan edilmez) ve `session/new` `{cwd, mcpServers:[]}`. `session/new` yanıtındaki `configOptions` varsa `config_options` olayı yay. `connection.closed` veya alt süreç `exit` olayında `status{disconnected}` yay ve bekleyen her şeyi iptal et. Aynı anda ikinci `prompt()` çağrısını bu katmanda da `turn_in_progress` ile reddet. `stdout`'a JSON olmayan satırlar SDK akışında hata üretirse oturumu düşürmeden yok say (satır filtresi `ndJsonStream`'e verilen girdi akışında).
- [ ] **Step 4: Run** the same command — Expected: PASS (6 test).
- [ ] **Step 5: Commit** — `feat(server): ACP session over stdio with fake agent`.

### Task 6: OpenCode sürücüsü ve sürücü kayıt defteri

**Files:**
- Create: `apps/server/src/agents/opencode.ts`, `apps/server/src/agents/registry.ts`
- Test: `apps/server/src/agents/registry.test.ts`

**Interfaces:**
- Consumes: `AgentDriver`, `AgentStatus` (Task 5).
- Produces: `openCodeDriver: AgentDriver` (`id:'opencode'`, `label:'OpenCode'`, `launch()` → `{command:'opencode',args:['acp']}`, `detect()` `opencode --version` çıktısını okur; komut yoksa `{installed:false}`); `createRegistry(drivers: AgentDriver[]): { list(): AgentDriver[]; get(id:string): AgentDriver|undefined; statuses(): Promise<Array<{id:string;label:string} & AgentStatus>> }`; `defaultRegistry()` şimdilik yalnızca `openCodeDriver`.

- [ ] **Step 1: Write the failing tests:** PATH'e `opencode` adlı, `echo "1.2.3"` yazan geçici bir betik koyunca `openCodeDriver.detect()` `{installed:true,version:'1.2.3'}`; PATH boşken `{installed:false}`; `registry.get('yok')` `undefined`; `statuses()` sürücü başına bir kayıt döner.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/agents` — Expected: FAIL.
- [ ] **Step 3: Implement** (`execFile` ile `--version`, 5 sn zaman aşımı; `ENOENT` → `installed:false`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server): opencode driver and registry`.

### Task 7: SessionManager

**Files:**
- Create: `apps/server/src/sessions/manager.ts`
- Test: `apps/server/src/sessions/manager.test.ts`

**Interfaces:**
- Consumes: `Store`, `AgentRegistry` (Task 6), `AcpSession` (Task 5), `StoredEvent`, `SomeCodeError`.
- Produces: `class SessionManager { constructor(deps:{store:Store; registry:AgentRegistry}); createSession(projectId:string, agentId:string): Promise<SessionRow>; prompt(sessionId:string, text:string): void; cancel(sessionId:string): Promise<void>; respondPermission(sessionId:string, requestId:string, optionId:string|null): void; setConfig(sessionId:string, configId:string, value:string): Promise<void>; subscribe(sessionId:string, afterSeq:number, listener:(e:StoredEvent)=>void): {lastSeq:number; unsubscribe():void}; closeAll(): Promise<void> }`.
  `prompt` hemen döner (tur arka planda sürer); sonuç olaylarla gelir. Her `AcpSession` olayı `store.appendEvent` ile yazılır, ardından dinleyicilere yayınlanır.

- [ ] **Step 1: Write the failing tests** (sahte ajan sürücüsü ve `openStore(':memory:')` ile): (a) `createSession` `SessionRow` döner, `acpSessionId` kaydedilir; bilinmeyen proje/ajan `not_found`; kurulu olmayan ajan `agent_not_installed`. (b) `prompt` sonrası günlükte `agent_thought`…`turn_end` sırası ve `status:running` → `status:ready` geçişi; `seq` boşluksuz. (c) Tur sürerken (`slow` senaryosu) ikinci `prompt` → `SomeCodeError('turn_in_progress')`, ilk tur etkilenmez; `cancel` sonrası yeni `prompt` kabul edilir. (d) `subscribe(id, 0, fn)` geçmiş olayları sırayla ve ardından canlı olayları yinelemesiz/boşluksuz teslim eder (replay sırasında gelen canlı olay tekrar etmez); `afterSeq` son sıradan büyükse hiç geçmiş olay yok, `lastSeq` gerçek son sıra. (e) `unsubscribe` sonrası olay gelmez. (f) `crash` senaryosunda oturum `status:disconnected` olur ve sonraki `prompt` `disconnected` hatasıyla reddedilir.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/sessions` — Expected: FAIL.
- [ ] **Step 3: Implement** (`Map<sessionId, {session:AcpSession; listeners:Set; busy:boolean}>`). `subscribe`: dinleyiciyi önce kaydet, sonra `eventsSince` oku ve sırayla teslim et; son teslim edilen `seq`'e eşit veya küçük canlı olayları atla.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server): session manager with replay-safe subscriptions`.

### Task 8: HTTP + WebSocket sunucusu

**Files:**
- Create: `apps/server/src/http/app.ts`, `apps/server/src/http/ws.ts`, `apps/server/src/config.ts`, `apps/server/src/server.ts`
- Test: `apps/server/src/http/server.test.ts`

**Interfaces:**
- Consumes: `SessionManager` (Task 7), `Store`, `AgentRegistry`, `clientMessageSchema`/`ServerMessage`/`SomeCodeError`.
- Produces: `startServer(opts:{store:Store; registry:AgentRegistry; token:string; port?:number; staticDir?:string}): Promise<{port:number; url:string; close():Promise<void>}>` (`127.0.0.1`, `port` yoksa rastgele). `config.ts`: `dataDir(): string`.
  REST (hepsi `Authorization: Bearer`): `GET /api/agents` → `[{id,label,installed,version?}]`; `GET /api/projects`; `POST /api/projects {name,path}` → 201; `GET /api/projects/:id/sessions`; `POST /api/sessions {projectId,agentId}` → 201 `SessionRow`; `GET /api/sessions/:id/events?afterSeq=n`. Hatalar `{error:{code,message}}` ve `SomeCodeError` koduna göre HTTP durumu (`bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `turn_in_progress` 409, diğerleri 500; `agent_not_installed` 422). `GET /ws?token=…` WebSocket: `ClientMessage` alır, `ServerMessage` gönderir. `staticDir` verilirse token gerektirmeden servis edilir.

- [ ] **Step 1: Write the failing tests** (gerçek `startServer`, sahte ajan sürücüsü, `ws` istemcisi): (a) Token yok/yanlış → REST 401 ve WS bağlantısı reddedilir; `Origin: http://evil.example` → 403; `Origin` yok → izinli. (b) `POST /api/projects` var olmayan yol veya dosya yolu → 400 `bad_request` ve hiçbir ajan süreci başlamaz; geçerli dizin → 201. (c) Uçtan uca: proje + oturum oluştur, WS `subscribe{afterSeq:0}` → `subscribed`, `prompt` → sırayla `event` mesajları `turn_end`'e kadar gelir. (d) WS `permission` senaryosunda `permission_request` olayını alıp `permission_response` ile tur tamamlanır. (e) WS yeniden bağlanıp `afterSeq:<son görülen>` ile yalnızca eksik olayları alır; `afterSeq:999999` boş replay ve `subscribed.lastSeq` gerçek son sıra; `afterSeq:-1` ve `afterSeq:1.5` `error{bad_request}` döner, bağlantı açık kalır. (f) Geçersiz JSON veya şema dışı WS mesajı → `error{bad_request}`, bağlantı kopmaz. (g) Tur sürerken ikinci `prompt` → `error{turn_in_progress}`.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/http` — Expected: FAIL.
- [ ] **Step 3: Implement** Hono uygulaması (`createApp(deps)`), `@hono/node-server` `serve`, `ws` `WebSocketServer({noServer:true})` ile `server.on('upgrade')` içinde token ve Origin doğrulaması; Origin karşılaştırması `http://127.0.0.1:${port}` ile. Hata eşleme tek bir yerde (`app.onError`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(server): authenticated HTTP and WebSocket API`.

### Task 9: Web iskeleti

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/lib/connection.ts`, `apps/web/src/lib/sessionState.ts`, `apps/web/src/i18n/tr.ts`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/lib/sessionState.test.ts`

**Interfaces:**
- Consumes: `StoredEvent`, `ClientMessage`, `ServerMessage` (Task 1); Task 8 REST/WS.
- Produces: `SessionState = {lastSeq:number; items:Item[]; status:'ready'|'running'|'disconnected'}`; `applyEvent(state:SessionState, stored:StoredEvent): SessionState` (saf fonksiyon); `Item` = `{kind:'user'|'agent'|'thought',text}` | `{kind:'tool',id,title,status,…}` | `{kind:'permission',requestId,…,resolved:boolean}` | `{kind:'unsupported',…}`. `createConnection(opts:{url:string; token:string}): {send(m:ClientMessage):void; onMessage(cb):void; close():void}` — kopunca üstel geri çekilmeyle yeniden bağlanır ve her `subscribe`'ı son `lastSeq` ile yeniler. `t(key)` `navigator.language` `tr` ile başlıyorsa Türkçe, yoksa İngilizce.

- [ ] **Step 1: Write the failing tests** `sessionState.test.ts`: (a) art arda `agent_message` parçaları tek `agent` öğesinde birleşir; araya `tool_call` girince yeni `agent` öğesi açılır. (b) `agent_thought` parçaları `thought` öğesinde birleşir. (c) `tool_call_update` ilgili `tool` öğesinin alanlarını günceller (başka öğeye dokunmaz). (d) `seq <= lastSeq` olan olay yok sayılır (replay yinelemesi). (e) `status` olayı `state.status`'u günceller. (f) `permission_resolved` ilgili öğeyi `resolved:true` yapar.
- [ ] **Step 2: Run** `npx vitest run apps/web` — Expected: FAIL.
- [ ] **Step 3: Implement** `applyEvent` ve bağlantı istemcisi. UI (minimal, yalnızca akışı kanıtlamak için): ajan seçimi, proje adı/yolu girişi, "Oturum başlat", mesaj kutusu, öğelerin düz listesi, bekleyen izin için üç düğme (`allow_once`, `allow_always`, `reject_once` seçenekleri). Token `location.hash`'ten (`#token=…`) okunur ve `sessionStorage`'a yazılıp hash temizlenir. Tüm metinler i18n dosyalarından. Vite `build` çıktısı `apps/web/dist`.
- [ ] **Step 4: Run** `npx vitest run apps/web` ve `npm -w apps/web run build` — Expected: PASS ve derleme hatasız.
- [ ] **Step 5: Commit** — `feat(web): minimal client with replay-safe session state`.

### Task 10: `somecode` başlatıcısı ve gerçek OpenCode duman testi

**Files:**
- Create: `bin/somecode.ts`, `apps/server/src/launcher/browser.ts`, `docs/smoke-tests.md`
- Modify: kök `package.json` (`bin.somecode`, `scripts.start`)
- Test: `apps/server/src/launcher/browser.test.ts`

**Interfaces:**
- Consumes: `startServer`, `openStore`, `defaultRegistry`, `dataDir` (Task 2, 6, 8).
- Produces: `pickBrowserCommand(url:string, pathEnv:string): {command:string; args:string[]}` — PATH'te sırayla `chromium`, `chromium-browser`, `google-chrome-stable`, `google-chrome`, `brave`, `microsoft-edge-stable` aranır; bulunan için `args:['--app='+url]`, hiçbiri yoksa `{command:'xdg-open',args:[url]}`.
  `bin/somecode.ts`: `--no-open` ve `--port` bayrakları; token `crypto.randomBytes(24).toString('base64url')`; `staticDir` `apps/web/dist`; stdout'a `SomeCode: <url>#token=<token>` yazar ve (bayrak yoksa) tarayıcıyı açar; `SIGINT`/`SIGTERM`'de `close()`.

- [ ] **Step 1: Write the failing tests** `browser.test.ts`: geçici PATH dizininde yalnızca `google-chrome` çalıştırılabilir dosyası varsa `{command:'google-chrome',args:['--app=http://x']}`; hem `chromium` hem `google-chrome` varsa `chromium` seçilir; hiçbiri yoksa `xdg-open`; çalıştırma izni olmayan dosya yok sayılır.
- [ ] **Step 2: Run** `npx vitest run apps/server/src/launcher` — Expected: FAIL.
- [ ] **Step 3: Implement** `pickBrowserCommand` ve `bin/somecode.ts`; `docs/smoke-tests.md`'ye elle duman testi yaz: `npm run build -w apps/web && npm start -- --no-open`, çıkan URL'i tarayıcıda aç, `OpenCode` ajanıyla `/tmp/somecode-smoke` dizinini proje yap, "Merhaba de" yaz. Beklenen: oturum `ready`, en az bir `agent_message` ve `turn_end` görünür, sayfa yenilenince geçmiş replay ile aynen gelir. `opencode` girişi yapılmamışsa beklenen davranış: oturum `disconnected` + `auth_required` nedeni (bu durum plan dışı bir hata değil; giriş akışı sonraki planda).
- [ ] **Step 4: Run** `npx vitest run` (tüm paketler) ve `npm run typecheck` — Expected: tüm testler PASS, tip hatası yok.
- [ ] **Step 5: Elle duman testini çalıştır** (`docs/smoke-tests.md`) ve sonucu (geçti / `auth_required`) o dosyanın sonuna tarihle ekle.
- [ ] **Step 6: Commit** — `feat: somecode launcher and smoke-test notes`.
