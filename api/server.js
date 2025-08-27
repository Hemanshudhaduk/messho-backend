// api/server.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
require('dotenv').config();

const app = express();

// -------------------- Middleware --------------------
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// -------------------- Razorpay Init --------------------
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// -------------------- Routes --------------------

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Payment server is running' });
});

// ✅ Validate UPI
app.post('/api/validate-upi', async (req, res) => {
    const { upiId } = req.body;
    if (!upiId) {
        return res.status(400).json({ success: false, message: 'UPI ID required' });
    }

    try {
        const response = await razorpay.upi.validate({ vpa: upiId });
        res.json({ success: true, data: response });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ Create Order
app.post('/api/create-order', async (req, res) => {
    const { amount, currency = 'INR', receipt = 'receipt_1' } = req.body;

    if (!amount) {
        return res.status(400).json({ success: false, message: 'Amount is required' });
    }

    try {
        const options = {
            amount: amount * 100, // convert to paise
            currency,
            receipt,
        };
        const order = await razorpay.orders.create(options);
        res.json({ success: true, order });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ Verify Payment Signature
app.post('/api/verify-payment', (req, res) => {
    const { order_id, payment_id, signature } = req.body;

    if (!order_id || !payment_id || !signature) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(order_id + '|' + payment_id)
            .digest('hex');

        if (generatedSignature === signature) {
            res.json({ success: true, message: 'Payment verified successfully' });
        } else {
            res.status(400).json({ success: false, message: 'Invalid signature' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ Payment Details
app.get('/api/payment/:id', async (req, res) => {
    try {
        const payment = await razorpay.payments.fetch(req.params.id);
        res.json({ success: true, payment });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------- Export for Vercel --------------------
module.exports = app;
