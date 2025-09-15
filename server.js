// server.js - Fixed LG-Pay Integration with Minimum Amount Validation
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Configuration
const LGPAY_MIN_AMOUNT = 200; // Minimum amount in rupees as per LG-Pay requirement

// Middleware
app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MD5 Sign function - Fixed for LG-Pay
function generateSignature(data, secretKey) {
    console.log('=== SIGNATURE GENERATION ===');
    console.log('Input data:', data);
    console.log('Secret key:', secretKey);
    
    // Remove sign field if it exists
    const signData = { ...data };
    delete signData.sign;
    
    // Sort keys alphabetically
    const sortedKeys = Object.keys(signData).sort();
    console.log('Sorted keys:', sortedKeys);
    
    // Build query string
    const queryParts = [];
    sortedKeys.forEach(key => {
        const value = signData[key];
        if (value !== null && value !== undefined && value !== '') {
            queryParts.push(`${key}=${value}`);
        }
    });
    
    const queryString = queryParts.join('&');
    const stringToSign = queryString + '&key=' + secretKey;
    
    console.log('Query string:', queryString);
    console.log('String to sign:', stringToSign);
    
    const signature = crypto.createHash('md5').update(stringToSign, 'utf8').digest('hex').toUpperCase();
    console.log('Generated signature:', signature);
    console.log('=== END SIGNATURE GENERATION ===\n');
    
    return signature;
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'LG-Pay server is running' });
});

