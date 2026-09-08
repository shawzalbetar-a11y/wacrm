"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

// Shared AudioContext and Audio Element to bypass mobile autoplay policy
let sharedAudioCtx: AudioContext | null = null;
let primedAudioEl: HTMLAudioElement | null = null;

function getOrUnlockAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Plays a loud, pleasant chime with Web Audio API + HTMLAudio fallback
 */
function playChimeSound() {
  // 1. Play primed HTMLAudioElement
  try {
    if (primedAudioEl) {
      primedAudioEl.currentTime = 0;
      primedAudioEl.play().catch(() => {});
    } else {
      const audio = new Audio("/notification.wav");
      audio.volume = 1.0;
      audio.play().catch(() => {});
    }
  } catch {
    // Ignore
  }

  // 2. Play Web Audio API Oscillator
  try {
    const ctx = getOrUnlockAudioContext();
    if (ctx) {
      const playTone = () => {
        const now = ctx.currentTime;

        // Primary tone
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(880, now); // A5
        osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.15); // D6
        gain1.gain.setValueAtTime(0.6, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.45);

        // Harmony tone
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1320, now + 0.12); // E6
        osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.35); // A6
        gain2.gain.setValueAtTime(0.5, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.6);
      };

      if (ctx.state === "suspended") {
        ctx.resume().then(playTone).catch(() => {});
      } else {
        playTone();
      }
    }
  } catch (e) {
    console.warn("[pwa] WebAudio chime error:", e);
  }
}

/**
 * Dispatches native OS / Android PWA notification via Service Worker
 */
type ExtendedNotificationOptions = NotificationOptions & {
  vibrate?: number[];
  renotify?: boolean;
};

async function showNativeNotification(
  title: string,
  options: ExtendedNotificationOptions,
  router: ReturnType<typeof useRouter>
) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    // Standard way on Android Chrome & PWA
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
  } catch (err) {
    console.warn("[pwa] SW showNotification error:", err);
  }

  // Fallback for Desktop browsers without active SW
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      router.push("/inbox");
      n.close();
    };
  } catch (err) {
    console.warn("[pwa] Fallback Notification error:", err);
  }
}

export function PwaNotificationManager() {
  const router = useRouter();
  const lastAlertTimeRef = useRef<number>(0);

  useEffect(() => {
    // 1. Prime AudioContext and Audio Element on any user interaction
    const unlockAudio = () => {
      getOrUnlockAudioContext();
      if (!primedAudioEl && typeof window !== "undefined") {
        try {
          primedAudioEl = new Audio("/notification.wav");
          primedAudioEl.volume = 1.0;
          // Play and immediately pause to authorize subsequent plays
          primedAudioEl
            .play()
            .then(() => {
              if (primedAudioEl) {
                primedAudioEl.pause();
                primedAudioEl.currentTime = 0;
              }
            })
            .catch(() => {});
        } catch {
          // Ignore
        }
      }
    };

    window.addEventListener("click", unlockAudio, { passive: true });
    window.addEventListener("touchstart", unlockAudio, { passive: true });

    // 2. Register Service Worker for PWA
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch((err) => {
          console.warn("[pwa] ServiceWorker registration failed:", err);
        });
    }

    // 3. Request Notification permission
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }

    // Helper to trigger notification
    const triggerInboundAlert = (previewText: string, conversationId?: string) => {
      const now = Date.now();
      if (now - lastAlertTimeRef.current < 1000) {
        return; // Deduplicate within 1 second
      }
      lastAlertTimeRef.current = now;

      // Play Sound
      playChimeSound();

      // Trigger Vibration on Android
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([300, 150, 300]);
      }

      const title = "رسالة واتساب جديدة 💬";

      // Show interactive in-app Toast
      toast.info(title, {
        description: previewText,
        duration: 7000,
        action: {
          label: "فتح المحادثة",
          onClick: () => {
            router.push("/inbox");
          },
        },
      });

      // Show Native Android / PWA Notification with renotify: true
      showNativeNotification(
        title,
        {
          body: previewText,
          icon: "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
          vibrate: [300, 150, 300],
          tag: `wa-${conversationId || Date.now()}`,
          renotify: true, // CRITICAL: forces Android to vibrate & sound even if a previous notification is present
          data: {
            conversationId,
            url: "/inbox",
          },
        },
        router
      );
    };

    // 4. Supabase Realtime Listeners with auto-reconnection
    const supabase = createClient();
    let channel = supabase.channel(`pwa-realtime-${Date.now()}`);

    const setupSubscriptions = () => {
      channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            const newMsg = payload.new as {
              id: string;
              conversation_id: string;
              sender_type: string;
              content_text?: string;
              content_type?: string;
            };

            if (!newMsg || newMsg.sender_type !== "customer") return;

            const preview =
              newMsg.content_text ||
              (newMsg.content_type === "image"
                ? "📷 صورة جديدة"
                : newMsg.content_type === "audio"
                  ? "🎙️ رسالة صوتية جديدة"
                  : newMsg.content_type === "video"
                    ? "🎥 مقطع فيديو جديد"
                    : newMsg.content_type === "document"
                      ? "📄 مستند جديد"
                      : "💬 رسالة واردة جديدة");

            triggerInboundAlert(preview, newMsg.conversation_id);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "conversations",
          },
          (payload) => {
            const newConv = payload.new as {
              id: string;
              unread_count?: number;
              last_message_text?: string;
            };
            const oldConv = payload.old as Partial<{
              unread_count?: number;
            }>;

            if (
              newConv &&
              (newConv.unread_count ?? 0) > (oldConv?.unread_count ?? 0)
            ) {
              triggerInboundAlert(
                newConv.last_message_text || "💬 رسالة واتساب جديدة",
                newConv.id
              );
            }
          }
        )
        .subscribe((status) => {
          if (status === "TIMED_OUT" || status === "CLOSED") {
            // Re-subscribe if connection drops
            setTimeout(() => {
              channel.subscribe();
            }, 1500);
          }
        });
    };

    setupSubscriptions();

    // Re-sync when user returns to the app / unlocks phone
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        getOrUnlockAudioContext();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
