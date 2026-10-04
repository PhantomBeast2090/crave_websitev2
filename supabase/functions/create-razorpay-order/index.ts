import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID')
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { order_id } = await req.json()
    if (!order_id) throw new Error('order_id is required')

    // 1. Fetch internal payment record
    // We join with orders to verify ownership via RLS
    const { data: payment, error: payError } = await supabaseClient
      .from('payments')
      .select('*, orders!inner(user_id, status)')
      .eq('order_id', order_id)
      .single()

    if (payError || !payment) throw new Error('Order/Payment not found or access denied')
    if (payment.orders.user_id !== user.id) throw new Error('Unauthorized access to order')

    // 2. Prepare Razorpay Order
    // Amount must be in paise
    const amountInPaise = Math.round(parseFloat(payment.amount) * 100)

    const auth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: order_id,
        notes: {
            internal_order_id: order_id,
            user_id: user.id
        }
      })
    })

    const rzpOrder = await response.json()
    if (!rzpOrder.id) {
        console.error('Razorpay Error:', rzpOrder)
        throw new Error('Failed to create Razorpay order')
    }

    // 3. Update payment record with Razorpay Order ID
    const { error: updateError } = await supabaseClient
      .from('payments')
      .update({
          razorpay_order_id: rzpOrder.id,
          gateway_provider: 'RAZORPAY',
          status: 'CREATED'
      })
      .eq('order_id', order_id)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({
        razorpay_order_id: rzpOrder.id,
        amount: amountInPaise,
        key_id: RAZORPAY_KEY_ID,
        currency: 'INR'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
