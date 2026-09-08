"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

// Shared AudioContext to bypass mobile autoplay policy
let sharedAudioCtx: AudioContext | null = null;

function getOrUnlockAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!sharedAudioCtx) {
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
  let played = false;

  // 1. Web Audio API
  try {
    const ctx = getOrUnlockAudioContext();
    if (ctx && ctx.state !== "suspended") {
      const now = ctx.currentTime;

      // Primary tone
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now); // A5
      osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.15); // D6
      gain1.gain.setValueAtTime(0.5, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.4);

      // Harmony tone
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1320, now + 0.12); // E6
      osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.35); // A6
      gain2.gain.setValueAtTime(0.4, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.55);

      played = true;
    }
  } catch (e) {
    console.warn("[pwa] WebAudio chime failed:", e);
  }

  // 2. HTML Audio Element fallback
  try {
    const audio = new Audio("/notification.wav");
    audio.volume = 0.8;
    audio.play().catch(() => {
      // Ignored if browser blocks un-interacted autoplay
    });
  } catch {
    // Ignore
  }
}

/**
 * Dispatches native OS / Android PWA notification via Service Worker
 */
type ExtendedNotificationOptions = NotificationOptions & {
  vibrate?: number[];
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
        await (reg.showNotification as (t: string, o?: unknown) => Promise<void>)(title, options);
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
    // 1. Unlock AudioContext on the first tap/click anywhere
    const unlockAudio = () => {
      getOrUnlockAudioContext();
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
    window.addEventListener("click", unlockAudio, { passive: true });
    window.addEventListener("touchstart", unlockAudio, { passive: true });

    // 2. Register Service Worker for PWA
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Check for SW updates
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

    // Helper to trigger notification with debounce (prevent double alerts)
    const triggerInboundAlert = (previewText: string, conversationId?: string) => {
      const now = Date.now();
      if (now - lastAlertTimeRef.current < 1500) {
        return; // Deduplicate events fired within 1.5s
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

      // Show Native Android / PWA Notification
      showNativeNotification(
        title,
        {
          body: previewText,
          icon: "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
          vibrate: [300, 150, 300],
          tag: `wa-${conversationId || Date.now()}`,
          data: {
            conversationId,
            url: "/inbox",
          },
        },
        router
      );
    };

    // 4. Supabase Realtime Listeners
    const supabase = createClient();
    const channelId = `pwa-notifications-${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      // Listen to new messages table inserts
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
      // Also listen to conversations updates (when unread_count increments)
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

          // If unread count increased
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
      .subscribe();

    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
