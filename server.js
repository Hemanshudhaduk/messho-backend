// server.js - Fixed LG-Pay Integration with correct signature
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

// FIXED MD5 Sign function for LG-Pay
function md5_sign(data, key) {
    console.log('🔐 === SIGNATURE GENERATION DEBUG ===');
    console.log('Input data:', data);
    console.log('Secret key:', key);
    
    // Step 1: Remove sign key if it exists (shouldn't be included in signing)
    const dataToSign = { ...data };
    delete dataToSign.sign;
    
    // Step 2: Sort object keys alphabetically (critical for LG-Pay)
    const sortedKeys = Object.keys(dataToSign).sort();
    console.log('Sorted keys:', sortedKeys);
    
    // Step 3: Build query string in the correct format
    const pairs = [];
    sortedKeys.forEach(k => {
        const value = dataToSign[k];
        // Only include non-empty values
        if (value !== null && value !== undefined && value !== '') {
            pairs.push(`${k}=${value}`);
        }
    });
    
    // Step 4: Join with & and add key at the end
    const queryString = pairs.join('&');
    const stringToSign = queryString + "&key=" + key;
    
    console.log('Query pairs:', pairs);
    console.log('Query string:', queryString);
    console.log('String to sign:', stringToSign);
    
    // Step 5: Generate MD5 hash (uppercase)
    const signature = crypto.createHash('md5').update(stringToSign, 'utf8').digest('hex').toUpperCase();
    console.log('Generated signature:', signature);
    
    return signature;
}

// Alternative signature function (in case LG-Pay uses different format)
function md5_sign_v2(data, key) {
    console.log('🔐 === ALTERNATIVE SIGNATURE GENERATION ===');
    
    const dataToSign = { ...data };
    delete dataToSign.sign;
    
    // Build URL-encoded string manually
    const sortedKeys = Object.keys(dataToSign).sort();
    const params = new URLSearchParams();
    
    sortedKeys.forEach(k => {
        if (dataToSign[k] !== null && dataToSign[k] !== undefined && dataToSign[k] !== '') {
            params.append(k, dataToSign[k]);
        }
    });
    
    let queryString = params.toString();
    // URL decode once (some gateways expect this)
    queryString = decodeURIComponent(queryString);
    
    const stringToSign = queryString + "&key=" + key;
    console.log('Alternative string to sign:', stringToSign);
    
    const signature = crypto.createHash('md5').update(stringToSign, 'utf8').digest('hex').toUpperCase();
    console.log('Alternative signature:', signature);
    
    return signature;
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'LG-Pay server is running' });
});

// Test signature generation endpoint
app.post('/api/test-signature', (req, res) => {
    try {
        const testData = {
            app_id: process.env.LGPAY_APP_ID,
            trade_type: process.env.LGPAY_TRADE_TYPE,
            order_sn: "test123",
            money: 100,
            notify_url: process.env.LGPAY_NOTIFY_URL,
            ip: "127.0.0.1",
            remark: "test"
        };
        
        console.log('🧪 Testing signature generation...');
        
        const signature1 = md5_sign(testData, process.env.LGPAY_SECRET_KEY);
        const signature2 = md5_sign_v2(testData, process.env.LGPAY_SECRET_KEY);
        
        res.json({
            success: true,
            testData,
            signature_v1: signature1,
            signature_v2: signature2,
            secretKey: process.env.LGPAY_SECRET_KEY
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create order - FIXED VERSION with better signature handling
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        
        console.log('🎯 === NEW ORDER REQUEST ===');
        console.log('Amount received:', amount);
        
        if (!amount) {
            return res.status(400).json({
                success: false,
                message: 'Amount is required'
            });
        }
        
        // Environment variables
        const app_id = process.env.LGPAY_APP_ID;
        const secret_key = process.env.LGPAY_SECRET_KEY;
        const trade_type = process.env.LGPAY_TRADE_TYPE;
        const notify_url = process.env.LGPAY_NOTIFY_URL;
        
        console.log('Environment variables:');
        console.log('- APP_ID:', app_id);
        console.log('- TRADE_TYPE:', trade_type);
        console.log('- SECRET_KEY:', secret_key ? `${secret_key.substring(0,4)}...` : 'MISSING');
        console.log('- NOTIFY_URL:', notify_url);
        
        if (!app_id || !secret_key || !trade_type) {
            return res.status(500).json({
                success: false,
                message: 'LG-Pay configuration missing'
            });
        }
        
        // Convert amount to paisa
        const amountInPaisa = Math.round(parseFloat(amount) * 100);
        console.log('Amount conversion: ₹' + amount + ' = ' + amountInPaisa + ' paisa');
        
        // Build order data - EXACTLY matching LG-Pay requirements
        const orderData = {
            app_id: app_id,
            trade_type: trade_type,
            order_sn: "p" + Date.now(),
            money: amountInPaisa.toString(), // Convert to string as some APIs expect this
            notify_url: notify_url,
            ip: req.ip || "127.0.0.1",
            remark: "Order payment"
        };
        
        console.log('Order data before signing:', orderData);
        
        // Try both signature methods
        const signature1 = md5_sign(orderData, secret_key);
        const signature2 = md5_sign_v2(orderData, secret_key);
        
        // Use the first signature method (standard)
        orderData.sign = signature1;
        
        console.log('Final order data:', orderData);
        
        // Make request to LG-Pay
        const url = "https://www.lg-pay.com/api/order/create";
        console.log('Making request to:', url);
        
        const response = await axios.post(url, new URLSearchParams(orderData), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'LG-Pay-Client/1.0'
            },
            timeout: 30000
        });
        
        console.log('LG-Pay Response Status:', response.status);
        console.log('LG-Pay Response:', response.data);
        
        const lgPayResponse = response.data;
        
        // Check if signature error persists
        if (lgPayResponse.msg === 'Sign Error' || lgPayResponse.status === 0) {
            console.log('❌ Still getting signature error, trying alternative signature...');
            
            // Try with alternative signature
            orderData.sign = signature2;
            console.log('Trying with alternative signature:', signature2);
            
            const retryResponse = await axios.post(url, new URLSearchParams(orderData), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'LG-Pay-Client/1.0'
                },
                timeout: 30000
            });
            
            console.log('Retry Response:', retryResponse.data);
            
            if (retryResponse.data.msg === 'Sign Error') {
                // Still failing, return debug info
                return res.json({
                    success: false,
                    message: 'Signature verification failed with both methods',
                    debug: {
                        orderData: orderData,
                        signature1: signature1,
                        signature2: signature2,
                        lgPayResponse: retryResponse.data,
                        secretKey: secret_key,
                        troubleshooting: 'Check if secret key is correct or contact LG-Pay support'
                    }
                });
            } else {
                // Alternative signature worked
                console.log('✅ Alternative signature worked!');
                return this.processSuccessResponse(retryResponse.data, orderData, res);
            }
        }
        
        // Process successful response
        this.processSuccessResponse(lgPayResponse, orderData, res);
        
    } catch (error) {
        console.error('❌ Request failed:', error.message);
        console.error('Response data:', error.response?.data);
        
        res.status(500).json({
            success: false,
            message: 'Order creation failed',
            error: error.response?.data || error.message,
            debug: {
                url: 'https://www.lg-pay.com/api/order/create',
                status: error.response?.status,
                statusText: error.response?.statusText
            }
        });
    }
});

