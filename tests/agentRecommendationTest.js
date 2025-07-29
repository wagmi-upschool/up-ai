/**
 * WUP-858: Enhanced Agent Recommendation Service Test Suite
 * Comprehensive validation test scenarios for the agent recommendation system
 * Features: Detailed logging, JSON result export, Turkish query validation
 */

import fs from 'fs/promises';
import path from 'path';
import { AgentRecommendationService } from '../services/agentRecommendationService.js';

const enhancedTestScenarios = {
  // ===== TECHNICAL QUERIES =====
  technical: [
    // SQL Related
    {
      query: "Veritabanı sorguları ile ilgili yardıma ihtiyacım var",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "veritabanı", "öğrenme"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Should return SQL-related agents",
      priority: "high",
    },
    {
      query: "SQL öğrenmek istiyorum başlangıç seviyesi",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "veritabanı", "adım adım", "eğitim"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Turkish SQL learning query",
      priority: "high",
    },
    {
      query: "veritabanı sorguları nasıl yazılır",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["veritabanı", "SQL"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Database query writing help in Turkish",
      priority: "high",
    },
    {
      query: "SELECT JOIN WHERE öğren",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "veritabanı"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Specific SQL commands learning",
      priority: "high",
    },
    // Programming
    {
      query: "Sıfırdan programlama öğrenmek istiyorum",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["programlama", "teknik beceriler", "öğrenme"],
      description: "General programming learning request",
      priority: "medium",
    },
    {
      query: "programlama dillerini öğrenmek istiyorum",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["programlama", "eğitim"],
      description: "Programming languages learning in Turkish",
      priority: "medium",
    },
    // Data Analysis
    {
      query: "Veri analizi ve görselleştirme yardımı",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "veritabanı"],
      description: "Data analysis focused query",
      priority: "medium",
    },
    {
      query: "veri analizi nasıl yapılır",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "veritabanı", "analiz"],
      description: "Data analysis in Turkish",
      priority: "medium",
    },
  ],

  // ===== COMMUNICATION SKILLS =====
  communicationSkills: [
    // Active Listening
    {
      query: "Etkin dinleme becerilerini nasıl geliştirebilirim",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["etkin dinleme", "aktif dinleme", "iletişim"],
      expectedAgents: ["Etkin Dinleme"],
      description: "Active listening improvement request",
      priority: "high",
    },
    {
      query: "etkin dinleme nasıl geliştirilir",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["etkin dinleme", "iletişim", "kişilerarası beceriler"],
      expectedAgents: ["Etkin Dinleme"],
      description: "Active listening in Turkish",
      priority: "high",
    },
    {
      query: "dinleme becerilerimi geliştirmek istiyorum",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["dinleme", "etkin dinleme", "iletişim"],
      expectedAgents: ["Etkin Dinleme"],
      description: "Listening skills improvement",
      priority: "high",
    },
    // Feedback Skills
    {
      query: "Yapıcı geri bildirim nasıl verilir",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["geri bildirim", "geribildirim", "iletişim"],
      expectedAgents: ["Geri Bildirim"],
      description: "Feedback giving skills",
      priority: "high",
    },
    {
      query: "geri bildirim verme teknikleri",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["geri bildirim", "iletişim", "yapıcı eleştiri"],
      expectedAgents: ["Geri Bildirim"],
      description: "Feedback techniques in Turkish",
      priority: "high",
    },
    {
      query: "nasıl etkili geri bildirim verebilirim",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["geri bildirim", "etkili", "iletişim"],
      expectedAgents: ["Geri Bildirim"],
      description: "Effective feedback giving",
      priority: "high",
    },
    // Question Asking
    {
      query: "Toplantılarda hangi soruları sormalıyım",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["soru sorma", "etkili sorular", "iletişim"],
      expectedAgents: ["Ne Sorayım ile doğru soruyu sor, etkini göster!"],
      description: "Meeting question skills",
      priority: "medium",
    },
    {
      query: "doğru soru sorma teknikleri",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["soru sorma", "soru becerileri", "iletişim"],
      expectedAgents: ["Ne Sorayım ile doğru soruyu sor, etkini göster!"],
      description: "Question asking techniques",
      priority: "medium",
    },
    // General Communication
    {
      query: "İş yerinde iletişim becerilerini geliştirme",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["iletişim", "kişilerarası beceriler"],
      description: "Workplace communication improvement",
      priority: "medium",
    },
    {
      query: "iletişim becerilerimi nasıl geliştirebilirim",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["iletişim", "kişilerarası beceriler"],
      description: "General communication improvement",
      priority: "medium",
    },
  ],

  // ===== PRODUCTIVITY & TIME MANAGEMENT =====
  productivity: [
    // Priority Setting
    {
      query: "Günlük görevleri nasıl öncelik sırasına koyarım",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["öncelik belirleme", "planlama", "verimlilik"],
      expectedAgents: [
        "Öncelikler Günlüğü ile günün 3 önceliğini belirle",
        "Önceliklerimi Belirleme",
      ],
      description: "Daily task prioritization",
      priority: "high",
    },
    {
      query: "günlük önceliklerimi nasıl belirlerim",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["öncelik belirleme", "günlük planlama", "verimlilik"],
      expectedAgents: [
        "Öncelikler Günlüğü ile günün 3 önceliğini belirle",
        "Önceliklerimi Belirleme",
      ],
      description: "Daily priority setting in Turkish",
      priority: "high",
    },
    {
      query: "önemli işleri nasıl belirlerim",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["öncelik belirleme", "önemli", "planlama"],
      expectedAgents: [
        "Öncelikler Günlüğü ile günün 3 önceliğini belirle",
        "Önceliklerimi Belirleme",
      ],
      description: "Important task identification",
      priority: "high",
    },
    // Time Management
    {
      query: "Yoğun çalışan profesyoneller için zaman yönetimi stratejileri",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["zaman yönetimi", "verimlilik", "etkinlik"],
      expectedAgents: ["Zamanını & Enerjini Sen Yönet"],
      description: "Professional time management",
      priority: "high",
    },
    {
      query: "zaman yönetimi nasıl yapılır",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["zaman yönetimi", "zaman kontrolü", "verimlilik"],
      expectedAgents: ["Zamanını & Enerjini Sen Yönet"],
      description: "Time management fundamentals",
      priority: "high",
    },
    {
      query: "zamanımı daha verimli kullanmak istiyorum",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["zaman yönetimi", "verimlilik", "etkinlik"],
      expectedAgents: ["Zamanını & Enerjini Sen Yönet"],
      description: "Efficient time usage",
      priority: "high",
    },
    // Energy Management
    {
      query: "çalışma günü boyunca enerji yönetimi",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["enerji yönetimi", "verimlilik"],
      expectedAgents: ["Zamanını & Enerjini Sen Yönet"],
      description: "Workday energy optimization",
      priority: "medium",
    },
    {
      query: "enerjimi nasıl yönetirim",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["enerji yönetimi", "verimlilik"],
      expectedAgents: ["Zamanını & Enerjini Sen Yönet"],
      description: "Energy management in Turkish",
      priority: "medium",
    },
  ],

  // ===== CAREER DEVELOPMENT =====
  careerDevelopment: [
    // Interview Preparation
    {
      query: "İş görüşmesine nasıl hazırlanılır",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["mülakat", "iş görüşmesi", "kariyer gelişimi"],
      expectedAgents: ["Mülakatlara Hazırlan"],
      description: "Job interview preparation",
      priority: "high",
    },
    {
      query: "iş görüşmesine nasıl hazırlanırım",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["mülakat", "iş görüşmesi", "hazırlık"],
      expectedAgents: ["Mülakatlara Hazırlan"],
      description: "Job interview prep in Turkish",
      priority: "high",
    },
    {
      query: "mülakat sorularına nasıl cevap veririm",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["mülakat", "soru", "cevap"],
      expectedAgents: ["Mülakatlara Hazırlan"],
      description: "Interview question answering",
      priority: "high",
    },
    // Performance Review
    {
      query: "Performans değerlendirme hazırlık ipuçları",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["performans değerlendirme", "kariyer koçluğu"],
      expectedAgents: ["Performans Değerlendirme Görüşmesine Hazırlan"],
      description: "Performance review preparation",
      priority: "high",
    },
    {
      query: "performans değerlendirmeye nasıl hazırlanırım",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["performans değerlendirme", "performans görüşmesi"],
      expectedAgents: ["Performans Değerlendirme Görüşmesine Hazırlan"],
      description: "Performance review prep in Turkish",
      priority: "high",
    },
    // General Career Growth
    {
      query: "Kariyer gelişimi stratejileri",
      expectedCategories: ["Kariyer Gelişimi", "Profesyonel Gelişim"],
      expectedKeywords: ["kariyer", "profesyonel gelişim", "gelişim"],
      description: "Career advancement guidance",
      priority: "medium",
    },
    {
      query: "kariyerimde nasıl ilerlerim",
      expectedCategories: ["Kariyer Gelişimi", "Profesyonel Gelişim"],
      expectedKeywords: ["kariyer", "ilerleme", "gelişim"],
      description: "Career progression in Turkish",
      priority: "medium",
    },
  ],

  // ===== PERSONAL DEVELOPMENT =====
  personalDevelopment: [
    // Habit Formation
    {
      query: "İyi alışkanlıklar nasıl oluşturulur",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: [
        "alışkanlık",
        "alışkanlık oluşturma",
        "kişisel büyüme",
      ],
      expectedAgents: ["Kendin yaz"],
      description: "Habit formation guidance",
      priority: "high",
    },
    {
      query: "iyi alışkanlıklar nasıl edinilir",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: ["alışkanlık", "edinme", "kişisel gelişim"],
      expectedAgents: ["Kendin yaz"],
      description: "Good habit acquisition",
      priority: "high",
    },
    {
      query: "kötü alışkanlıklarımı nasıl değiştirebilirim",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: ["alışkanlık", "davranış değişikliği"],
      expectedAgents: ["Kendin yaz"],
      description: "Bad habit changing",
      priority: "high",
    },
    // Growth Mindset
    {
      query: "Büyüme zihniyeti geliştirme",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: ["büyüme zihniyeti", "gelişim odaklı düşünce"],
      expectedAgents: ["Growth Mindset Ön Hazırlık"],
      description: "Growth mindset development",
      priority: "medium",
    },
    {
      query: "gelişim odaklı düşünce nasıl geliştirilir",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: ["gelişim odaklı düşünce", "büyüme zihniyeti"],
      expectedAgents: ["Growth Mindset Ön Hazırlık"],
      description: "Growth mindset in Turkish",
      priority: "medium",
    },
    // Daily Development
    {
      query: "Günlük kişisel gelişim rutini",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: ["günlük", "kişisel gelişim", "sürekli öğrenme"],
      expectedAgents: ["Her gün UP ile konuş"],
      description: "Daily development habits",
      priority: "medium",
    },
    {
      query: "her gün kendimi nasıl geliştirebilirim",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: ["günlük", "gelişim", "kişisel büyüme"],
      expectedAgents: ["Her gün UP ile konuş"],
      description: "Daily self-improvement",
      priority: "medium",
    },
  ],

  // ===== WELLNESS & MENTAL HEALTH =====
  wellness: [
    // Meditation
    {
      query: "Meditasyon pratiğine nasıl başlanır",
      expectedCategories: ["Kişisel Sağlık"],
      expectedKeywords: ["meditasyon", "derin düşünce", "farkındalık"],
      expectedAgents: ["Meditasyon Yapma"],
      description: "Meditation practice initiation",
      priority: "high",
    },
    {
      query: "meditasyon nasıl yapılır",
      expectedCategories: ["Kişisel Sağlık"],
      expectedKeywords: ["meditasyon", "zihin pratiği", "sakinlik"],
      expectedAgents: ["Meditasyon Yapma"],
      description: "Meditation practice in Turkish",
      priority: "high",
    },
    {
      query: "stres azaltma teknikleri",
      expectedCategories: ["Kişisel Sağlık"],
      expectedKeywords: ["stres", "meditasyon", "sakinlik"],
      expectedAgents: ["Meditasyon Yapma"],
      description: "Stress reduction techniques",
      priority: "high",
    },
    // Gratitude
    {
      query: "minnettarlık günlüğü faydaları",
      expectedCategories: ["Kişisel Sağlık"],
      expectedKeywords: ["minnettarlık", "mutluluk", "pozitif düşünce"],
      expectedAgents: ["Harika Şeyler Günlüğü"],
      description: "Gratitude journaling benefits",
      priority: "medium",
    },
    {
      query: "minnettarlık günlüğü nasıl tutulur",
      expectedCategories: ["Kişisel Sağlık"],
      expectedKeywords: ["minnettarlık", "günlük", "mutluluk"],
      expectedAgents: ["Harika Şeyler Günlüğü"],
      description: "Gratitude journal in Turkish",
      priority: "medium",
    },
    {
      query: "mutlu olmak için neler yapabilirim",
      expectedCategories: ["Kişisel Sağlık"],
      expectedKeywords: ["mutluluk", "sevinç", "pozitif"],
      expectedAgents: ["Harika Şeyler Günlüğü"],
      description: "Happiness enhancement",
      priority: "medium",
    },
  ],

  // ===== LEARNING & EDUCATION =====
  learning: [
    // Reading Habits
    {
      query: "Okuma alışkanlığı nasıl geliştirilir",
      expectedCategories: ["Öğrenme ve Eğitim"],
      expectedKeywords: ["kitap okuma", "okuma", "öğrenme"],
      expectedAgents: ["Kitap Okuma"],
      description: "Reading habit development",
      priority: "high",
    },
    {
      query: "kitap okuma alışkanlığı nasıl edinilir",
      expectedCategories: ["Öğrenme ve Eğitim"],
      expectedKeywords: ["kitap okuma", "alışkanlık", "eğitim"],
      expectedAgents: ["Kitap Okuma"],
      description: "Reading habit in Turkish",
      priority: "high",
    },
    {
      query: "hangi kitapları okumalıyım",
      expectedCategories: ["Öğrenme ve Eğitim"],
      expectedKeywords: ["kitap", "okuma", "öneri"],
      expectedAgents: ["Kitap Okuma"],
      description: "Book recommendations",
      priority: "medium",
    },
    // Professional Development
    {
      query: "Profesyonel beceri geliştirme",
      expectedCategories: ["Profesyonel Gelişim"],
      expectedKeywords: ["profesyonel gelişim", "beceri geliştirme"],
      expectedAgents: ["Gelişimime Zaman Ayırma"],
      description: "Professional skill building",
      priority: "medium",
    },
    {
      query: "mesleki gelişimime nasıl zaman ayırırım",
      expectedCategories: ["Profesyonel Gelişim"],
      expectedKeywords: ["mesleki gelişim", "profesyonel gelişim", "zaman"],
      expectedAgents: ["Gelişimime Zaman Ayırma"],
      description: "Professional development time allocation",
      priority: "medium",
    },
  ],

  // ===== SALES & BUSINESS =====
  salesBusiness: [
    {
      query: "Satış konuşması pratiği",
      expectedCategories: ["Satış Eğitimi"],
      expectedKeywords: ["satış", "satış eğitimi", "pratik"],
      expectedAgents: ["Satış Antrenörü - NAR Eğitim"],
      description: "Sales conversation skills",
      priority: "high",
    },
    {
      query: "satış görüşmesi nasıl yapılır",
      expectedCategories: ["Satış Eğitimi"],
      expectedKeywords: ["satış", "görüşme", "müşteri"],
      expectedAgents: ["Satış Antrenörü - NAR Eğitim"],
      description: "Sales meeting conduct",
      priority: "high",
    },
    {
      query: "müşteri ile nasıl konuşurum",
      expectedCategories: ["Satış Eğitimi"],
      expectedKeywords: ["müşteri", "satış", "iletişim"],
      expectedAgents: ["Satış Antrenörü - NAR Eğitim"],
      description: "Customer communication",
      priority: "high",
    },
  ],

  // ===== MENTORING =====
  mentoring: [
    {
      query: "Teknoloji alanında mentora ihtiyacım var",
      expectedCategories: ["Mentorluk"],
      expectedKeywords: ["mentorluk", "rehberlik", "koçluk"],
      expectedAgents: ["Mentorum ol"],
      description: "Technology mentoring request",
      priority: "high",
    },
    {
      query: "kariyer mentoru arıyorum",
      expectedCategories: ["Mentorluk"],
      expectedKeywords: ["mentor", "kariyer", "rehberlik"],
      expectedAgents: ["Mentorum ol"],
      description: "Career mentor search",
      priority: "high",
    },
    {
      query: "profesyonel gelişimde rehberlik",
      expectedCategories: ["Mentorluk", "Profesyonel Gelişim"],
      expectedKeywords: ["rehberlik", "profesyonel gelişim", "mentorluk"],
      expectedAgents: ["Mentorum ol"],
      description: "Professional development guidance",
      priority: "medium",
    },
  ],

  // ===== NOTE TAKING & ORGANIZATION =====
  noteTaking: [
    {
      query: "Toplantı sırasında not alma",
      expectedCategories: ["Not Alma"],
      expectedKeywords: ["not alma", "belgeleme", "özet"],
      expectedAgents: [
        "Hafıza Dostu ile notlarını yaz, özetlemesi benden!",
        "YGA Zirvesi Notlarım",
      ],
      description: "Meeting note taking",
      priority: "medium",
    },
    {
      query: "toplantı notlarımı nasıl organize ederim",
      expectedCategories: ["Not Alma"],
      expectedKeywords: ["not alma", "organize", "toplantı"],
      expectedAgents: ["Hafıza Dostu ile notlarını yaz, özetlemesi benden!"],
      description: "Meeting note organization",
      priority: "medium",
    },
    {
      query: "öğrenme notlarımı özetlemek istiyorum",
      expectedCategories: ["Not Alma"],
      expectedKeywords: ["not", "özet", "öğrenme"],
      expectedAgents: ["Hafıza Dostu ile notlarını yaz, özetlemesi benden!"],
      description: "Learning note summarization",
      priority: "medium",
    },
  ],

  // ===== LIFE PLANNING =====
  lifePlanning: [
    {
      query: "Yıl sonu değerlendirme ve planlama",
      expectedCategories: ["Yaşam Planlaması"],
      expectedKeywords: ["yıl değerlendirmesi", "planlama", "hedef belirleme"],
      expectedAgents: ["Yeni Yıl Yol Haritası"],
      description: "Annual planning and reflection",
      priority: "medium",
    },
    {
      query: "yeni yıl hedeflerimi nasıl belirlerim",
      expectedCategories: ["Yaşam Planlaması"],
      expectedKeywords: ["hedef", "yeni yıl", "planlama"],
      expectedAgents: ["Yeni Yıl Yol Haritası"],
      description: "New year goal setting",
      priority: "medium",
    },
    {
      query: "geçen yılımı değerlendirmek istiyorum",
      expectedCategories: ["Yaşam Planlaması"],
      expectedKeywords: ["değerlendirme", "yıl", "düşünme"],
      expectedAgents: ["Yeni Yıl Yol Haritası"],
      description: "Past year evaluation",
      priority: "medium",
    },
  ],

  // ===== MIXED LANGUAGE QUERIES =====
  mixedLanguage: [
    {
      query: "SQL learning ve veritabanı management",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "veritabanı"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Mixed English-Turkish SQL query",
      priority: "medium",
    },
    {
      query: "time management ve zaman kontrolü",
      expectedCategories: ["Verimlilik"],
      expectedKeywords: ["zaman yönetimi", "verimlilik"],
      expectedAgents: ["Zamanını & Enerjini Sen Yönet"],
      description: "Mixed language time management",
      priority: "medium",
    },
    {
      query: "interview preparation mülakat hazırlığı",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["mülakat", "hazırlık"],
      expectedAgents: ["Mülakatlara Hazırlan"],
      description: "Mixed language interview prep",
      priority: "medium",
    },
  ],

  // ===== AMBIGUOUS QUERIES =====
  ambiguous: [
    {
      query: "Gelişmeme yardım et",
      expectedCategories: ["Kişisel Gelişim", "Profesyonel Gelişim"],
      expectedKeywords: ["gelişim", "büyüme", "kişisel"],
      description: "Ambiguous growth request",
      priority: "low",
      allowMultipleCategories: true,
    },
    {
      query: "Gelişmem gerekiyor",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: ["gelişim", "iyileştirme"],
      description: "General improvement request",
      priority: "low",
      allowMultipleCategories: true,
    },
    {
      query: "Kariyer gelişimi",
      expectedCategories: ["Kariyer Gelişimi", "Profesyonel Gelişim"],
      expectedKeywords: ["kariyer", "profesyonel gelişim"],
      description: "Career development query",
      priority: "medium",
      allowMultipleCategories: true,
    },
    {
      query: "Problem çözme",
      expectedCategories: ["Kişisel Gelişim", "İletişim Becerileri"],
      expectedKeywords: ["çözüm", "problem"],
      description: "Problem solving skills",
      priority: "low",
      allowMultipleCategories: true,
    },
    {
      query: "gelişmek istiyorum",
      expectedCategories: ["Kişisel Gelişim"],
      expectedKeywords: ["gelişim", "kişisel"],
      description: "General development desire",
      priority: "low",
      allowMultipleCategories: true,
    },
    {
      query: "başarılı olmak",
      expectedCategories: ["Kişisel Gelişim", "Kariyer Gelişimi"],
      expectedKeywords: ["başarı", "gelişim"],
      description: "Success achievement",
      priority: "low",
      allowMultipleCategories: true,
    },
  ],

  // ===== EDGE CASES =====
  edgeCases: [
    // Length tests
    {
      query: "a",
      expectedError: "Query too short",
      description: "Single character query",
      priority: "high",
    },
    {
      query: "ab",
      expectedError: "Query too short",
      description: "Two character query",
      priority: "high",
    },
    {
      query: "",
      expectedError: "Query must be a non-empty string",
      description: "Empty query",
      priority: "high",
    },
    {
      query: "   ",
      expectedError: "Query must be a non-empty string",
      description: "Whitespace only query",
      priority: "high",
    },
    {
      query: "x".repeat(1000),
      expectedCategories: [],
      description: "Extremely long query (1000 chars)",
      priority: "medium",
      shouldTruncate: true,
    },
    // Special characters
    {
      query: "SQL !@#$%^&*()",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL"],
      description: "Query with special characters",
      priority: "low",
    },
    {
      query: "123456789",
      expectedCategories: [],
      description: "Numbers only query",
      priority: "low",
    },
    {
      query: "Çğıöşü öğrenme",
      expectedCategories: ["Öğrenme ve Eğitim"],
      expectedKeywords: ["öğrenme"],
      description: "Turkish characters query",
      priority: "medium",
    },
    // Nonsense queries
    {
      query: "xyzabc nonexistent fakeword",
      expectedCategories: [],
      description: "Nonsense words query",
      priority: "low",
      expectFallback: true,
    },
    {
      query: "qwertyuiop asdfghjkl",
      expectedCategories: [],
      description: "Keyboard mashing query",
      priority: "low",
      expectFallback: true,
    },
  ],

  // ===== SEMANTIC SIMILARITY TESTS =====
  semanticSimilarity: [
    {
      query: "veritabanı yönetimi",
      similarTo: "veritabanı yönetimi",
      expectedCategories: ["Teknik Eğitim"],
      description: "English-Turkish semantic similarity",
      priority: "medium",
    },
    {
      query: "zaman yönetimi",
      similarTo: "zaman yönetimi",
      expectedCategories: ["Verimlilik"],
      description: "Time management semantic similarity",
      priority: "medium",
    },
    {
      query: "etkin dinleme",
      similarTo: "etkin dinleme",
      expectedCategories: ["İletişim Becerileri"],
      description: "Active listening semantic similarity",
      priority: "medium",
    },
    {
      query: "iş görüşmesi",
      similarTo: "iş görüşmesi",
      expectedCategories: ["Kariyer Gelişimi"],
      description: "Job interview semantic similarity",
      priority: "medium",
    },
    {
      query: "meditasyon pratiği",
      similarTo: "meditasyon pratiği",
      expectedCategories: ["Kişisel Sağlık"],
      description: "Meditation semantic similarity",
      priority: "medium",
    },
  ],

  // ===== CONTEXT-AWARE QUERIES =====
  contextAware: [
    {
      query: "Takım iletişiminde zorlanıyorum",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["iletişim", "takım", "grup"],
      expectedAgents: ["Etkin Dinleme", "Geri Bildirim"],
      description: "Team communication challenge",
      priority: "high",
      context: "workplace",
    },
    {
      query: "Yöneticim gelecek hafta performansımı konuşmak istiyor",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["performans", "değerlendirme"],
      expectedAgents: ["Performans Değerlendirme Görüşmesine Hazırlan"],
      description: "Performance review preparation context",
      priority: "high",
      context: "performance review",
    },
    {
      query: "Yarın büyük bir sunumum var ve gerginm",
      expectedCategories: ["İletişim Becerileri", "Kişisel Sağlık"],
      expectedKeywords: ["sunum", "strес", "hazırlık"],
      description: "Presentation anxiety context",
      priority: "high",
      context: "presentation",
    },
    {
      query: "Gelecek ay yeni işe başlıyorum, nasıl hazırlanırım",
      expectedCategories: ["Kariyer Gelişimi", "Kişisel Gelişim"],
      expectedKeywords: ["yeni iş", "hazırlık", "başlangıç"],
      description: "New job preparation context",
      priority: "medium",
      context: "new job",
    },
    {
      query: "Çok fazla görevle bunalmış hissediyorum",
      expectedCategories: ["Verimlilik", "Kişisel Sağlık"],
      expectedKeywords: ["görev", "öncelik", "stres"],
      expectedAgents: [
        "Öncelikler Günlüğü ile günün 3 önceliğini belirle",
        "Meditasyon Yapma",
      ],
      description: "Task overload context",
      priority: "high",
      context: "overwhelm",
    },
  ],

  // ===== DOMAIN-SPECIFIC QUERIES =====
  domainSpecific: [
    // Technical domains
    {
      query: "veritabanı normalleştirme ilkeleri",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["veritabanı", "SQL"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Advanced database concepts",
      priority: "medium",
      domain: "database",
    },
    {
      query: "SQL JOIN işlemleri açıklaması",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "JOIN"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Specific SQL operation",
      priority: "high",
      domain: "database",
    },
    // Management domains
    {
      query: "takımlarda çatışma çözümü",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["çatışma", "takım", "çözüm"],
      description: "Team conflict management",
      priority: "medium",
      domain: "management",
    },
    {
      query: "yöneticiler için delegasyon stratejileri",
      expectedCategories: ["İletişim Becerileri", "Mentorluk"],
      expectedKeywords: ["delegasyon", "yönetim"],
      description: "Management delegation",
      priority: "medium",
      domain: "management",
    },
    // Sales domains
    {
      query: "itiraz yönetimi teknikleri",
      expectedCategories: ["Satış Eğitimi"],
      expectedKeywords: ["itiraz", "satış", "teknik"],
      expectedAgents: ["Satış Antrenörü - NAR Eğitim"],
      description: "Sales objection handling",
      priority: "high",
      domain: "sales",
    },
    {
      query: "anlaşmaları etkili şekilde kapatma",
      expectedCategories: ["Satış Eğitimi"],
      expectedKeywords: ["kapanış", "satış"],
      expectedAgents: ["Satış Antrenörü - NAR Eğitim"],
      description: "Sales closing techniques",
      priority: "high",
      domain: "sales",
    },
  ],

  // ===== PERFORMANCE TESTS =====
  performance: [
    {
      query:
        "Büyük ölçekli uygulamalar için SQL veritabanı yönetim sistemi optimizasyon teknikleri",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "veritabanı"],
      description: "Long technical query performance test",
      priority: "low",
      expectedMaxResponseTime: 1000,
    },
    {
      query: "a".repeat(100),
      expectedCategories: [],
      description: "Repeated character performance test",
      priority: "low",
      expectedMaxResponseTime: 500,
      expectFallback: true,
    },
  ],

  // ===== MULTI-INTENT QUERIES =====
  multiIntent: [
    {
      query:
        "SQL ile ilgili yardıma ihtiyacım var ve ayrıca iletişim becerilerimi geliştirmek istiyorum",
      expectedCategories: ["Teknik Eğitim", "İletişim Becerileri"],
      expectedKeywords: ["SQL", "iletişim"],
      expectedAgents: ["SQL Station: Orion", "Etkin Dinleme"],
      description: "Multiple intent query - technical and soft skills",
      priority: "medium",
      allowMultipleCategories: true,
    },
    {
      query: "Stres azaltma için zaman yönetimi ve meditasyon",
      expectedCategories: ["Verimlilik", "Kişisel Sağlık"],
      expectedKeywords: ["zaman yönetimi", "meditasyon"],
      expectedAgents: ["Zamanını & Enerjini Sen Yönet", "Meditasyon Yapma"],
      description: "Multiple intent - productivity and wellness",
      priority: "medium",
      allowMultipleCategories: true,
    },
    {
      query: "Mülakat hazırlığı ve performans değerlendirme ipuçları",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["mülakat", "performans"],
      expectedAgents: [
        "Mülakatlara Hazırlan",
        "Performans Değerlendirme Görüşmesine Hazırlan",
      ],
      description: "Multiple career-related intents",
      priority: "medium",
      allowMultipleCategories: true,
    },
  ],

  // ===== NEGATIVE CASES =====
  negativeCases: [
    {
      query: "Hiçbir şey öğrenmek istemiyorum",
      expectedCategories: [],
      description: "Negative learning intent",
      priority: "low",
      expectFallback: true,
    },
    {
      query: "Hiçbir şey bana yardım etmiyor",
      expectedCategories: [],
      description: "Negative help sentiment",
      priority: "low",
      expectFallback: true,
    },
    {
      query: "İşimden ve her şeyden nefret ediyorum",
      expectedCategories: ["Kişisel Sağlık", "Kariyer Gelişimi"],
      expectedKeywords: ["destek", "yardım"],
      description: "Negative job sentiment - should offer support",
      priority: "medium",
    },
  ],

  // ===== TYPO AND MISSPELLING TESTS =====
  typos: [
    {
      query: "SQL veritabanı yönetimi",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "veritabanı"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Common English typos",
      priority: "medium",
    },
    {
      query: "aktif dinlme becerileri",
      expectedCategories: ["İletişim Becerileri"],
      expectedKeywords: ["etkin dinleme"],
      expectedAgents: ["Etkin Dinleme"],
      description: "Turkish typos",
      priority: "medium",
    },
    {
      query: "performans degerlendirme",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["performans değerlendirme"],
      expectedAgents: ["Performans Değerlendirme Görüşmesine Hazırlan"],
      description: "Turkish character omission",
      priority: "medium",
    },
  ],

  // ===== INFORMAL LANGUAGE TESTS =====
  informal: [
    {
      query: "abi veritabanları ile yardım lazım",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["veritabanı", "SQL"],
      description: "Very informal English",
      priority: "low",
    },
    {
      query: "abi SQL öğrenmek istiyorum yaa",
      expectedCategories: ["Teknik Eğitim"],
      expectedKeywords: ["SQL", "öğrenme"],
      expectedAgents: ["SQL Station: Orion", "SQL Station: Vega"],
      description: "Very informal Turkish",
      priority: "low",
    },
    {
      query: "mülakata hazırlanıyom help plz",
      expectedCategories: ["Kariyer Gelişimi"],
      expectedKeywords: ["mülakat", "hazırlık"],
      expectedAgents: ["Mülakatlara Hazırlan"],
      description: "Mixed informal language",
      priority: "low",
    },
  ],
};

