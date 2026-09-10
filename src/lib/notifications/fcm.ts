import crypto from 'crypto'

interface FcmMessagePayload {
  title: string
  body: string
  conversationId?: string
  topic?: string
  token?: string
}

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null

/**
 * Generate Google OAuth2 Access Token for Firebase Cloud Messaging v1 API
 */
async function getGoogleAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000)

  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token
  }

  try {
    const header = { alg: 'RS256', typ: 'JWT' }
    const claimSet = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }

    const encode = (obj: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(obj))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')

    const unsignedToken = `${encode(header)}.${encode(claimSet)}`

    const signer = crypto.createSign('RSA-SHA256')
    signer.update(unsignedToken)
    const signature = signer
      .sign(sa.private_key, 'base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    const jwt = `${unsignedToken}.${signature}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[fcm] OAuth2 token exchange error:', errText)
      return null
    }

    const data = (await res.json()) as { access_token: string; expires_in: number }
    cachedAccessToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in || 3600),
    }

    return data.access_token
  } catch (err) {
    console.error('[fcm] Failed to generate Google Access Token:', err)
    return null
  }
}

/**
 * Send Firebase Cloud Messaging (FCM) v1 Push Notification to Android devices
 */
export async function sendFcmNotification(payload: FcmMessagePayload): Promise<boolean> {
  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!saEnv) {
    // Service account not configured yet
    return false
  }

  let sa: ServiceAccount
  try {
    sa = typeof saEnv === 'string' && saEnv.trim().startsWith('{')
      ? JSON.parse(saEnv)
      : saEnv
  } catch (err) {
    console.error('[fcm] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', err)
    return false
  }

  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    console.warn('[fcm] FIREBASE_SERVICE_ACCOUNT is missing required fields')
    return false
  }

  const accessToken = await getGoogleAccessToken(sa)
  if (!accessToken) return false

  const messageTarget: Record<string, string> = payload.token
    ? { token: payload.token }
    : { topic: payload.topic || 'wacrm_alerts' }

  const fcmBody = {
    message: {
      ...messageTarget,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        conversationId: payload.conversationId || '',
        url: '/inbox',
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'notification',
          channel_id: 'wacrm_messages',
          notification_priority: 'PRIORITY_MAX',
          default_vibrate_timings: true,
          click_action: 'FCM_PLUGIN_ACTIVITY',
        },
      },
    },
  }

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fcmBody),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      console.error('[fcm] FCM v1 send failed:', err)
      return false
    }

    return true
  } catch (err) {
    console.error('[fcm] FCM dispatch error:', err)
    return false
  }
}
