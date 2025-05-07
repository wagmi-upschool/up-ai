# İki Aşamalı RAG Akışı Dokümantasyonu (`whatToAskController.js`)

Bu doküman, `whatToAskController.js` içerisinde kullanılan yapılandırma, prompt oluşturma ve sohbet özetleme mekanizmalarını açıklamaktadır.

## Yapılandırma (`rag.json`)

Sistem, harici bir JSON dosyası (`https://raw.githubusercontent.com/wagmi-upschool/mobile-texts/refs/heads/main/rag.json`) üzerinden yapılandırılır. Bu yapılandırma, farklı senaryolara göre yapay zekanın davranışlarını belirler.

**Örnek Yapılandırma:**

```json
{
  "scenarios": [
    {
      "id": "Role-play",
      "assistantIds": [],
      "taskInstructions": "For ROLE-PLAY scenarios: Stay in character while subtly demonstrating principles from context Model effective behaviors without breaking immersion Let user learn through the experience rather than instruction",
      "stage2Instructions": "Refine the prepared response to maintain character and role-play dynamics: Adapt tone/reactions based on established character interaction in HISTORY Reference previous HISTORY exchanges to build the narrative Adjust responses based on user's engagement within the role-play in HISTORY Weave in principles from original context naturally within the character's actions/dialogue Keep interaction immersive and focused on the role-play scenario rather than explicit instruction. Always answer in Turkish"
    },
    // ... diğer senaryolar ...
    {
      "id": "General",
      "assistantIds": [],
      "taskInstructions": "Provide a clear and contextual response based on the provided information.",
      "stage2Instructions": "Refine the prepared response for continuity and clarity: Adapt tone based on HISTORY interaction pattern Reference previous topics from HISTORY if relevant Ensure response logically follows from HISTORY Maintain focus on addressing the QUERY clearly. Always answer in Turkish"
    }
  ]
}
```

### Yapılandırma Alanları

Her bir senaryo objesi aşağıdaki alanları içerir:

- **`id` (String):** Senaryonun benzersiz tanımlayıcısıdır. Örnek: `"Role-play"`, `"Mentorship"`, `"General"`. Bu `id`, kod içerisinde senaryo tipini belirlemek için kullanılır.
- **`assistantIds` (Array<String>):** Bu alan, belirli asistan ID'lerinin doğrudan bu senaryoyu kullanmasını sağlar. Eğer gelen istekteki `assistantId` bu dizide bulunuyorsa, diğer senaryo belirleme mekanizmaları (örneğin, grup bazlı belirleme) atlanır ve bu senaryo kullanılır. Bu, "senaryo geçersiz kılma (override)" mekanizmasıdır. Boş bir dizi `[]`, bu senaryonun herhangi bir asistan ID'si için özel olarak atanmadığı anlamına gelir.
- **`taskInstructions` (String):** Birinci aşama (Stage 1) LLM çağrısı için temel görev talimatlarıdır. Bu talimatlar, LLM'in kullanıcı sorgusuna ve bilgi tabanından alınan belgelere dayanarak nasıl bir ilk yanıt oluşturması gerektiğini tanımlar. Her senaryo için farklılaşan bu talimatlar, yanıtın amacını ve stilini belirler.
- **`stage2Instructions` (String):** İkinci aşama (Stage 2) LLM çağrısı için talimatlardır. Bu aşamada, birinci aşamada oluşturulan yanıt, sohbet geçmişi kullanılarak iyileştirilir. `stage2Instructions`, LLM'e bu iyileştirmeyi yaparken nelere dikkat etmesi gerektiğini (örneğin, karakter tutarlılığı, önceki konuşmalara referans verme, Türkçe cevap verme zorunluluğu) belirtir.

### Senaryo Belirleme ve Geçersiz Kılma (Override)

Sistem, kullanıcı sorgusuna en uygun senaryoyu belirlemek için bir önceliklendirme mekanizması kullanır:

1.  **Doğrudan `assistantId` Eşleşmesi:** `rag.json` dosyasındaki senaryolardan herhangi birinin `assistantIds` dizisi, istekteki `assistantId`'yi içeriyorsa, o senaryo doğrudan seçilir. Bu, en yüksek önceliğe sahip belirleme yöntemidir.
2.  **Asistan Grubu ile Belirleme:** Eğer doğrudan bir `assistantId` eşleşmesi bulunamazsa, sistem asistanın dahil olduğu grubu (`fetchAssistantGroupInfo` ile) ve grup başlığını (`mapGroupToScenarioType` ile) kullanarak bir senaryo tipi belirlemeye çalışır.
3.  **Varsayılan Senaryo:** Yukarıdaki yöntemlerle bir senaryo belirlenemezse, `id`'si `"General"` olan varsayılan senaryo kullanılır.

## `getStage1Prompt` Fonksiyonu

Bu fonksiyon, RAG akışının ilk aşaması için LLM'e gönderilecek olan prompt'u oluşturur.

**Amacı:** Kullanıcının sorgusunu ve bu sorguyla ilgili olarak bilgi tabanından (vektör veritabanı) alınan en alakalı belgeleri (context) birleştirerek, LLM'in ilk taslak yanıtı üretmesi için yapılandırılmış bir girdi hazırlar.

**Parametreleri:**

- `retrievedDocs` (Array): Bilgi tabanından (asistan dokümanları) kullanıcı sorgusuyla eşleşen ve puana göre filtrelenmiş dokümanların (NodeWithScore objeleri) bir dizisidir. Bu dokümanların metin içerikleri context olarak kullanılır.
- `userQuery` (String): Kullanıcının sorduğu orijinal soru veya ifade.
- `scenarioType` (String): Belirlenmiş olan senaryo ID'si (örneğin, `"Role-play"`, `"General"`). Bu, `taskInstructions`'ın doğru senaryo yapılandırmasından alınmasını sağlar.

**İşleyişi ve Özellikleri:**

1.  **Context Oluşturma:** `retrievedDocs` içerisindeki her bir dokümanın metin içeriği (`doc.node.text`) birleştirilerek genel bir bağlam (`context`) oluşturulur.
2.  **Task Talimatlarını Alma:** `scenarioType` kullanılarak `scenarioConfigs` içerisinden ilgili senaryonun `taskInstructions` talimatı alınır. Eğer belirtilen `scenarioType` bulunamazsa, `"General"` senaryosunun talimatları kullanılır.
3.  **Konuşma Tarzı Sorgu Yönetimi (Conversational Handling):**
    - Kullanıcı sorgusu, `conversationalKeywords` dizisindeki basit konuşma ifadeleriyle (örneğin, "selam", "merhaba", "tamam", "devam et") karşılaştırılır.
    - Eğer sorgu bu tür bir ifadeyse (`isConversational = true`), `taskInstructions`'a ek özel talimatlar eklenir. Bu talimatlar, LLM'in bu tür ifadelere doğal ve kısa yanıtlar vermesini, bağlamı kullanmamasını veya önceki konuşma akışını sürdürmesini söyler.
    - Eğer sorgu konuşma tarzı bir ifade ise, prompt içerisindeki `<context>` alanı `"No relevant context found."` olarak ayarlanır. Aksi halde, `retrievedDocs`'tan oluşturulan `context` kullanılır.
4.  **XML Yapısında Prompt:** Prompt, LLM'in girdiyi daha iyi ayrıştırabilmesi için XML benzeri bir yapıda oluşturulur:
    ```xml
    <prompt>
      <context>[Oluşturulan bağlam veya "No relevant context found."]</context>
      <query>[Kullanıcının sorgusu]</query>
      <scenario_type>[Belirlenen senaryo tipi]</scenario_type>
      <task>[Son görev talimatları (konuşma tarzı yönetimi dahil)]</task>
    </prompt>
    ```

## `getStage2Prompt` Fonksiyonu

Bu fonksiyon, RAG akışının ikinci ve son aşaması için LLM'e gönderilecek olan mesaj dizisini oluşturur. Bu aşamada amaç, ilk aşamada üretilen yanıtı sohbet geçmişi ve diğer bağlamsal bilgilerle zenginleştirerek daha tutarlı, akıcı ve bağlama uygun bir nihai yanıt elde etmektir.

**Amacı:** Stage 1'den gelen ilk yanıtı, sohbet geçmişini, kullanıcı sorgusunu ve senaryo talimatlarını bir araya getirerek LLM için kapsamlı bir girdi seti oluşturmaktır. Bu girdi, LLM'in son yanıtı üretirken akışı devam ettirmesini, önceki konuşulanları hatırlamasını ve senaryoya uygun davranmasını sağlar.

