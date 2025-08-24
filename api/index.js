// api/index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { errorHandler } = require('../middleware/errorHandler');
const serverless = require('serverless-http');

const app = express();

// Middleware
app.use(cors()); // Allow all origins
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Database connection
mongoose.connect('mongodb+srv://gmchalanaprabhashwara:TLDriOsDzhin84R3@cloudpos.lpdd0vp.mongodb.net/pos-system')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working jj🚀' });
});

// Routes
app.use('/api/auth', require('../routes/auth'));
app.use('/api/categories', require('../routes/categories'));
app.use('/api/products', require('../routes/products'));
app.use('/api/orders', require('../routes/orders'));
app.use('/api/reports', require('../routes/reports'));
app.use('/api/dashboard', require('../routes/dashboard'));
app.use('/api/customers', require('./routes/customers'));

// Error handler
app.use(errorHandler);

// Export as serverless function for Vercel
module.exports = app;
module.exports.handler = serverless(app);
