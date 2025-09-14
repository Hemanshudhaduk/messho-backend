// server.js - Simple LG-Pay Integration (Based on PHP files)
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
    
    // Create MD5 hash and convert to uppercase
    return crypto.createHash('md5').update(string).digest('hex').toUpperCase();
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'LG-Pay server is running' });
});

// Create order (based on index.php)
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        
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
        
        if (!app_id || !secret_key || !trade_type) {
            return res.status(500).json({
                success: false,
                message: 'LG-Pay configuration missing'
            });
        }
        
        // Build the data array (exactly like PHP)
        const data = {
            app_id: app_id,
            trade_type: trade_type,
            order_sn: "p" + Date.now(),
            money: parseInt(amount), // amount should be in paisa
            notify_url: notify_url,
            ip: req.ip || "0.0.0.0",
            remark: "remark001"
        };
        
        // Add the signature (exactly like PHP)
        data.sign = md5_sign(data, secret_key);
        
        // Prepare request URL
        const url = "https://www.lg-pay.com/api/order/create";
        
        console.log('Creating LG-Pay order:', data);
        
        // Make cURL equivalent request using axios
        const response = await axios.post(url, new URLSearchParams(data), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 30000
        });
        
        console.log('LG-Pay Response:', response.data);
        
        res.json({
            success: true,
            order_sn: data.order_sn,
            response: response.data
        });
        
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
        
        res.status(500).json({
            success: false,
            message: 'Order creation failed',
            error: error.response?.data || error.message
        });
    }
});

// Webhook/Notify endpoint (based on notify.php)
app.post('/api/webhook', (req, res) => {
    try {
        console.log('Webhook received:', req.body);
        
        const notifyData = req.body;
        const secret_key = process.env.LGPAY_SECRET_KEY;
        
        if (!secret_key) {
            return res.status(500).send('Configuration error');
        }
        
        // Verify signature
        const receivedSign = notifyData.sign;
        
        // Remove sign from data for verification
        const dataForSign = { ...notifyData };
        delete dataForSign.sign;
        
        const expectedSign = md5_sign(dataForSign, secret_key);
        
        if (receivedSign !== expectedSign) {
            console.error('Invalid signature');
            return res.status(400).send('Invalid signature');
        }
        
        console.log('Valid webhook:', notifyData);
        
        // Process the notification
        // Add your business logic here
        
        // Respond with success (LG-Pay expects this)
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