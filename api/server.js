const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "https://meesoz.vercel.app" || '*',
  credentials: true
}));
app.use(express.json());

// Razorpay init
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Payment server running ✅' });
});

// --- Create Order ---
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR' } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, message: 'Amount required' });
    }

    const options = {
      amount: parseInt(amount), // in paise
      currency,
      receipt: `receipt_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error('Order Error:', error);
    res.status(500).json({ success: false, message: 'Order creation failed' });
  }
});

// --- Verify Payment ---
app.post('/api/verify-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing parameters' });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      res.json({ success: true, message: 'Payment verified ✅' });
    } else {
      res.status(400).json({ success: false, message: 'Payment verification failed ❌' });
    }
  } catch (error) {
    console.error('Verify Error:', error);
    res.status(500).json({ success: false, message: 'Internal error' });
  }
});

// --- Webhook (optional) ---
app.post('/api/webhook', express.json({ type: 'application/json' }), (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (expectedSignature === signature) {
      console.log('Webhook Verified ✅:', req.body.event);
      res.json({ status: 'ok' });
    } else {
      res.status(400).json({ error: 'Invalid webhook signature ❌' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Webhook error' });
  }
});

// Export Express app for Vercel
module.exports = app;