// Helper function to process successful responses
function processSuccessResponse(lgPayResponse, orderData, res) {
    // Look for payment URL in various fields
    const paymentUrl = lgPayResponse.pay_url || 
                      lgPayResponse.payment_url || 
                      lgPayResponse.payUrl || 
                      lgPayResponse.url ||
                      lgPayResponse.redirect_url ||
                      lgPayResponse.qr_url ||
                      lgPayResponse.data?.pay_url ||
                      lgPayResponse.data?.payment_url;
    
    console.log('Payment URL found:', paymentUrl);
    
    if (paymentUrl) {
        console.log('✅ Success: Payment URL received');
        res.json({
            success: true,
            order_sn: orderData.order_sn,
            response: {
                ...lgPayResponse,
                pay_url: paymentUrl,
                payment_url: paymentUrl
            }
        });
    } else {
        console.log('⚠️ No payment URL in response');
        res.json({
            success: false,
            message: 'No payment URL received from LG-Pay',
            response: lgPayResponse,
            debug: {
                fullResponse: lgPayResponse,
                orderData: orderData
            }
        });
    }
}

// Manual signature test endpoint
app.get('/api/manual-signature-test', (req, res) => {
    // Test with exact parameters that might work
    const testParams = {
        app_id: process.env.LGPAY_APP_ID,
        ip: "127.0.0.1", 
        money: "100",
        notify_url: process.env.LGPAY_NOTIFY_URL,
        order_sn: "test" + Date.now(),
        remark: "test",
        trade_type: process.env.LGPAY_TRADE_TYPE
    };
    
    console.log('Manual signature test with params:', testParams);
    
    // Test different string building methods
    const methods = [];
    
    // Method 1: Simple concatenation
    const sorted1 = Object.keys(testParams).sort();
    const string1 = sorted1.map(k => `${k}=${testParams[k]}`).join('&') + '&key=' + process.env.LGPAY_SECRET_KEY;
    const sig1 = crypto.createHash('md5').update(string1).digest('hex').toUpperCase();
    methods.push({ method: 'Simple', string: string1, signature: sig1 });
    
    // Method 2: With URL encoding
    const params2 = new URLSearchParams();
    sorted1.forEach(k => params2.append(k, testParams[k]));
    const string2 = params2.toString() + '&key=' + process.env.LGPAY_SECRET_KEY;
    const sig2 = crypto.createHash('md5').update(string2).digest('hex').toUpperCase();
    methods.push({ method: 'URLSearchParams', string: string2, signature: sig2 });
    
    // Method 3: With decoding
    const string3 = decodeURIComponent(params2.toString()) + '&key=' + process.env.LGPAY_SECRET_KEY;
    const sig3 = crypto.createHash('md5').update(string3).digest('hex').toUpperCase();
    methods.push({ method: 'Decoded', string: string3, signature: sig3 });
    
    res.json({
        testParams,
        methods,
        secretKey: process.env.LGPAY_SECRET_KEY
    });
});

// Webhook endpoint
app.post('/api/webhook', (req, res) => {
    try {
        console.log('📞 Webhook received:', req.body);
        
        const notifyData = req.body;
        const secret_key = process.env.LGPAY_SECRET_KEY;
        
        if (!secret_key) {
            return res.status(500).send('Configuration error');
        }
        
        // Verify signature if present
        if (notifyData.sign) {
            const receivedSign = notifyData.sign;
            const dataForSign = { ...notifyData };
            delete dataForSign.sign;
            
            const expectedSign = md5_sign(dataForSign, secret_key);
            
            if (receivedSign !== expectedSign) {
                console.error('Invalid webhook signature');
                return res.status(400).send('Invalid signature');
            }
        }
        
        console.log('Valid webhook processed:', notifyData);
        res.send('success');
        
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Error processing webhook');
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
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

module.exports = app;