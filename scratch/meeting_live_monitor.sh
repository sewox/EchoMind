#!/bin/bash
echo "📡 EchoMind Canlı Toplantı Algılama & Log Dinleyici Başlatıldı..."
echo "Toplantı açıldığında sistem anlık çıktı verecektir. (Çıkış için Ctrl+C)"
echo "---------------------------------------------------------"

while true; do
  DATE=$(date +"%H:%M:%S")
  
  # Chrome tab query
  CHROME_TABS=$(osascript -e '
    tell application "Google Chrome"
      if running then
        get {title, URL} of tabs of every window
      end if
    end tell' 2>/dev/null)

  # Check if Meet is present
  if [[ "$CHROME_TABS" == *"meet.google.com"* || "$CHROME_TABS" == *"Meet"* || "$CHROME_TABS" == *"meet"* ]]; then
    # Get Window Bounds
    BOUNDS=$(osascript -e '
      tell application "Google Chrome"
        if running then
          repeat with w in windows
            set wBounds to bounds of w
            repeat with t in tabs of w
              if (URL of t contains "meet.google.com") or (title of t contains "Meet") or (title of t contains "meet") then
                return wBounds
              end if
            end repeat
          end repeat
        end if
      end tell' 2>/dev/null)
      
    echo "[$DATE] 🎯 TOPLANTI TESPİT EDİLDİ!"
    echo "       Tarayıcı: Google Chrome"
    echo "       Pencere Koordinatları: $BOUNDS"
    echo "       Sekme Verisi: $CHROME_TABS"
  fi

  sleep 1.5
done
