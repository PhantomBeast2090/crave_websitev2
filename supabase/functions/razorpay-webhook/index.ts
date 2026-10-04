import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { HmacSha256 } from "https://deno.land/std@0.160.0/hash/sha256.ts";

const WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')

serve(async (req) => {
  const signature = req.headers.get('x-razorpay-signature')
  const body = await req.text()

  if (!signature || !WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 })
  }

  // Verify Webhook Signature
  const expectedSignature = new HmacSha256(WEBHOOK_SECRET)
    .update(body)
    .toString();

  if (expectedSignature !== signature) {
      return new Response('Invalid Signature', { status: 401 })
  }

  const payload = JSON.parse(body)
  const event = payload.event
  const payment = payload.payload.payment.entity
  const razorpayOrderId = payment.order_id

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    // Map Razorpay events to our DB updates
    if (event === 'payment.captured') {
        const { data: payRecord } = await supabaseAdmin
            .from('payments')
            .select('order_id')
            .eq('razorpay_order_id', razorpayOrderId)
            .single()

        if (payRecord) {
            await supabaseAdmin.rpc('mark_payment_verified', {
                p_order_id: payRecord.order_id,
                p_razorpay_payment_id: payment.id,
                p_razorpay_signature: 'webhook', // We verify webhook signature above
                p_status: 'PAID'
            })
        }
    } else if (event === 'payment.failed') {
        await supabaseAdmin
            .from('payments')
            .update({ status: 'FAILED' })
            .eq('razorpay_order_id', razorpayOrderId)
    }

    return new Response('ok', { status: 200 })
  } catch (error) {
    console.error('Webhook processing error:', error)
    return new Response('Internal Error', { status: 500 })
  }
})