/**
 * Test configuration and validation rules
 */
const testConfig = {
  // Performance thresholds
  performance: {
    maxResponseTime: 2000, // 2 seconds max
    targetResponseTime: 500, // 500ms target
    minRelevanceScore: 0.3,
    targetRelevanceScore: 0.7,
  },

  // Quality thresholds
  quality: {
    minOverallScore: 0.6, // 60% minimum for passing
    highPriorityMinScore: 0.7, // 70% for high priority tests
    categoryMatchWeight: 0.4,
    keywordMatchWeight: 0.3,
    relevanceScoreWeight: 0.3,
  },

  // Test execution settings
  execution: {
    delayBetweenTests: 100, // ms
    maxRetries: 3,
    timeoutPerTest: 10000, // 10 seconds
    batchSize: 10, // Process tests in batches
  },

  // Fallback expectations
  fallback: {
    maxFallbackRate: 0.2, // 20% max fallback rate
    expectedFallbackQueries: [
      "nonsense queries",
      "single character queries",
      "number-only queries",
    ],
  },
};

/**
 * Expected agent mappings for quick validation
 */
const agentMappings = {
  SQL: ["SQL Station: Orion", "SQL Station: Vega"],
  veritabanı: ["SQL Station: Orion", "SQL Station: Vega"],
  "etkin dinleme": ["Etkin Dinleme"],
  "geri bildirim": ["Geri Bildirim"],
  mülakat: ["Mülakatlara Hazırlan"],
  performans: ["Performans Değerlendirme Görüşmesine Hazırlan"],
  öncelik: [
    "Öncelikler Günlüğü ile günün 3 önceliğini belirle",
    "Önceliklerimi Belirleme",
  ],
  "zaman yönetimi": ["Zamanını & Enerjini Sen Yönet"],
  meditasyon: ["Meditasyon Yapma"],
  alışkanlık: ["Kendin yaz"],
  kitap: ["Kitap Okuma"],
  satış: ["Satış Antrenörü - NAR Eğitim"],
  mentor: ["Mentorum ol"],
  not: [
    "Hafıza Dostu ile notlarını yaz, özetlemesi benden!",
    "YGA Zirvesi Notlarım",
  ],
  mutluluk: ["Harika Şeyler Günlüğü"],
  yıl: ["Yeni Yıl Yol Haritası"],
  gelişim: [
    "Gelişimime Zaman Ayırma",
    "Her gün UP ile konuş",
    "Growth Mindset Ön Hazırlık",
  ],
};

