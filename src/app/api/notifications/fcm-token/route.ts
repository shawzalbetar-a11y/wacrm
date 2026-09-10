import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

// Global active device token registry
const registeredDeviceTokens = new Set<string>()

export function getRegisteredFcmTokens(): string[] {
  return Array.from(registeredDeviceTokens)
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const token = body?.token
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    registeredDeviceTokens.add(token.trim())

    try {
      // Best-effort database persistence if table exists
      await supabaseAdmin()
        .from('fcm_device_tokens')
        .upsert(
          {
            token: token.trim(),
            device_type: 'android',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'token' }
        )
    } catch {
      // Table may not exist yet, memory set will handle delivery
    }

    return NextResponse.json({ success: true, registered: true })
  } catch (error) {
    console.error('[fcm] Error registering device token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
