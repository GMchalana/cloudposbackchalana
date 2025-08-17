// routes/orders.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { authenticate, authorize } = require('../middleware/auth');
const { generatePDF } = require('../utils/pdfGenerator');
// const mongoose = require('mongoose');

// Create new order
router.post('/', async (req, res) => {
  try {
    const { items, subtotal, tax, discount, total, paymentMethod, customerName, customerContact } = req.body;

    // Validate user authentication
    if (!req.body.userId) {
      return res.status(401).json({ message: 'User not authenticatedddd' });
    }

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'No items provided' });
    }

    console.log('Processing order for user:', req.body.userId);
    console.log('Items:', items);

    // Step 1: Validate all products and check stock availability
    const productUpdates = [];
    for (const item of items) {
      if (!item.product || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({ 
          message: 'Invalid item data. Each item must have product ID and valid quantity.' 
        });
      }

      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(400).json({ 
          message: `Product with ID ${item.product} not found` 
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}` 
        });
      }

      productUpdates.push({
        productId: product._id,
        productName: product.name,
        quantityToReduce: item.quantity,
        currentStock: product.stock
      });
    }

    console.log('All products validated successfully');

    // Step 2: Update stock using atomic operations
    for (const update of productUpdates) {
      const result = await Product.findOneAndUpdate(
        { 
          _id: update.productId, 
          stock: { $gte: update.quantityToReduce } // Ensure stock is still sufficient
        },
        { 
          $inc: { stock: -update.quantityToReduce } 
        },
        { new: true }
      );

      if (!result) {
        // Stock became insufficient between validation and update
        // Rollback previous updates
        console.error(`Stock update failed for product ${update.productName}`);
        
        // Rollback: restore stock for previously updated products
        const rollbackIndex = productUpdates.indexOf(update);
        for (let i = 0; i < rollbackIndex; i++) {
          await Product.findByIdAndUpdate(
            productUpdates[i].productId,
            { $inc: { stock: productUpdates[i].quantityToReduce } }
          );
        }
        
        return res.status(400).json({ 
          message: `Stock became insufficient for ${update.productName} during processing. Please try again.` 
        });
      }
      
      console.log(`Stock updated for ${update.productName}: ${result.stock}`);
    }

    // Step 3: Generate order number
    const orderCount = await Order.countDocuments();
    const orderNumber = `ORD-${Date.now()}-${orderCount + 1}`;

    // Step 4: Create the order
    const order = new Order({
      orderNumber,
      items,
      subtotal,
      tax: tax || 0,
      discount: discount || 0,
      total,
      paymentMethod,
      customerName,
      customerContact,
      createdBy: req.body.userId
    });

    console.log('Attempting to save order:', orderNumber);
    const savedOrder = await order.save();
    console.log('Order saved successfully:', savedOrder._id);

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: savedOrder
    });

  } catch (error) {
    console.error('Order creation error:', error);
    
    // Handle specific mongoose validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: validationErrors 
      });
    }

    // Handle duplicate key errors (orderNumber)
    if (error.code === 11000) {
      return res.status(400).json({ 
        message: 'Order number already exists. Please try again.' 
      });
    }

    // Handle cast errors (invalid ObjectId)
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        message: 'Invalid ID format provided' 
      });
    }
    
    res.status(500).json({ 
      message: 'Server error occurred while creating order',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});
// Get all orders with filters
router.get('/',  async (req, res) => {
  try {
    const { startDate, endDate, status, paymentMethod } = req.query;
    let query = {};

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else if (startDate) {
      query.createdAt = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.createdAt = { $lte: new Date(endDate) };
    }

    if (status) query.status = status;
    if (paymentMethod) query.paymentMethod = paymentMethod;

    const orders = await Order.find(query)
      .populate('items.product', 'name price')
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single order
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name price')
      .populate('createdBy', 'username');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Generate order PDF
router.get('/:id/pdf',  async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name price')
      .populate('createdBy', 'username');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const pdfBuffer = await generatePDF(order, req.query.size || 'a4');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=order_${order.orderNumber}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ message: 'Error generating PDF' });
  }
});

// Update order status (admin only)
router.put('/:id/status',  async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // If cancelling, return items to stock
    if (status === 'cancelled') {
      for (const item of order.items) {
        const product = await Product.findById(item.product);
        if (product) {
          product.stock += item.quantity;
          await product.save();
        }
      }
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