/**
 * Test result analysis functions
 */
const testAnalysis = {
  /**
   * Analyze semantic similarity between queries
   */
  semanticSimilarity: (query1, query2) => {
    // Simple word overlap analysis (can be enhanced with actual embedding similarity)
    const words1 = query1.toLowerCase().split(/\s+/);
    const words2 = query2.toLowerCase().split(/\s+/);
    const intersection = words1.filter((word) => words2.includes(word));
    return intersection.length / Math.max(words1.length, words2.length);
  },

  /**
   * Validate agent recommendation relevance
   */
  validateRelevance: (query, recommendations, scenario) => {
    const validation = {
      categoryMatch: false,
      keywordMatch: false,
      agentMatch: false,
      semanticRelevance: 0,
    };

    if (
      !recommendations.recommendations ||
      recommendations.recommendations.length === 0
    ) {
      return validation;
    }

    // Check category matching
    if (scenario.expectedCategories) {
      const foundCategories = recommendations.recommendations.map(
        (r) => r.category
      );
      validation.categoryMatch = scenario.expectedCategories.some((cat) =>
        foundCategories.some(
          (found) => found.includes(cat) || cat.includes(found)
        )
      );
    }

    // Check keyword matching
    if (scenario.expectedKeywords) {
      const allFoundKeywords = recommendations.recommendations.flatMap(
        (r) => r.keywords || []
      );
      validation.keywordMatch = scenario.expectedKeywords.some((keyword) =>
        allFoundKeywords.some(
          (found) =>
            found.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(found.toLowerCase())
        )
      );
    }

    // Check specific agent matching
    if (scenario.expectedAgents) {
      const foundAgents = recommendations.recommendations.map((r) => r.name);
      validation.agentMatch = scenario.expectedAgents.some((agent) =>
        foundAgents.includes(agent)
      );
    }

    // Calculate semantic relevance (simplified)
    const queryWords = query.toLowerCase().split(/\s+/);
    const recWords = recommendations.recommendations.flatMap((r) =>
      [r.name, r.description, ...(r.keywords || [])]
        .join(" ")
        .toLowerCase()
        .split(/\s+/)
    );
    const commonWords = queryWords.filter((word) => recWords.includes(word));
    validation.semanticRelevance = commonWords.length / queryWords.length;

    return validation;
  },

  /**
   * Generate detailed performance metrics
   */
  performanceMetrics: (testResults) => {
    const metrics = {
      responseTime: {
        avg: 0,
        min: Infinity,
        max: 0,
        p95: 0,
      },
      relevanceScore: {
        avg: 0,
        min: 1,
        max: 0,
      },
      categoryAccuracy: 0,
      keywordAccuracy: 0,
      fallbackRate: 0,
    };

    const responseTimes = [];
    const relevanceScores = [];
    let categoryMatches = 0;
    let keywordMatches = 0;
    let fallbackCount = 0;

    testResults.forEach((result) => {
      if (result.analysisResults.responseTime > 0) {
        responseTimes.push(result.analysisResults.responseTime);
      }
      if (result.analysisResults.relevanceScore > 0) {
        relevanceScores.push(result.analysisResults.relevanceScore);
      }
      if (result.analysisResults.categoryMatch > 0.5) {
        categoryMatches++;
      }
      if (result.analysisResults.keywordMatch > 0.5) {
        keywordMatches++;
      }
      if (result.recommendations.isFallback) {
        fallbackCount++;
      }
    });

    if (responseTimes.length > 0) {
      metrics.responseTime.avg =
        responseTimes.reduce((a, b) => a + b) / responseTimes.length;
      metrics.responseTime.min = Math.min(...responseTimes);
      metrics.responseTime.max = Math.max(...responseTimes);
      responseTimes.sort((a, b) => a - b);
      metrics.responseTime.p95 =
        responseTimes[Math.floor(responseTimes.length * 0.95)];
    }

    if (relevanceScores.length > 0) {
      metrics.relevanceScore.avg =
        relevanceScores.reduce((a, b) => a + b) / relevanceScores.length;
      metrics.relevanceScore.min = Math.min(...relevanceScores);
      metrics.relevanceScore.max = Math.max(...relevanceScores);
    }

    metrics.categoryAccuracy = categoryMatches / testResults.length;
    metrics.keywordAccuracy = keywordMatches / testResults.length;
    metrics.fallbackRate = fallbackCount / testResults.length;

    return metrics;
  },
};

