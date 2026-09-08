/**
 * Core Notification, Sound & Vibration dispatcher
 */

export function playChimeSound() {
  // 1. Web Audio API Synthesis
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Primary tone
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.15);
      gain1.gain.setValueAtTime(0.7, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.45);

      // Harmony tone
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1320, now + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.35);
      gain2.gain.setValueAtTime(0.6, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.6);
    }
  } catch {
    // Ignore
  }

  // 2. Audio Element fallback
  try {
    const audio = new Audio("/notification.wav");
    audio.volume = 1.0;
    audio.play().catch(() => {});
  } catch {
    // Ignore
  }
}

export async function triggerAlert(
  title: string,
  body: string,
  conversationId?: string
) {
  // Sound
  playChimeSound();

  // Vibration
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate([400, 200, 400]);
    } catch {
      // Ignore
    }
  }

  // OS Notification
  if (
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    const options = {
      body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      vibrate: [400, 200, 400],
      tag: `msg-${Date.now()}-${Math.random()}`, // Unique tag ensures every message sounds and vibrates
      renotify: true,
      data: {
        conversationId,
        url: "/inbox",
      },
    };

    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && "showNotification" in reg) {
          await (
            reg.showNotification as (
              t: string,
              o?: unknown
            ) => Promise<void>
          )(title, options);
          return;
        }
      }
    } catch {
      // Fallback
    }

    try {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        window.location.href = "/inbox";
        n.close();
      };
    } catch {
      // Ignore
    }
  }
}
