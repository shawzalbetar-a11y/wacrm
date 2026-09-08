"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

/**
 * Synthesizes a crisp, pleasant chime using Web Audio API
 * Works across all modern browsers and mobile devices with zero external asset dependencies.
 */
function playNotificationSound() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // First bell tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(784, now); // G5
    osc1.frequency.exponentialRampToValueAtTime(1046.5, now + 0.12); // C6
    gain1.gain.setValueAtTime(0.28, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Second harmonious tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1046.5, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(1318.5, now + 0.3); // E6
    gain2.gain.setValueAtTime(0.22, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.5);
  } catch (err) {
    console.warn("[pwa] Notification sound error:", err);
  }
}

export function PwaNotificationManager() {
  const router = useRouter();
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    // 1. Register Service Worker for PWA
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          swRegistrationRef.current = reg;
        })
        .catch((err) => {
          console.warn("[pwa] ServiceWorker registration failed:", err);
        });
    }

    // 2. Request Notification permission if supported and not decided yet
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        // Request permission on user first session
        Notification.requestPermission().catch(() => {});
      }
    }

    // 3. Supabase Realtime Listener for inbound customer WhatsApp messages
    const supabase = createClient();
    const channel = supabase
      .channel("pwa-inbound-messages-listener")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        async (payload) => {
          const newMsg = payload.new as {
            id: string;
            conversation_id: string;
            sender_type: string;
            content_text?: string;
            content_type?: string;
          };

          // Only notify for inbound messages from customer
          if (!newMsg || newMsg.sender_type !== "customer") {
            return;
          }

          // Trigger Sound & Vibration
          playNotificationSound();
          if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate([200, 100, 200]);
          }

          const previewText =
            newMsg.content_text ||
            (newMsg.content_type === "image"
              ? "📷 صورة"
              : newMsg.content_type === "audio"
                ? "🎙️ رسالة صوتية"
                : newMsg.content_type === "video"
                  ? "🎥 مقطع فيديو"
                  : newMsg.content_type === "document"
                    ? "📄 مستند"
                    : "💬 رسالة جديدة");

          const title = "رسالة واتساب جديدة 💬";

          // Show in-app interactive Toast
          toast.info(title, {
            description: previewText,
            duration: 6000,
            action: {
              label: "فتح المحادثة",
              onClick: () => {
                router.push(`/inbox`);
              },
            },
          });

          // Show OS Native / PWA Notification
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            const notificationOptions: NotificationOptions = {
              body: previewText,
              icon: "/icons/icon-192x192.png",
              badge: "/icons/icon-192x192.png",
              tag: `msg-${newMsg.conversation_id}`,
              data: {
                conversationId: newMsg.conversation_id,
                url: "/inbox",
              },
            };

            if (
              swRegistrationRef.current &&
              "showNotification" in swRegistrationRef.current
            ) {
              swRegistrationRef.current.showNotification(
                title,
                notificationOptions,
              );
            } else {
              const notification = new Notification(title, notificationOptions);
              notification.onclick = () => {
                window.focus();
                router.push("/inbox");
                notification.close();
              };
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