/**
 * Logger utility for detailed test execution tracking
 */
class TestLogger {
  constructor() {
    this.logs = [];
    this.testCaseResults = [];
    this.startTime = null;
    this.testSession = {
      sessionId: this.generateSessionId(),
      startTime: new Date().toISOString(),
      environment: process.env.STAGE || 'myenv',
      totalTests: 0,
      completedTests: 0,
      passedTests: 0,
      failedTests: 0,
      errors: [],
      warnings: [],
      categories: {},
      keywords: {},
      agents: {},
      performance: {
        totalTime: 0,
        avgResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        slowQueries: [],
        fastQueries: []
      }
    };
  }

  generateSessionId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `test-session-${timestamp}-${random}`;
  }

  log(level, message, data = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : null,
      sessionId: this.testSession.sessionId
    };
    
    this.logs.push(logEntry);
    
    // Console output with colors
    const colors = {
      INFO: '\x1b[36m',    // Cyan
      SUCCESS: '\x1b[32m', // Green
      WARNING: '\x1b[33m', // Yellow
      ERROR: '\x1b[31m',   // Red
      DEBUG: '\x1b[90m',   // Gray
      RESET: '\x1b[0m'
    };
    
    const color = colors[level.toUpperCase()] || colors.INFO;
    const timestamp = new Date().toLocaleTimeString();
    
    console.log(`${color}[${timestamp}] ${level.toUpperCase()}: ${message}${colors.RESET}`);
    
    if (data && level.toUpperCase() === 'DEBUG') {
      console.log(`${colors.DEBUG}${JSON.stringify(data, null, 2)}${colors.RESET}`);
    }
  }

  info(message, data = null) { this.log('info', message, data); }
  success(message, data = null) { this.log('success', message, data); }
  warning(message, data = null) { this.log('warning', message, data); }
  error(message, data = null) { this.log('error', message, data); }
  debug(message, data = null) { this.log('debug', message, data); }

  startTest(scenarioName, testIndex, totalTests) {
    this.testSession.totalTests = totalTests;
    this.info(`🚀 Starting test ${testIndex + 1}/${totalTests}: ${scenarioName}`);
  }

  endTest(scenarioName, testResult) {
    this.testSession.completedTests++;
    
    // Add simplified test case result to testCaseResults
    const simplifiedResult = {
      query: testResult.query,
      expected: {
        categories: testResult.expected.categories || [],
        keywords: testResult.expected.keywords || [],
        agents: testResult.expected.agents || []
      },
      actual: {
        categories: testResult.actual.categories || [],
        keywords: testResult.actual.keywords || [],
        agents: testResult.actual.agents || [],
        bestScore: testResult.bestScore || 0
      },
      passed: testResult.passed,
      overallScore: testResult.overallScore || 0,
      scenario: scenarioName
    };
    
    this.testCaseResults.push(simplifiedResult);
    
    if (testResult.passed) {
      this.testSession.passedTests++;
      this.success(`✅ Test passed: ${scenarioName}`, {
        score: testResult.overallScore?.toFixed(1) || 'N/A',
        similarity: testResult.bestScore,
        responseTime: testResult.responseTime
      });
    } else {
      this.testSession.failedTests++;
      this.error(`❌ Test failed: ${scenarioName}`, {
        score: testResult.overallScore?.toFixed(1) || 'N/A',
        reason: testResult.failureReason,
        expected: testResult.expected,
        actual: testResult.actual
      });
    }

    // Track performance metrics
    if (testResult.responseTime) {
      this.testSession.performance.totalTime += testResult.responseTime;
      this.testSession.performance.minResponseTime = Math.min(
        this.testSession.performance.minResponseTime, 
        testResult.responseTime
      );
      this.testSession.performance.maxResponseTime = Math.max(
        this.testSession.performance.maxResponseTime, 
        testResult.responseTime
      );

      if (testResult.responseTime > 1000) {
        this.testSession.performance.slowQueries.push({
          query: testResult.query,
          responseTime: testResult.responseTime,
          scenario: scenarioName
        });
      } else if (testResult.responseTime < 300) {
        this.testSession.performance.fastQueries.push({
          query: testResult.query,
          responseTime: testResult.responseTime,
          scenario: scenarioName
        });
      }
    }

    // Track category/keyword/agent statistics
    if (testResult.recommendations?.recommendations) {
      testResult.recommendations.recommendations.forEach(rec => {
        this.testSession.categories[rec.category] = (this.testSession.categories[rec.category] || 0) + 1;
        this.testSession.agents[rec.name] = (this.testSession.agents[rec.name] || 0) + 1;
        if (rec.keywords) {
          rec.keywords.forEach(keyword => {
            this.testSession.keywords[keyword] = (this.testSession.keywords[keyword] || 0) + 1;
          });
        }
      });
    }
  }

  addError(error, context = null) {
    this.testSession.errors.push({
      timestamp: new Date().toISOString(),
      error: error.message || String(error),
      stack: error.stack,
      context
    });
    this.error('Test execution error', { error: error.message, context });
  }

  addWarning(message, context = null) {
    this.testSession.warnings.push({
      timestamp: new Date().toISOString(),
      message,
      context
    });
    this.warning(message, context);
  }

  async finalize() {
    this.testSession.endTime = new Date().toISOString();
    this.testSession.duration = Date.now() - new Date(this.testSession.startTime).getTime();
    
    if (this.testSession.completedTests > 0) {
      this.testSession.performance.avgResponseTime = 
        this.testSession.performance.totalTime / this.testSession.completedTests;
    }

    this.testSession.successRate = this.testSession.passedTests / this.testSession.completedTests;
    
    // Generate comprehensive summary
    this.info('📊 Test Session Summary', {
      sessionId: this.testSession.sessionId,
      duration: `${Math.round(this.testSession.duration / 1000)}s`,
      tests: `${this.testSession.passedTests}/${this.testSession.completedTests} passed`,
      successRate: `${Math.round(this.testSession.successRate * 100)}%`,
      avgResponseTime: `${Math.round(this.testSession.performance.avgResponseTime)}ms`,
      errors: this.testSession.errors.length,
      warnings: this.testSession.warnings.length
    });

    // Save detailed results to JSON
    await this.saveResults();
  }

  async saveResults() {
    try {
      // Ensure logs directory exists
      const logsDir = path.join(process.cwd(), 'logs');
      await fs.mkdir(logsDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Save comprehensive test session data
      const sessionFile = path.join(logsDir, `test-session-${timestamp}.json`);
      const sessionData = {
        ...this.testSession,
        topCategories: Object.entries(this.testSession.categories)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10),
        topAgents: Object.entries(this.testSession.agents)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10),
        topKeywords: Object.entries(this.testSession.keywords)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 20)
      };

      await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');
      this.success(`💾 Test session saved: ${sessionFile}`);

      // Save simplified test case results (query, expected, actual only)
      const testCaseResults = this.testCaseResults || [];
      const logsFile = path.join(logsDir, `test-logs-${timestamp}.json`);
      await fs.writeFile(logsFile, JSON.stringify(testCaseResults, null, 2), 'utf8');
      this.success(`📝 Test case logs saved: ${logsFile}`);

      // Save performance summary
      const performanceFile = path.join(logsDir, `test-performance-${timestamp}.json`);
      const performanceData = {
        sessionId: this.testSession.sessionId,
        timestamp,
        performance: this.testSession.performance,
        slowQueries: this.testSession.performance.slowQueries,
        fastQueries: this.testSession.performance.fastQueries,
        categoryDistribution: this.testSession.categories,
        agentUsage: this.testSession.agents,
        keywordFrequency: this.testSession.keywords
      };
      
      await fs.writeFile(performanceFile, JSON.stringify(performanceData, null, 2), 'utf8');
      this.success(`⚡ Performance data saved: ${performanceFile}`);

      return {
        sessionFile,
        logsFile,
        performanceFile
      };

    } catch (error) {
      this.error('Failed to save test results', { error: error.message });
      throw error;
    }
  }
}

