import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendFcmNotification } from '@/lib/notifications/fcm'

let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const token = body?.token
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const cleanToken = token.trim()

    try {
      await supabaseAdmin()
        .from('fcm_device_tokens')
        .upsert(
          {
            token: cleanToken,
            device_type: 'android',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'token' }
        )
    } catch (dbErr) {
      console.warn('[fcm] Failed to save token to database:', dbErr)
    }

    // Send a welcome test push notification to verify the device connection
    void sendFcmNotification({
      token: cleanToken,
      title: 'WA CRM 💬',
      body: 'تم تفعيل واستقبال إشعارات الهاتف بنجاح! 🔔',
    }).catch(() => {})

    return NextResponse.json({ success: true, registered: true })
  } catch (error) {
    console.error('[fcm] Error registering device token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