// Debug endpoint to track problematic orders
app.post('/api/debug-order', (req, res) => {
    try {
        const { amount, cartItems, discountInfo } = req.body;
        
        console.log('\n🔍 DEBUG ORDER REQUEST');
        console.log('Raw amount:', amount);
        console.log('Cart items:', cartItems);
        console.log('Discount info:', discountInfo);
        
        const amountInRupees = parseFloat(amount);
        const amountInPaisa = Math.round(amountInRupees * 100);
        
        res.json({
            debug: {
                originalAmount: amount,
                parsedAmount: amountInRupees,
                amountInPaisa: amountInPaisa,
                reconvertedAmount: amountInPaisa / 100,
                isValidAmount: amountInRupees >= LGPAY_MIN_AMOUNT,
                minimumRequired: LGPAY_MIN_AMOUNT,
                difference: LGPAY_MIN_AMOUNT - amountInRupees,
                cartItems: cartItems,
                discountInfo: discountInfo
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test signature endpoint
app.get('/api/test-signature', (req, res) => {
    try {
        const testData = {
            app_id: process.env.LGPAY_APP_ID,
            trade_type: process.env.LGPAY_TRADE_TYPE,
            order_sn: 'test123',
            money: '20000', // 200 rupees in paisa
            notify_url: process.env.LGPAY_NOTIFY_URL,
            ip: '127.0.0.1',
            remark: 'test'
        };
        
        const signature = generateSignature(testData, process.env.LGPAY_SECRET_KEY);
        
        res.json({
            success: true,
            testData: testData,
            signature: signature,
            config: {
                app_id: process.env.LGPAY_APP_ID,
                secret_key: process.env.LGPAY_SECRET_KEY,
                trade_type: process.env.LGPAY_TRADE_TYPE,
                notify_url: process.env.LGPAY_NOTIFY_URL,
                minimum_amount: LGPAY_MIN_AMOUNT
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create order endpoint - FIXED with minimum amount validation
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        
        console.log('\n🎯 NEW ORDER REQUEST');
        console.log('Amount (rupees):', amount);
        
        // Validate amount is provided
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required'
            });
        }
        
        const amountInRupees = parseFloat(amount);
        
        // CRITICAL FIX: Check minimum amount requirement
        if (amountInRupees < LGPAY_MIN_AMOUNT) {
            console.log(`❌ Amount ${amountInRupees} is below minimum ${LGPAY_MIN_AMOUNT}`);
            return res.status(400).json({
                success: false,
                message: `Minimum order amount is ₹${LGPAY_MIN_AMOUNT}. Your order amount is ₹${amountInRupees}.`,
                minimumAmount: LGPAY_MIN_AMOUNT,
                currentAmount: amountInRupees,
                debug: {
                    reason: 'BELOW_MINIMUM_AMOUNT',
                    required: `₹${LGPAY_MIN_AMOUNT}`,
                    provided: `₹${amountInRupees}`,
                    difference: `₹${LGPAY_MIN_AMOUNT - amountInRupees}`
                }
            });
        }
        
        // Check environment variables
        const { LGPAY_APP_ID, LGPAY_SECRET_KEY, LGPAY_TRADE_TYPE, LGPAY_NOTIFY_URL } = process.env;
        
        console.log('Config check:');
        console.log('- APP_ID:', LGPAY_APP_ID);
        console.log('- TRADE_TYPE:', LGPAY_TRADE_TYPE);
        console.log('- SECRET_KEY:', LGPAY_SECRET_KEY ? 'SET' : 'MISSING');
        console.log('- NOTIFY_URL:', LGPAY_NOTIFY_URL);
        console.log('- MIN_AMOUNT:', LGPAY_MIN_AMOUNT);
        
        if (!LGPAY_APP_ID || !LGPAY_SECRET_KEY || !LGPAY_TRADE_TYPE) {
            return res.status(500).json({
                success: false,
                message: 'LG-Pay configuration missing'
            });
        }
        
        // Convert amount to paisa (only after validation)
        const amountInPaisa = Math.round(amountInRupees * 100);
        console.log(`✅ Amount validated: ₹${amountInRupees} = ${amountInPaisa} paisa`);
        
        // Build order data
        const orderData = {
            app_id: LGPAY_APP_ID,
            trade_type: LGPAY_TRADE_TYPE,
            order_sn: 'p' + Date.now(),
            money: amountInPaisa.toString(),
            notify_url: LGPAY_NOTIFY_URL,
            ip: req.ip || '127.0.0.1',
            remark: 'Order payment'
        };
        
        console.log('Order data before signing:', orderData);
        
        // Generate signature
        const signature = generateSignature(orderData, LGPAY_SECRET_KEY);
        orderData.sign = signature;
        
        console.log('Final order data:', orderData);
        
        // Make request to LG-Pay
        const response = await axios.post('https://www.lg-pay.com/api/order/create', 
            new URLSearchParams(orderData), 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 30000
            }
        );
        
        console.log('LG-Pay Response:', response.data);
        
        const lgPayResponse = response.data;
        
        // Enhanced error handling
        if (lgPayResponse.status === 0) {
            console.log('❌ LG-Pay returned error status 0');
            
            // Handle specific error messages
            if (lgPayResponse.msg === 'Sign Error') {
                return res.json({
                    success: false,
                    message: 'Payment gateway signature verification failed',
                    debug: {
                        errorType: 'SIGNATURE_ERROR',
                        orderData: orderData,
                        signature: signature,
                        lgPayResponse: lgPayResponse,
                        troubleshooting: [
                            'Verify LGPAY_SECRET_KEY is correct',
                            'Check if LG-Pay account is active',
                            'Contact LG-Pay support for signature format'
                        ]
                    }
                });
            }
            
            if (lgPayResponse.msg && lgPayResponse.msg.includes('minimum amount')) {
                return res.json({
                    success: false,
                    message: `LG-Pay minimum amount requirement: ${lgPayResponse.msg}`,
                    debug: {
                        errorType: 'MINIMUM_AMOUNT_ERROR',
                        lgPayMessage: lgPayResponse.msg,
                        sentAmount: `₹${amountInRupees} (${amountInPaisa} paisa)`,
                        requiredMinimum: '₹200.00'
                    }
                });
            }
            
            // Generic error
            return res.json({
                success: false,
                message: lgPayResponse.msg || 'Payment gateway error',
                debug: {
                    errorType: 'LGPAY_ERROR',
                    lgPayResponse: lgPayResponse,
                    orderData: orderData
                }
            });
        }
        
        // Look for payment URL
        const paymentUrl = lgPayResponse.pay_url || 
                          lgPayResponse.payment_url || 
                          lgPayResponse.data?.pay_url ||
                          lgPayResponse.data?.payment_url;
        
        if (paymentUrl) {
            console.log('✅ Payment URL received:', paymentUrl);
            res.json({
                success: true,
                order_sn: orderData.order_sn,
                response: {
                    ...lgPayResponse,
                    pay_url: paymentUrl,
                    payment_url: paymentUrl
                },
                debug: {
                    amountValidated: `₹${amountInRupees}`,
                    amountSent: `${amountInPaisa} paisa`,
                    minimumRequired: `₹${LGPAY_MIN_AMOUNT}`
                }
            });
        } else {
            console.log('❌ No payment URL in response');
            res.json({
                success: false,
                message: 'No payment URL received from LG-Pay',
                response: lgPayResponse,
                debug: {
                    errorType: 'NO_PAYMENT_URL',
                    orderData: orderData,
                    fullResponse: lgPayResponse
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Order creation error:', error.message);
        console.error('Response data:', error.response?.data);
        
        res.status(500).json({
            success: false,
            message: 'Order creation failed due to network or server error',
            error: error.response?.data || error.message,
            debug: {
                errorType: 'NETWORK_ERROR',
                status: error.response?.status,
                statusText: error.response?.statusText
            }
        });
    }
});

// Webhook endpoint
app.post('/api/webhook', (req, res) => {
    try {
        console.log('📞 Webhook received:', req.body);
        
        const notifyData = req.body;
        const { LGPAY_SECRET_KEY } = process.env;
        
        if (!LGPAY_SECRET_KEY) {
            return res.status(500).send('Configuration error');
        }
        
        if (notifyData.sign) {
            const receivedSign = notifyData.sign;
            const dataForSign = { ...notifyData };
            delete dataForSign.sign;
            
            const expectedSign = generateSignature(dataForSign, LGPAY_SECRET_KEY);
            
            if (receivedSign !== expectedSign) {
                console.error('Invalid webhook signature');
                return res.status(400).send('Invalid signature');
            }
        }
        
        console.log('✅ Valid webhook processed');
        res.send('success');
        
    } catch (error) {
        console.error('❌ Webhook error:', error);
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