**Parametreleri:**

- `stage1Response` (String): İlk LLM çağrısından (Stage 1) dönen ham yanıt metni.
- `chatHistory` (Array): Kullanıcı sorgusuyla en alakalı bulunan ve puana göre filtrelenmiş son 5 sohbet mesajını içeren `NodeWithScore` dizisi.
- `query` (String): Kullanıcının mevcut sorgusu.
- `scenarioType` (String): Belirlenmiş olan senaryo ID'si. Bu, `stage2Instructions`'ın doğru senaryo yapılandırmasından alınmasını sağlar.
- `agentPrompt` (String): Asistanın temel sistem prompt'u (genellikle asistanın kimliğini, genel davranış kurallarını içerir). Bu, `fetchAssistantConfig` ile alınıp `replacePatterns` ile temizlenir.
- `summarizedHistoryText` (String): Uzun sohbet geçmişlerinin özetlenmiş hali.

**İşleyişi ve Özellikleri:**

1.  **Stage 2 Talimatlarını Alma:** `scenarioType` kullanılarak `scenarioConfigs` içerisinden ilgili senaryonun `stage2Instructions` talimatı alınır. Eğer belirtilen `scenarioType` bulunamazsa, `"General"` senaryosunun talimatları kullanılır.
2.  **Sohbet Geçmişini Formatlama:** `chatHistory` (en alakalı 5 mesaj) içerisindeki mesajlar, LLM'in anlayabileceği `role` (rol) ve `content` (içerik) formatına dönüştürülür. Mesajın `metadata.sender` alanına göre rol (`"user"` veya `"assistant"`) belirlenir.
3.  **Mesaj Dizisi Oluşturma:** LLM'e gönderilecek olan mesajlar belirli bir sıra ve rolle yapılandırılır:
    - **`role: "system"` (1):** Asistanın genel talimatları (`agentPrompt`) ve mevcut senaryonun `stage2Instructions`'ı birleştirilerek verilir. Bu, LLM'e genel davranış çerçevesini ve mevcut görevin özel gereksinimlerini bildirir.
    - **`role: "system"` (2):** Yanıtın maksimum 1000 karakter olması ve doğal bir şekilde sonlanması gerektiğine dair katı bir talimat eklenir.
    - **`role: "memory"`:** `summarizedHistoryText` içeriği bu rolle eklenir. Bu, LLM'e tüm sohbetin genel bir özetini sunar.
    - **Formatlanmış `chatHistory` Mesajları:** Kullanıcı ve asistanın önceki (en alakalı 5) mesajları sırayla eklenir.
    - **`role: "assistant"`:** `stage1Response` (ilk aşama yanıtı) bu rolle eklenir. Bu, LLM'e neyin üzerine iyileştirme yapacağını gösterir.
    - **`role: "user"`:** Mevcut kullanıcı sorgusu (`query`) en sona eklenir.

**Neden Hem Özetlenmiş Geçmiş Hem de En Alakalı 5 Sohbet Mesajı Kullanılıyor?**

Bu ikili yaklaşım, LLM'e sohbetin bağlamını en etkili şekilde sunmayı amaçlar:

- **`summarizedHistoryText` (`role: "memory"`):** Özellikle uzun sohbetlerde, tüm geçmişi token limitleri dahilinde LLM'e vermek mümkün olmayabilir veya maliyetli olabilir. Özetlenmiş geçmiş, konuşmanın genel akışını, önemli noktalarını ve evrildiği yönü kısa ve öz bir şekilde LLM'e iletir. Bu, genel bağlamı kaybetmemek için kritik öneme sahiptir.
- **`chatHistory` (En Alakalı 5 Mesaj):** Kullanıcının son sorgusuna en yakın ve en alakalı olan son mesajlar, detayı ve anlık bağlamı sağlar. LLM'in, kullanıcının tam olarak neye referans verdiğini veya bir önceki mesajına nasıl bir devam beklediğini anlamasına yardımcı olur.

Bu sayede LLM, hem geniş bir perspektife (özet) hem de dar, odaklanmış bir detaya (son mesajlar) sahip olur, bu da daha kaliteli ve bağlama uygun yanıtlar üretmesine olanak tanır.

