// server.js - LG-Pay Integration WITHOUT Minimum Order Restriction
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
    res.json({ status: 'OK', message: 'LG-Pay server is running - No minimum order restrictions' });
});

// Test signature endpoint
app.get('/api/test-signature', (req, res) => {
    try {
        const testData = {
            app_id: process.env.LGPAY_APP_ID,
            trade_type: process.env.LGPAY_TRADE_TYPE,
            order_sn: 'test123',
            money: '100', // 1 rupee in paisa for testing
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
                no_minimum_restriction: true
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Create order endpoint - REMOVED ALL MINIMUM RESTRICTIONS
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        
        console.log('\n🎯 NEW ORDER REQUEST (No Minimum Restrictions)');
        console.log('Amount (rupees):', amount);
        
        // Basic validation - only check for valid positive amount
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be a positive number',
                debug: {
                    reason: 'INVALID_AMOUNT',
                    provided: amount,
                    required: 'Positive number greater than 0'
                }
            });
        }
        
        const amountInRupees = parseFloat(amount);
        console.log('✅ Amount validation passed:', amountInRupees, 'rupees');
        
        // Check environment variables
        const { LGPAY_APP_ID, LGPAY_SECRET_KEY, LGPAY_TRADE_TYPE, LGPAY_NOTIFY_URL } = process.env;
        
        console.log('Config check:');
        console.log('- APP_ID:', LGPAY_APP_ID);
        console.log('- TRADE_TYPE:', LGPAY_TRADE_TYPE);
        console.log('- SECRET_KEY:', LGPAY_SECRET_KEY ? 'SET' : 'MISSING');
        console.log('- NOTIFY_URL:', LGPAY_NOTIFY_URL);
        console.log('- MINIMUM_RESTRICTION: DISABLED');
        
        if (!LGPAY_APP_ID || !LGPAY_SECRET_KEY || !LGPAY_TRADE_TYPE) {
            return res.status(500).json({
                success: false,
                message: 'LG-Pay configuration missing'
            });
        }
        
        // Convert amount to paisa (no minimum check)
        const amountInPaisa = Math.round(amountInRupees * 100);
        console.log('Amount conversion: ₹', amountInRupees, '=', amountInPaisa, 'paisa');
        
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
        console.log('✅ Proceeding to LG-Pay (no restrictions applied)');
        
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
        
        // Handle LG-Pay specific errors
        if (lgPayResponse.status === 0) {
            console.log('❌ LG-Pay returned error status 0');
            
            // Check if this is a LG-Pay gateway minimum amount error
            if (lgPayResponse.msg && lgPayResponse.msg.includes('minimum amount')) {
                console.log('⚠️  LG-Pay gateway itself has minimum amount restriction');
                return res.json({
                    success: false,
                    message: `LG-Pay gateway requirement: ${lgPayResponse.msg}`,
                    debug: {
                        errorType: 'LGPAY_GATEWAY_MINIMUM',
                        lgPayMessage: lgPayResponse.msg,
                        sentAmount: `₹${amountInRupees} (${amountInPaisa} paisa)`,
                        note: 'This is a restriction from the LG-Pay payment gateway itself, not our application'
                    }
                });
            }
            
            if (lgPayResponse.msg === 'Sign Error') {
                return res.json({
                    success: false,
                    message: 'Payment gateway signature verification failed',
                    debug: {
                        errorType: 'SIGNATURE_ERROR',
                        orderData: orderData,
                        signature: signature,
                        lgPayResponse: lgPayResponse
                    }
                });
            }
            
            // Generic LG-Pay error
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
                    amountSent: `₹${amountInRupees}`,
                    amountInPaisa: amountInPaisa,
                    restrictionsApplied: 'NONE - All amounts allowed'
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

// Debug endpoint to test any amount
app.post('/api/debug-order', (req, res) => {
    try {
        const { amount, cartItems, discountInfo } = req.body;
        
        console.log('\n🔍 DEBUG ORDER REQUEST (No Restrictions)');
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
                isValidAmount: amountInRupees > 0,
                minimumRequired: 'NONE - All positive amounts allowed',
                serverRestrictions: 'DISABLED',
                cartItems: cartItems,
                discountInfo: discountInfo,
                note: 'Server will accept any positive amount'
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
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