/**
 * Enhanced Test Runner with comprehensive logging and validation
 */
class AgentRecommendationTestRunner {
  constructor(stage = process.env.STAGE || 'myenv') {
    this.stage = stage;
    this.service = new AgentRecommendationService(stage);
    this.logger = new TestLogger();
    this.results = [];
  }

  async runSingleTest(scenario, scenarioName, testIndex, totalTests) {
    this.logger.startTest(scenarioName, testIndex, totalTests);
    
    const testResult = {
      scenario: scenarioName,
      query: scenario.query,
      description: scenario.description,
      priority: scenario.priority,
      timestamp: new Date().toISOString(),
      passed: false,
      failureReason: null,
      expected: {
        categories: scenario.expectedCategories,
        keywords: scenario.expectedKeywords,
        agents: scenario.expectedAgents
      },
      actual: {
        categories: [],
        keywords: [],
        agents: []
      },
      recommendations: null,
      responseTime: 0,
      bestScore: 0,
      errors: []
    };

    try {
      const startTime = Date.now();
      
      // Test for expected errors first
      if (scenario.expectedError) {
        try {
          await this.service.getRecommendations(scenario.query);
          testResult.failureReason = `Expected error '${scenario.expectedError}' but request succeeded`;
        } catch (error) {
          if (error.message.includes(scenario.expectedError)) {
            testResult.passed = true;
            this.logger.debug('Expected error caught correctly', { error: error.message });
          } else {
            testResult.failureReason = `Expected '${scenario.expectedError}' but got '${error.message}'`;
          }
        }
      } else {
        // Normal recommendation test
        testResult.recommendations = await this.service.getRecommendations(scenario.query);
        testResult.responseTime = Date.now() - startTime;

        if (testResult.recommendations?.recommendations?.length > 0) {
          // Extract actual results
          testResult.actual.categories = [...new Set(
            testResult.recommendations.recommendations.map(r => r.category)
          )];
          testResult.actual.keywords = [...new Set(
            testResult.recommendations.recommendations.flatMap(r => r.keywords || [])
          )];
          testResult.actual.agents = testResult.recommendations.recommendations.map(r => r.name);
          testResult.bestScore = Math.max(...testResult.recommendations.recommendations.map(r => r.relevanceScore));

          // Validate results
          testResult.passed = this.validateTestResult(scenario, testResult);
          
          if (!testResult.passed && !testResult.failureReason) {
            testResult.failureReason = this.generateFailureReason(scenario, testResult);
          }

        } else if (scenario.expectFallback) {
          testResult.passed = testResult.recommendations.isFallback === true;
          if (!testResult.passed) {
            testResult.failureReason = 'Expected fallback mode but got regular results';
          }
        } else {
          testResult.passed = false;
          testResult.failureReason = 'No recommendations returned';
        }
      }

      // Log performance warnings
      if (testResult.responseTime > 2000) {
        this.logger.addWarning(`Slow response time: ${testResult.responseTime}ms`, {
          query: scenario.query,
          threshold: '2000ms'
        });
      }

      if (testResult.bestScore < 0.5 && !scenario.expectFallback) {
        this.logger.addWarning(`Low similarity score: ${testResult.bestScore.toFixed(3)}`, {
          query: scenario.query,
          threshold: '0.5'
        });
      }

    } catch (error) {
      testResult.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      testResult.failureReason = `Test execution error: ${error.message}`;
      this.logger.addError(error, { scenario: scenarioName, query: scenario.query });
    }

    this.logger.endTest(scenarioName, testResult);
    this.results.push(testResult);
    
    return testResult;
  }

