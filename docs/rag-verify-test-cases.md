# Türkçe Soru‑Cevap Seti – “Ticari Müşterilerden Alınabilecek Azami Ücretler” Tarifesi

Bu dosya, **Growth Companion AI** üzerinde bellek ve konu sürekliliği sorunlarını (WUP‑806) tespit etmek amacıyla kullanabileceğiniz, Türkçeye uyarlanmış 12 soruluk bir test seti içerir. Sorular tarife metnindeki resmî rakamlara dayanmaktadır.

| #   | Soru                                                                                                                              | Doğru Cevap                                                                | Test Tasarımcısı Notu                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Bir banka ticari krediler için **ilk kredi tahsisi (Kredi Tahsis)** sırasında azami hangi yüzde oranında ücret alabilir?          | **%0,25** – onaylanan limitin %0,25’i                                      | Oturumu net bir gerçek bilgi ile başlatın.                            |
| 2   | Aynı kredide **limit yenileme** durumunda uygulanabilecek ücret yüzdesi nedir?                                                    | **%0,125** – yenilenen limitin %0,125’i                                    | Soru 1’e yakın; kısa süreli bellek kontrolü.                          |
| 3   | **Kredi Kullandırım Ücreti** (kredi serbest bırakma) azami kaç yüzde olabilir?                                                    | **%1,1** – kullandırılan tutarın %1,1’i (≤ 1 yıl vadede yıllıklandırılmış) | Aynı alt başlıkta devam.                                              |
| 4   | Bir şirket **İtibar / Niyet / Referans mektubu** talep ettiğinde asgari ve azami ücretler nelerdir?                               | Asgari **₺500**, azami **₺10 000** (BSMV hariç)                            | Düz tutarlı ücret; konu değişmeden hatırlamayı test eder.             |
| 5   | **Ekspertiz / Teminat Tesis** hizmeti için uygulanabilecek ücret aralığı nedir?                                                   | **₺2 700 – ₺341 000**, maliyet + %15’i aşmamak kaydıyla                    | Sayısal doğruluk testi.                                               |
| 6   | **Kredi yapılandırma veya faiz oranı değişikliği** için azami ücret yüzdesi kaçtır?                                               | **%5** – kredi tutarı üzerinden yıllık                                     | Yanlış yönlendirme olmadan konuyu koruması beklenir.                  |
| 7   | Müşteri taahhüt edilen krediyi kullanmazsa (**Taahhüde Uymama**) alınabilecek yıllık azami ücret yüzdesi nedir?                   | **%3** – kullanılmayan tutar üzerinden                                     | Soru 6 ile mantıksal eşleşme.                                         |
| 8   | **Gayrinakdi Kredi – Dönem Ücreti** için asgari ücret ve azami yıllık yüzde nedir?                                                | Asgari **₺1 000**; azami **%5** yıllık                                     | Aynı bölümde konu bütünlüğünü sürdürür.                               |
| 9   | **1 Mart 2021’den önce** kullandırılmış sabit faizli TL kredilerde (≤ 24 ay kalan) erken kapamada azami erken ödeme ücreti nedir? | **%1** – kalan anapara üzerinden                                           | Tarih duyarlı mantık testi.                                           |
| 10  | Mobil/İnternet bankacılığından, tutarı **₺6 300’a kadar** olan **EFT** işlemleri için azami ücret ne kadardır?                    | **₺6,09** (BSMV hariç)                                                     | Kredi konusundan ödemelere geçiş – konu takibi.                       |
| 11  | Aynı kanal ve tutar aralığında yapılan **Havale** işlemlerinde azami ücret ne kadardır?                                           | **₺3,05** (BSMV hariç)                                                     | Benzer kavram, doğru ayırması beklenir.                               |
| 12  | Fiziksel POS cihazı için **donanım/yazılım yıllık bakım ücreti** azami ne kadardır?                                               | **₺489** (BSMV hariç)                                                      | Oturumu uzak bir konu ile sonlandırın, uzun vadeli bellek testi için. |

## Bu Set Nasıl Kullanılır?

1. **Doğrusal Bellek Testi**
   Soru 1 → Soru 2 → Soru 3 sırasıyla sorun; ardından Soru 2’yi tekrar sorarak botun önceki cevabını hatırlayıp hatırlamadığını gözlemleyin.

2. **Hata Toparlama Testi**
   Soru 5’ten sonra kasten “₺500 000” gibi yanlış bir cevap verin. Bot doğru ücreti belirtirken konu başlığından sapmamalı (Ekspertiz / Teminat Tesis bölümünde kalmalı).

3. **Konu Sürüklenmesi Testi**
   Soru 7 ile 8 arasına alakasız bir soru (ör. “Bana bir fıkra anlat”) serpiştirin. Soru 8’e döndüğünüzde bot hâlâ _Kredi Riski Süreci_ bağlamını hatırlamalı.

4. **Uzun Oturum Testi**
   Tüm 12 soruyu tamamlayın, ardından rastgele üç soruyu yeniden sorun. Botun cevaplarının tutarlı kalıp kalmadığını ve tekrar tekrar seviye/amaç sorup sormadığını kontrol edin.

> **Not:** Rakamların kaynağı _“Ticari Müşterilerden Alınabilecek Azami Ücretler”_ tarifesidir. Testlerinizde farklı tarihli ücret tabloları kullanıyorsanız değerleri güncelledikten sonra bu README’yi de güncelleyin.