**Neden Farklı `messageTypes` (Roller) Kullanılıyor? (`role: "system"`, `role: "user"`, `role: "assistant"`, `role: "memory"`)**

Farklı roller kullanmak, LLM'e (özellikle OpenAI'nin Chat Modellerine) verilen bilginin kaynağını ve amacını net bir şekilde ayırt etme imkanı sunar:

- **`role: "system"`:** Genellikle LLM'in genel davranışını, kişiliğini, uyması gereken kuralları ve görevin genel talimatlarını belirlemek için kullanılır. Bu mesajlar, LLM'in nasıl yanıt vermesi gerektiğine dair üst düzey bir çerçeve çizer.
- **`role: "user"`:** Kullanıcı tarafından yazılan mesajları temsil eder. LLM'in yanıtlaması veya tepki vermesi gereken girdilerdir.
- **`role: "assistant"`:** LLM'in (veya bir önceki asistan dönüşünün) verdiği yanıtları temsil eder. Bu, sohbet geçmişini oluştururken ve LLM'e önceki kendi cevaplarını hatırlatırken kullanılır.
- **`role: "memory"` (Özel Kullanım):** Kodda bu rol, özetlenmiş sohbet geçmişini LLM'e sağlamak için özel bir amaçla kullanılmıştır. Standart OpenAI rollerinden biri olmasa da, bu şekilde etiketlemek, LLM'in bu bilginin bir tür "hafıza" veya "arka plan bilgisi" olduğunu anlamasına yardımcı olabilir ve bu bilgiyi sistem veya kullanıcı mesajlarından farklı bir şekilde işlemesini sağlayabilir. LlamaIndex gibi kütüphaneler bu tür özel rolleri veya mesaj türlerini destekleyebilir.

Bu roller, LLM'in konuşmanın yapısını ve farklı bilgi parçalarının önemini daha iyi anlamasına yardımcı olarak, daha tutarlı ve amaca yönelik yanıtlar üretmesini sağlar.

## Sohbet Geçmişi Özetleme

Uzun sohbetlerde, tüm geçmişi LLM'e göndermek token limitlerini aşabilir ve performansı düşürebilir. Bu nedenle, `whatToAskController.js` içerisinde sohbet geçmişini özetlemek için bir mekanizma bulunur.

**İşleyişi:**

1.  **Tetikleme:** Kodda, filtrelenmiş `chatHistory` uzunluğu (en alakalı mesajlar) üzerinden bir loglama yapılsa da (`Chat history has ${chatHistory.length} messages, exceeding 5. Summarizing...`), özetleme işlemi için `getResponseSynthesizer`'a `fullChatHistory` (yani filtrelenmemiş, sorguya göre alınmış tüm geçmiş) verilir. Bu, genellikle sohbet geçmişi belirli bir uzunluğa ulaştığında (örneğin, 5 mesajdan fazla olduğunda) özetleme ihtiyacının doğduğu anlamına gelir.
2.  **`getResponseSynthesizer` Kullanımı:**
    - `getResponseSynthesizer("tree_summarize", { llm: Settings.llm })` çağrısıyla bir özetleyici (summarizer) oluşturulur.
    - `"tree_summarize"` stratejisi, dokümanları (bu durumda sohbet mesajlarını) hiyerarşik bir şekilde özetler. Önce küçük parçaları özetler, sonra bu özetleri birleştirerek daha genel bir özet oluşturur. Bu, uzun metinler için etkili bir yöntemdir.
3.  **Özetleme Sorgusu:** Özetleyiciye şu sorgu iletilir: `"Concisely summarize the key points of the following conversation history. This summary will serve as context for the next turn in the conversation."` Bu, LLM'e ne tür bir özet beklediğini açıklar.
4.  **Nodlar:** `fullChatHistory` (NodeWithScore dizisi) özetlenecek içerik olarak verilir.
5.  **Sonuç:** `summarizer.synthesize` çağrısı sonucunda dönen `summaryResponse.response`, özetlenmiş sohbet geçmişi metnini (`summarizedHistoryText`) içerir. Bu metin, daha sonra `getStage2Prompt` fonksiyonunda `role: "memory"` ile LLM'e sağlanır.

Bu özetleme mekanizması, LLM'in uzun sohbetlerde bile bağlamı korumasına yardımcı olurken, token kullanımını optimize eder.
