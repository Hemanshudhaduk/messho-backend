// server.js - Fixed LG-Pay Integration
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MD5 Sign function (converted from PHP)
function md5_sign(data, key) {
    // Sort object keys (equivalent to PHP ksort)
    const sortedKeys = Object.keys(data).sort();
    const sortedData = {};
    sortedKeys.forEach(k => {
        sortedData[k] = data[k];
    });
    
    // Build query string (equivalent to PHP http_build_query)
    const params = new URLSearchParams();
    Object.keys(sortedData).forEach(key => {
        params.append(key, sortedData[key]);
    });
    
    // Get query string and decode it (equivalent to PHP urldecode)
    let string = params.toString();
    string = decodeURIComponent(string);
    string = string.trim() + "&key=" + key;
    
    console.log('📝 String to sign:', string); // Debug log
    
    // Create MD5 hash and convert to uppercase
    return crypto.createHash('md5').update(string).digest('hex').toUpperCase();
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'LG-Pay server is running' });
});

// Create order (FIXED VERSION)
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        
        console.log('🔵 Received create-order request:', { amount });
        
        if (!amount) {
            return res.status(400).json({
                success: false,
                message: 'Amount is required'
            });
        }
        
        // LG-Pay configuration from environment variables
        const app_id = process.env.LGPAY_APP_ID;
        const secret_key = process.env.LGPAY_SECRET_KEY;
        const trade_type = process.env.LGPAY_TRADE_TYPE;
        const notify_url = process.env.LGPAY_NOTIFY_URL;
        
        console.log('⚙️  Configuration check:', {
            app_id: app_id ? 'Set' : 'Missing',
            secret_key: secret_key ? 'Set' : 'Missing', 
            trade_type,
            notify_url
        });
        
        if (!app_id || !secret_key || !trade_type) {
            return res.status(500).json({
                success: false,
                message: 'LG-Pay configuration missing'
            });
        }
        
        // FIXED: Convert rupees to paisa (multiply by 100)
        const amountInPaisa = Math.round(parseFloat(amount) * 100);
        console.log('💰 Amount conversion:', { 
            originalAmount: amount, 
            amountInRupees: parseFloat(amount),
            amountInPaisa: amountInPaisa 
        });
        
        // Build the data array (exactly like PHP)
        const data = {
            app_id: app_id,
            trade_type: trade_type,
            order_sn: "p" + Date.now(),
            money: amountInPaisa, // NOW CORRECTLY IN PAISA
            notify_url: notify_url,
            ip: req.ip || "127.0.0.1",
            remark: "Order payment"
        };
        
        console.log('📤 Data before signing:', data);
        
        // Add the signature (exactly like PHP)
        data.sign = md5_sign(data, secret_key);
        
        console.log('🔐 Final data with signature:', { ...data, sign: data.sign });
        
        // Prepare request URL
        const url = "https://www.lg-pay.com/api/order/create";
        
        console.log('🚀 Making request to LG-Pay...');
        
        // Make cURL equivalent request using axios
        const response = await axios.post(url, new URLSearchParams(data), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 30000
        });
        
        console.log('✅ LG-Pay Response Status:', response.status);
        console.log('📥 LG-Pay Response Data:', JSON.stringify(response.data, null, 2));
        
        // Check if LG-Pay response is successful
        const lgPayData = response.data;
        
        // LG-Pay might return success differently, let's handle various formats
        let isSuccess = false;
        let paymentUrl = null;
        let message = 'Order created successfully';
        
        if (typeof lgPayData === 'object') {
            // Handle different possible response formats
            isSuccess = lgPayData.success === true || 
                       lgPayData.status === 'success' || 
                       lgPayData.code === 0 || 
                       lgPayData.code === '0' ||
                       lgPayData.result === 'success';
                       
            // Look for payment URL in various fields
            paymentUrl = lgPayData.pay_url || 
                        lgPayData.payment_url || 
                        lgPayData.payUrl || 
                        lgPayData.url ||
                        lgPayData.redirect_url ||
                        lgPayData.qr_url;
                        
            message = lgPayData.message || lgPayData.msg || 'Order processed';
        } else if (typeof lgPayData === 'string') {
            // Some APIs return HTML or string responses
            if (lgPayData.includes('http')) {
                // Might be a direct URL
                paymentUrl = lgPayData.trim();
                isSuccess = true;
            }
        }
        
        console.log('🔍 Parsed response:', { isSuccess, paymentUrl, message });
        
        if (isSuccess || paymentUrl) {
            res.json({
                success: true,
                order_sn: data.order_sn,
                response: {
                    ...lgPayData,
                    pay_url: paymentUrl, // Standardize the field name
                    payment_url: paymentUrl // Also provide alternative name
                },
                debug: {
                    originalResponse: lgPayData,
                    detectedPaymentUrl: paymentUrl,
                    amountSent: amountInPaisa
                }
            });
        } else {
            // If no clear success indicator, still return the response for debugging
            console.log('⚠️  Unclear LG-Pay response, returning for debugging');
            res.json({
                success: false,
                message: `LG-Pay response unclear: ${message}`,
                order_sn: data.order_sn,
                response: lgPayData,
                debug: {
                    originalResponse: lgPayData,
                    amountSent: amountInPaisa,
                    note: 'Check LG-Pay API documentation for correct response format'
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Error details:');
        console.error('Status:', error.response?.status);
        console.error('Status Text:', error.response?.statusText);
        console.error('Response Data:', error.response?.data);
        console.error('Error Message:', error.message);
        
        res.status(500).json({
            success: false,
            message: 'Order creation failed',
            error: error.response?.data || error.message,
            debug: {
                status: error.response?.status,
                statusText: error.response?.statusText,
                url: 'https://www.lg-pay.com/api/order/create'
            }
        });
    }
});

// Test endpoint to check LG-Pay connectivity
app.get('/api/test-lgpay', async (req, res) => {
    try {
        console.log('🧪 Testing LG-Pay connectivity...');
        
        const testData = {
            app_id: process.env.LGPAY_APP_ID,
            trade_type: process.env.LGPAY_TRADE_TYPE,
            order_sn: "test" + Date.now(),
            money: 100, // ₹1.00 in paisa for testing
            notify_url: process.env.LGPAY_NOTIFY_URL,
            ip: "127.0.0.1",
            remark: "Test connection"
        };
        
        testData.sign = md5_sign(testData, process.env.LGPAY_SECRET_KEY);
        
        const response = await axios.post("https://www.lg-pay.com/api/order/create", 
            new URLSearchParams(testData), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        
        res.json({
            success: true,
            message: 'LG-Pay API is reachable',
            testResponse: response.data,
            sentData: testData
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'LG-Pay test failed',
            error: error.response?.data || error.message
        });
    }
});

// Enhanced Webhook endpoint
app.post('/api/webhook', (req, res) => {
    try {
        console.log('📞 Webhook received:', {
            headers: req.headers,
            body: req.body,
            method: req.method,
            url: req.url
        });
        
        const notifyData = req.body;
        const secret_key = process.env.LGPAY_SECRET_KEY;
        
        if (!secret_key) {
            console.error('❌ Secret key not configured');
            return res.status(500).send('Configuration error');
        }
        
        if (!notifyData || Object.keys(notifyData).length === 0) {
            console.error('❌ Empty webhook data');
            return res.status(400).send('Empty webhook data');
        }
        
        // Verify signature if present
        if (notifyData.sign) {
            const receivedSign = notifyData.sign;
            
            // Remove sign from data for verification
            const dataForSign = { ...notifyData };
            delete dataForSign.sign;
            
            const expectedSign = md5_sign(dataForSign, secret_key);
            
            console.log('🔐 Signature verification:', {
                received: receivedSign,
                expected: expectedSign,
                matches: receivedSign === expectedSign
            });
            
            if (receivedSign !== expectedSign) {
                console.error('❌ Invalid signature');
                return res.status(400).send('Invalid signature');
            }
        }
        
        console.log('✅ Valid webhook processed:', notifyData);
        
        // TODO: Add your business logic here
        // Example: Update order status in database
        // Example: Send confirmation email
        // Example: Trigger fulfillment process
        
        // Respond with success (LG-Pay expects this)
        res.send('success');
        
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).send('Error processing webhook');
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    console.log('❓ 404 - Route not found:', req.method, req.originalUrl);
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Add port handling for local testing
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log('🔧 Environment check:');
        console.log('- LGPAY_APP_ID:', process.env.LGPAY_APP_ID ? 'Set' : 'Missing');
        console.log('- LGPAY_SECRET_KEY:', process.env.LGPAY_SECRET_KEY ? 'Set' : 'Missing');
        console.log('- LGPAY_TRADE_TYPE:', process.env.LGPAY_TRADE_TYPE);
        console.log('- LGPAY_NOTIFY_URL:', process.env.LGPAY_NOTIFY_URL);
    });
}

module.exports = app;