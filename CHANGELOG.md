# Changelog

## v0.2.0 - 2026-11-23
Şarkı sözleri, beğen / listeye ekle, katlanan liste ve hazır Windows (exe) sürümü.

### Added
- Hazır Windows paketi (`SpotifyVisualizer-win32-x64.zip`): Node.js gerekmeden çalışır
- Visualizer'da senkron şarkı sözleri, "sadece sözler" modu, şeffaf arka plan, glow ayarı
- Oynatıcıda ♥ beğen ve + çalma listesine ekle (alfabetik, kaydırmalı menü)
- Listeyi origami yaprakları gibi katlayıp açan buton, hız ayarı
- Diske sağ tık menüsü: visualizer, sözler, animasyon seçimi
- Ayarlarda: tıklayınca küçülmeyi aç/kapat, animasyon önizlemesi, açık/kapalı göstergeleri
- Sağ kenara dock'ta düzen aynalanır (liste ve oynatıcı sola geçer)

### Changed
- Spotify'da aktif oturum yokken kart "SON ÇALAN" der
- Listeden şarkı seçince aradaki şarkılar duyulmaz

### Fixed
- Diske tıklayınca yanlış şarkı çalması, disk taşınamaması
- Oynatıcı ile disk arasındaki boşlukta dock'a geri kaçma

## v0.1.0 - 2026-11-21
İlk sürüm: Spotify için dönen disk widget'ı, yaprak liste, oynatıcı, dock ve tam ekran visualizer.

### Added
- Dönen kapak diski, kapak rengine göre glow, mini mod ve serbest sürükleme
- Çiçek yaprağı şeklinde şarkı listesi (tıklayınca geç, orta tuşla kaydır)
- Seek bar, karıştır/tekrar ve dikey ses barı olan glass oynatıcı
- Sol/sağ kenara dock (sağda aynalı düzen), çoklu monitör desteği
- Tam ekran arka plan visualizer: 4 animasyon, otomatik geçiş, açılış animasyonu, pencerelerin arkasında açılıyor
- Tepsi simgesi ve kalıcı ayarlar penceresi