  validateTestResult(scenario, testResult) {
    let overallScore = 0;

    // Agent validation (most important - 60% weight)
    let agentScore = 0;
    if (scenario.expectedAgents?.length > 0) {
      const agentMatch = scenario.expectedAgents.some(expectedAgent =>
        testResult.actual.agents.some(actualAgent =>
          actualAgent.toLowerCase().includes(expectedAgent.toLowerCase()) ||
          expectedAgent.toLowerCase().includes(actualAgent.toLowerCase())
        )
      );
      if (agentMatch) agentScore = 6; // 6 points out of 10 for agent match
    }

    // Keyword validation (30% weight)
    let keywordScore = 0;
    if (scenario.expectedKeywords?.length > 0) {
      const keywordMatch = scenario.expectedKeywords.some(expectedKeyword =>
        testResult.actual.keywords.some(actualKeyword =>
          actualKeyword.toLowerCase().includes(expectedKeyword.toLowerCase()) ||
          expectedKeyword.toLowerCase().includes(actualKeyword.toLowerCase())
        )
      );
      if (keywordMatch) keywordScore = 3; // 3 points out of 10 for keyword match
    }

    // Category validation (10% weight)
    let categoryScore = 0;
    if (scenario.expectedCategories?.length > 0) {
      const categoryMatch = scenario.expectedCategories.some(expectedCat =>
        testResult.actual.categories.some(actualCat =>
          actualCat.toLowerCase().includes(expectedCat.toLowerCase()) ||
          expectedCat.toLowerCase().includes(actualCat.toLowerCase())
        )
      );
      if (categoryMatch) categoryScore = 1; // 1 point out of 10 for category match
    }

    overallScore = agentScore + keywordScore + categoryScore;

    // Store the overall score for logging
    testResult.overallScore = overallScore;

    // Pass if score > 5 out of 10
    const passed = overallScore > 5;

    // For fallback scenarios, just check if fallback was expected
    if (scenario.expectFallback) {
      return testResult.recommendations?.isFallback === true;
    }

    return passed;
  }

