"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { createClient } from "@/lib/supabase/client";
import { playChimeSound, triggerAlert } from "@/lib/notifications";

export function PwaNotificationManager() {
  const router = useRouter();
  const lastAlertTimeRef = useRef<number>(0);

  useEffect(() => {
    // 1. Prime / Unlock audio on user touch or click
    const unlockAudio = () => {
      playChimeSound();
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
    window.addEventListener("click", unlockAudio, { passive: true });
    window.addEventListener("touchstart", unlockAudio, { passive: true });

    // 2. Native Capacitor Push & Local Notifications initialization
    if (Capacitor.isNativePlatform()) {
      try {
        // Initialize LocalNotifications channel
        LocalNotifications.createChannel({
          id: "wacrm_messages",
          name: "رسائل واتساب الواردة",
          description: "إشعارات الرسائل الجديدة مع الصوت والاهتزاز",
          importance: 5,
          visibility: 1,
          sound: "notification.wav",
          vibration: true,
        }).catch(() => {});

        // Request FCM Push permissions
        PushNotifications.checkPermissions()
          .then((status) => {
            if (status.receive === "prompt") {
              return PushNotifications.requestPermissions();
            }
            return status;
          })
          .then((res) => {
            if (res.receive === "granted") {
              PushNotifications.register();
            }
          })
          .catch((err) => {
            console.warn("[fcm] Push permission error:", err);
          });

        PushNotifications.addListener("registration", (token) => {
          console.log("[fcm] Device token:", token.value);
          PushNotifications.subscribeTo({ topic: "wacrm_alerts" }).catch(() => {});
          fetch("/api/notifications/fcm-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: token.value }),
          }).catch(() => {});
        });

        PushNotifications.addListener("pushNotificationReceived", (notification) => {
          triggerAlert(
            notification.title || "رسالة واتساب جديدة 💬",
            notification.body || "",
            notification.data?.conversationId
          );
        });

        PushNotifications.addListener("pushNotificationActionPerformed", () => {
          router.push("/inbox");
        });
      } catch (err) {
        console.warn("[native] Push setup error:", err);
      }
    } else {
      // 3. Web Service Worker & Browser Notifications
      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker
          .register("/sw.js")
          .then((reg) => {
            reg.update().catch(() => {});
          })
          .catch((err) => {
            console.warn("[pwa] SW registration failed:", err);
          });
      }

      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      }
    }

    const fireNotification = (bodyText: string, conversationId?: string) => {
      const now = Date.now();
      if (now - lastAlertTimeRef.current < 800) {
        return; // debounce within 800ms
      }
      lastAlertTimeRef.current = now;

      const title = "رسالة واتساب جديدة 💬";

      // Show interactive in-app toast
      toast.info(title, {
        description: bodyText,
        duration: 8000,
        action: {
          label: "فتح المحادثة",
          onClick: () => {
            router.push("/inbox");
          },
        },
      });

      // Trigger Chime Sound, Vibration, and OS / Android Notification
      triggerAlert(title, bodyText, conversationId);
    };

    // 4. Supabase Realtime Listener (with auth state handler)
    const supabase = createClient();
    const channelName = `pwa-all-alerts-${Date.now()}`;
    const channel = supabase.channel(channelName);

    channel
      // Listen to new customer messages
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const msg = payload.new as {
            id: string;
            conversation_id: string;
            sender_type: string;
            content_text?: string;
            content_type?: string;
          };

          if (!msg || msg.sender_type !== "customer") return;

          const preview =
            msg.content_text ||
            (msg.content_type === "image"
              ? "📷 أرسل العميل صورة"
              : msg.content_type === "audio"
                ? "🎙️ أرسل العميل تسجيل صوتي"
                : msg.content_type === "video"
                  ? "🎥 أرسل العميل فيديو"
                  : msg.content_type === "document"
                    ? "📄 أرسل العميل مستند"
                    : "💬 رسالة جديدة واردة");

          fireNotification(preview, msg.conversation_id);
        }
      )
      // Listen to conversations updates
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          const conv = payload.new as {
            id: string;
            unread_count?: number;
            last_message_text?: string;
          };

          if (conv && typeof conv.unread_count === "number" && conv.unread_count > 0) {
            fireNotification(
              conv.last_message_text || "💬 رسالة واتساب جديدة",
              conv.id
            );
          }
        }
      )
      .subscribe((status) => {
        if (status === "TIMED_OUT" || status === "CLOSED") {
          setTimeout(() => {
            channel.subscribe();
          }, 2000);
        }
      });

    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
