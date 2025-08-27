// server.js - Main Express Server
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://meesoz.vercel.app/',
    credentials: true
}));
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// UPI ID validation function
function validateUPI(upiId) {
    // Basic UPI ID format validation
    const upiRegex = /^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+$/;
    
    if (!upiId || typeof upiId !== 'string') {
        return { isValid: false, error: 'UPI ID is required' };
    }
    
    if (!upiRegex.test(upiId)) {
        return { isValid: false, error: 'Invalid UPI ID format' };
    }
    
    if (upiId.length < 3 || upiId.length > 50) {
        return { isValid: false, error: 'UPI ID length should be between 3-50 characters' };
    }
    
    return { isValid: true };
}

// Advanced UPI validation with common providers
function validateUPIProvider(upiId) {
    const commonProviders = [
        'paytm', 'phonepe', 'gpay', 'googlepay', 'amazonpay', 'mobikwik',
        'freecharge', 'airtel', 'jio', 'sbi', 'hdfc', 'icici', 'axis',
        'kotak', 'yes', 'pnb', 'bob', 'canara', 'union', 'indian'
    ];
    
    const [, provider] = upiId.split('@');
    if (!provider) return false;
    
    return commonProviders.some(p => provider.toLowerCase().includes(p));
}

// Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Payment server is running' });
});

// Validate UPI ID
app.post('/api/validate-upi', (req, res) => {
    try {
        const { upiId } = req.body;
        
        const validation = validateUPI(upiId);
        
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: validation.error
            });
        }
        
        // Additional provider validation
        const isKnownProvider = validateUPIProvider(upiId);
        
        res.json({
            success: true,
            message: 'UPI ID is valid',
            upiId: upiId,
            isKnownProvider: isKnownProvider
        });
        
    } catch (error) {
        console.error('UPI validation error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during UPI validation'
        });
    }
});

// Create payment order
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount, currency = 'INR', upiId, paymentMethod, customerDetails } = req.body;
        
        // Validate required fields
        if (!amount || !upiId) {
            return res.status(400).json({
                success: false,
                message: 'Amount and UPI ID are required'
            });
        }
        
        // Validate UPI ID
        const upiValidation = validateUPI(upiId);
        if (!upiValidation.isValid) {
            return res.status(400).json({
                success: false,
                message: upiValidation.error
            });
        }
        
        // Validate amount (minimum 1 rupee)
        if (amount < 100) { // Amount in paisa (100 paisa = 1 rupee)
            return res.status(400).json({
                success: false,
                message: 'Minimum amount should be ₹1'
            });
        }
        
        // Create Razorpay order
        const options = {
            amount: parseInt(amount), // amount in paisa
            currency: currency,
            receipt: `receipt_${Date.now()}`,
            notes: {
                upiId: upiId,
                paymentMethod: paymentMethod,
                customerName: customerDetails?.name || 'N/A',
                customerEmail: customerDetails?.email || 'N/A'
            }
        };
        
        const order = await razorpay.orders.create(options);
        
        res.json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            upiId: upiId,
            paymentMethod: paymentMethod
        });
        
    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create payment order',
            error: error.message
        });
    }
});

// Verify payment
app.post('/api/verify-payment', (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Missing required payment verification parameters'
            });
        }
        
        // Create signature
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');
        
        const isAuthentic = expectedSignature === razorpay_signature;
        
        if (isAuthentic) {
            // Payment is successful
            res.json({
                success: true,
                message: 'Payment verified successfully',
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Payment verification failed'
            });
        }
        
    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during payment verification'
        });
    }
});

// Get payment details
app.get('/api/payment/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;
        
        const payment = await razorpay.payments.fetch(paymentId);
        
        res.json({
            success: true,
            payment: {
                id: payment.id,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                method: payment.method,
                created_at: payment.created_at,
                notes: payment.notes
            }
        });
        
    } catch (error) {
        console.error('Payment fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment details'
        });
    }
});

// Webhook endpoint for Razorpay
app.post('/api/webhook', (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const webhookSignature = req.headers['x-razorpay-signature'];
        
        // Verify webhook signature
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(JSON.stringify(req.body))
            .digest('hex');
        
        if (expectedSignature !== webhookSignature) {
            return res.status(400).json({ error: 'Invalid webhook signature' });
        }
        
        const event = req.body.event;
        const payloadData = req.body.payload;
        
        console.log('Webhook Event:', event);
        console.log('Payload:', payloadData);
        
        // Handle different webhook events
        switch (event) {
            case 'payment.captured':
                console.log('Payment captured:', payloadData.payment.entity.id);
                // Handle successful payment
                handlePaymentSuccess(payloadData.payment.entity);
                break;
                
            case 'payment.failed':
                console.log('Payment failed:', payloadData.payment.entity.id);
                // Handle failed payment
                handlePaymentFailure(payloadData.payment.entity);
                break;
                
            case 'order.paid':
                console.log('Order paid:', payloadData.order.entity.id);
                // Handle order completion
                break;
                
            default:
                console.log('Unhandled webhook event:', event);
        }
        
        res.json({ status: 'ok' });
        
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Helper functions for webhook handling
function handlePaymentSuccess(paymentData) {
    // Implement your business logic here
    // e.g., update database, send confirmation email, etc.
    console.log('Processing successful payment:', paymentData.id);
    
    // You can add database operations here
    // Example: updateOrderStatus(paymentData.order_id, 'completed');
}

function handlePaymentFailure(paymentData) {
    // Implement your business logic here
    // e.g., update database, send failure notification, etc.
    console.log('Processing failed payment:', paymentData.id);
    
    // You can add database operations here
    // Example: updateOrderStatus(paymentData.order_id, 'failed');
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Start server
// app.listen(PORT, () => {
//     console.log(`Payment server running on port ${PORT}`);
//     console.log(`Health check: http://localhost:${PORT}/health`);
// });

module.exports = app;