  generateFailureReason(scenario, testResult) {
    const score = testResult.overallScore || 0;
    const reasons = [`Overall score: ${score}/10 (need >5 to pass)`];

    if (scenario.expectedAgents?.length > 0) {
      const foundAgents = testResult.actual.agents.slice(0, 3).join(', ');
      const expectedAgents = scenario.expectedAgents.join(', ');
      const agentMatch = scenario.expectedAgents.some(expectedAgent =>
        testResult.actual.agents.some(actualAgent =>
          actualAgent.toLowerCase().includes(expectedAgent.toLowerCase()) ||
          expectedAgent.toLowerCase().includes(actualAgent.toLowerCase())
        )
      );
      if (!agentMatch) {
        reasons.push(`No expected agents found - Expected: [${expectedAgents}], Got: [${foundAgents}]`);
      }
    }

    if (scenario.expectedKeywords?.length > 0) {
      const foundKeywords = testResult.actual.keywords.slice(0, 5).join(', ');
      const expectedKeywords = scenario.expectedKeywords.join(', ');
      const keywordMatch = scenario.expectedKeywords.some(expectedKeyword =>
        testResult.actual.keywords.some(actualKeyword =>
          actualKeyword.toLowerCase().includes(expectedKeyword.toLowerCase()) ||
          expectedKeyword.toLowerCase().includes(actualKeyword.toLowerCase())
        )
      );
      if (!keywordMatch) {
        reasons.push(`No expected keywords found - Expected: [${expectedKeywords}], Got: [${foundKeywords}]`);
      }
    }

    return reasons.join('; ');
  }

