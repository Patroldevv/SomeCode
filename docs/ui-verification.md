# Sohbet arayüzü: elle doğrulama listesi

Her madde: ne yapılır, ne beklenir. Görsel kontroller gerçek bir tarayıcıda yapılır.

## Başlatma

1. `npm run build -w apps/web && npm run demo` çalıştır. Beklenen: tek satır `SomeCode demo: http://127.0.0.1:<port>/#token=...`; tarayıcı kendiliğinden açılmaz. `dist` yoksa `npm run build -w apps/web` demesi ve çıkış kodu 1.
2. Yazdırılan URL'yi tarayıcıda aç. Beklenen: kenar çubuğu ve boş durum görünür, konsolda hata yok.

## Oturum ve mesaj

3. Yeni oturum diyaloğunu aç; ajan "Demo agent", dizin olarak var olan bir mutlak yol (ör. `/tmp`) seç ve oluştur. Beklenen: oturum kenar çubuğunda belirir ve açılır.
4. Bir mesaj gönder. Beklenen: mesaj hemen görünür, durum noktası "çalışıyor" olur, tur ≈ 10-15 sn sürer.

## Akış sırasında

5. Düşünme: tur başlarken thinking bloğu canlı açık akar; bitince "Düşündü · N sn" olarak katlanır, tıklayınca açılıp kapanır.
6. Plan: üstte sabit (sticky) kalır; 3 girdinin durumları pending → in_progress → completed olarak ilerler, plan güncellemesi öncekinin yerine geçer.
7. Araç satırları: çalışırken spinner, bitince onay işareti; `npm test` satırı kırmızı "failed" olur.
8. Edit kartı: başlıkta `+n -m` sayıları, açınca satır içi diff görünür.
9. İzin kartı: edit öncesi görünür; bir seçeneğe çift tıkla. Beklenen: kart kapanır/devre dışı kalır ve ağ panelinde yalnızca bir yanıt gider.
10. Markdown: başlık, madde listesi, tablo ve renklendirilmiş `ts` kod bloğu doğru çizilir; dil belirtilmeyen blok düz kod olarak görünür; akış sırasında kapanmamış çit bozuk görünmez.
11. Güvenlik: `javascript:` bağlantısı ("click me") tıklanabilir bağlantı değildir; `<script>alert(1)</script>` metin olarak görünür ve çalışmaz; uzak görsel yüklenmez (ağ panelinde `example.invalid` isteği yok).
12. Uzun çıktı: 30 000+ karakterlik satır kısaltma notuyla gelir; sayfada yatay kaydırma çubuğu oluşmaz.

## Kaydırma

13. Akış sürerken fare tekerleğiyle yukarı kaydır. Beklenen: görünüm yerinde kalır, "En sona git" düğmesi çıkar; düğmeye tıklayınca en alta iner ve akışı tekrar izler.
14. Araç çıktısı, diff ve plan gibi iç kaydırıcıların içinde kaydırmak ana listeyi sabitlenmişlikten çıkarmaz (düğme çıkmaz).

## Kalıcılık ve gezinme

15. Sayfayı yenile. Beklenen: oturum ve tüm geçmiş aynen geri gelir.
16. `Ctrl+B` kenar çubuğunu açar/kapatır; yenilemeden sonra tercih korunur.
17. `Escape` yeni oturum diyaloğunu kapatır (oluşturma sürerken de).
18. Diyalogla ikinci bir oturum aç, ikisi arasında gidip gel. Beklenen: her oturum kendi akış durumunu ve yazılmamış taslağını korur.

## Görünüm

19. Dil: tarayıcı dilini `tr` ve `en` yaparak yenile (`navigator.language` ile doğrula). Beklenen: tüm metinler ilgili dilde.
20. Açık tema: konsolda `document.documentElement.dataset.theme = 'light'` ver. Beklenen: renkler okunaklı, bozulma yok.
21. Hareket azaltma: işletim sistemi veya DevTools'ta `prefers-reduced-motion: reduce` aç. Beklenen: spinner ve geçiş animasyonları durur/azalır.

## Sonuçlar

### 2026-11-07 — yerleşik tarayıcıda (Chromium tabanlı, 800×600, `tr` dili) `npm run demo` ile

Doğrulananlar:
- Yeni oturum iletişim kutusu (Demo agent, `/tmp`) açıldı ve oturum başladı; oturum kenar çubuğunda ilk kullanıcı mesajıyla etiketlendi.
- Canlı thinking "Düşünüyor…" olarak açık aktı, bitince "Düşündü · 2 sn" olarak katlandı.
- Yapışkan plan üstte kaldı ve durumları ilerledi (3 adımdan 1, sonra 3 tanesi bitti).
- Araç satırları: Read tamamlandı (onay), Edit `+13 -12` özetiyle, `npm test` kırmızı çarpıyla başarısız; Edit kartı açılınca satır içi diff metni geldi.
- İzin kartı: çift tıklamada tek yanıt gitti ("Yanıtlandı"), hata bandı çıkmadı; kenar çubuğu noktası izin beklerken sarı, çalışırken turuncu, hazırken yeşil.
- Markdown: başlık, liste, tablo ve Shiki renklendirmeli `ts` bloğu doğru; akış sırasında kapanmamış çit çökmedi.
- Güvenlik (DOM'dan ölçüldü): `<img>` 0, `<script>` 0, `javascript:` bağlantısı 0; tek bağlantı `https://example.com/docs` (`target=_blank`, `rel="noopener noreferrer"`); `<script>alert(1)</script>` metin olarak görünüyor; görselin alt metni ("tracker") görünüyor ve `example.invalid` için hiç ağ isteği yok.
- 36 341 karakterlik çıktı 20 000 karaktere kısaldı ("İlk 20 000 karakter gösteriliyor; 16 341 karakter daha gösterilmiyor."); sayfada yatay kaydırma yok.
- Akış sırasında tekerlekle yukarı kaydırınca konum 563 px'te sabit kaldı (içerik 1759 → 2721 px büyürken), "En sona git · 4 yeni" göründü; düğme en sona götürdü, takibi sürdürdü ve odak listeye geçti.
- Sayfa yenilenince oturum ve geçmiş aynen geri geldi.
- `Ctrl+B` kenar çubuğunu kapattı; `data-theme="light"` açık temayı uyguladı.

Bulgular ve doğrulanamayanlar:
- Açık temaya çalışma zamanında geçilince, koyu temayla zaten renklendirilmiş kod blokları koyu tema renklerinde kaldı (açık zeminde okunması çok zor). Tema düğmesi henüz yok, bu yüzden yalnızca elle `dataset.theme` değiştirince görülüyor; aşama 7'de tema değişiminde blokların yeniden renklendirilmesi gerekiyor (bilinen ertelenmiş madde).
- Yapışkan plan, `scrollIntoView` ile atlanan satırların üst kısmını örtebiliyor (kullanıcı kaydırmasında sorun yok).
- Doğrulanmadı: iç içe kaydırıcılarda (araç çıktısı/diff) tekerleğin üst listeyi gereksiz çözmesi, iletişim kutusunda Escape (oluştururken de), ikinci oturum ve oturumlar arası geçişte taslak korunması, `en` dili, `prefers-reduced-motion`. Bunlar yalnızca testlerle kapsanıyor.