  async runAllTests(selectedCategories = null, maxTests = null) {
    this.logger.info('🎯 Starting Agent Recommendation Test Suite', {
      environment: this.stage,
      selectedCategories: selectedCategories || 'all',
      maxTests: maxTests || 'unlimited'
    });

    let allTests = [];
    
    // Collect all tests from selected categories
    for (const [categoryName, tests] of Object.entries(enhancedTestScenarios)) {
      if (!selectedCategories || selectedCategories.includes(categoryName)) {
        tests.forEach((test, index) => {
          allTests.push({
            test,
            scenarioName: `${categoryName}[${index}]: ${test.description || test.query.substring(0, 50)}`,
            categoryName
          });
        });
      }
    }

    // Limit tests if specified
    if (maxTests && maxTests > 0) {
      allTests = allTests.slice(0, maxTests);
    }

    this.logger.info(`📊 Running ${allTests.length} tests across ${Object.keys(enhancedTestScenarios).length} categories`);

    // Execute tests with delay
    for (let i = 0; i < allTests.length; i++) {
      const { test, scenarioName } = allTests[i];
      
      await this.runSingleTest(test, scenarioName, i, allTests.length);
      
      // Small delay between tests to avoid overwhelming the system
      if (i < allTests.length - 1) {
        await new Promise(resolve => setTimeout(resolve, testConfig.execution.delayBetweenTests));
      }
    }

    // Generate final summary
    await this.generateSummary();
    await this.logger.finalize();

    return this.results;
  }

  async generateSummary() {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    const successRate = total > 0 ? (passed / total) * 100 : 0;

    const avgResponseTime = this.results.reduce((sum, r) => sum + (r.responseTime || 0), 0) / total;
    const slowTests = this.results.filter(r => r.responseTime > 1000);
    const highScoreTests = this.results.filter(r => r.bestScore > 0.8);
    const lowScoreTests = this.results.filter(r => r.bestScore < 0.5 && !r.scenario.includes('fallback'));

    this.logger.info('📈 Test Execution Summary', {
      total,
      passed,
      failed,
      successRate: `${successRate.toFixed(1)}%`,
      avgResponseTime: `${avgResponseTime.toFixed(0)}ms`,
      slowTests: slowTests.length,
      highScoreTests: highScoreTests.length,
      lowScoreTests: lowScoreTests.length
    });

    // Category-wise results
    const categoryResults = {};
    this.results.forEach(result => {
      const category = result.scenario.split('[')[0];
      if (!categoryResults[category]) {
        categoryResults[category] = { total: 0, passed: 0 };
      }
      categoryResults[category].total++;
      if (result.passed) categoryResults[category].passed++;
    });

    this.logger.info('📊 Category-wise Results', categoryResults);

    // Priority-wise results
    const priorityResults = {};
    this.results.forEach(result => {
      const priority = result.priority || 'medium';
      if (!priorityResults[priority]) {
        priorityResults[priority] = { total: 0, passed: 0 };
      }
      priorityResults[priority].total++;
      if (result.passed) priorityResults[priority].passed++;
    });

    this.logger.info('⭐ Priority-wise Results', priorityResults);

    if (lowScoreTests.length > 0) {
      this.logger.warning(`⚠️ ${lowScoreTests.length} tests had low similarity scores`, {
        examples: lowScoreTests.slice(0, 3).map(t => ({
          query: t.query,
          score: t.bestScore.toFixed(3)
        }))
      });
    }

    if (slowTests.length > 0) {
      this.logger.warning(`🐌 ${slowTests.length} tests were slow (>1000ms)`, {
        examples: slowTests.slice(0, 3).map(t => ({
          query: t.query,
          responseTime: `${t.responseTime}ms`
        }))
      });
    }
  }
}

/**
 * CLI Test Execution Functions
 */
async function runTests(options = {}) {
  const {
    categories = null,
    maxTests = null,
    stage = process.env.STAGE || 'myenv'
  } = options;

  const runner = new AgentRecommendationTestRunner(stage);
  
  try {
    const results = await runner.runAllTests(categories, maxTests);
    
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const successRate = (passed / total) * 100;
    
    console.log(`\n🎉 Test Suite Completed!`);
    console.log(`📊 Results: ${passed}/${total} tests passed (${successRate.toFixed(1)}%)`);
    
    if (successRate >= 80) {
      console.log(`✅ SUCCESS: Test suite passed with ${successRate.toFixed(1)}% success rate`);
      process.exit(0);
    } else if (successRate >= 60) {
      console.log(`⚠️ WARNING: Test suite passed but with low success rate ${successRate.toFixed(1)}%`);
      process.exit(0);
    } else {
      console.log(`❌ FAILURE: Test suite failed with ${successRate.toFixed(1)}% success rate`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('💥 Test suite execution failed:', error.message);
    process.exit(1);
  }
}

// Quick test functions for specific scenarios
async function runQuickTest(query, stage = process.env.STAGE || 'myenv') {
  const service = new AgentRecommendationService(stage);
  const logger = new TestLogger();
  
  logger.info('🚀 Running quick test', { query, stage });
  
  try {
    const startTime = Date.now();
    const result = await service.getRecommendations(query);
    const responseTime = Date.now() - startTime;
    
    logger.success('✅ Quick test completed', {
      query,
      responseTime: `${responseTime}ms`,
      recommendations: result.recommendations?.length || 0,
      bestScore: result.recommendations?.length > 0 ? 
        Math.max(...result.recommendations.map(r => r.relevanceScore)).toFixed(3) : 'N/A'
    });
    
    // Save quick test result
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logsDir = path.join(process.cwd(), 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    
    const quickTestFile = path.join(logsDir, `quick-test-${timestamp}.json`);
    await fs.writeFile(quickTestFile, JSON.stringify({
      type: 'quick-test',
      timestamp,
      query,
      stage,
      responseTime,
      result
    }, null, 2), 'utf8');
    
    logger.success(`💾 Quick test result saved: ${quickTestFile}`);
    
    return result;
    
  } catch (error) {
    logger.error('❌ Quick test failed', { error: error.message });
    throw error;
  }
}

export { 
  enhancedTestScenarios, 
  testConfig, 
  agentMappings, 
  testAnalysis,
  TestLogger,
  AgentRecommendationTestRunner,
  runTests,
  runQuickTest
};
