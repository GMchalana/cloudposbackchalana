// routes/orders.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const Customer = require('../models/Customers');
const { authenticate, authorize } = require('../middleware/auth');
const { generatePDF, generateReceipt } = require('../utils/pdfGenerator');

router.post('/', async (req, res) => {
  try {
    const { 
      items, 
      subtotal, 
      tax, 
      discount, 
      total, 
      paymentMethod, 
      customerId,
      customerData,
      customerName,
      customerContact 
    } = req.body;

    // Validate user authentication
    if (!req.body.userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'No items provided' });
    }

    console.log('Processing order for user:', req.body.userId);
    console.log('Items:', items);

    // Step 1: Handle customer information
    let customerInfo = null;
    
    if (customerId) {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        return res.status(400).json({ message: 'Selected customer not found' });
      }
      
      customerInfo = {
        customerId: customer._id,
        name: customer.name,
        address: customer.address || '',
        phoneNumber: customer.phoneNumber || '',
        nic: customer.nic || '',
        isVat: customer.isVat || false
      };
      
      console.log('Using existing customer:', customer.name);
      
    } else if (customerData && customerData.name) {
      customerInfo = {
        customerId: null,
        name: customerData.name.trim(),
        address: customerData.address?.trim() || '',
        phoneNumber: customerData.phoneNumber?.trim() || '',
        nic: customerData.nic?.trim() || '',
        isVat: Boolean(customerData.isVat)
      };
      
      console.log('Using provided customer data:', customerData.name);
      
    } else if (customerName) {
      customerInfo = {
        customerId: null,
        name: customerName.trim(),
        address: '',
        phoneNumber: customerContact?.trim() || '',
        nic: '',
        isVat: false
      };
      
      console.log('Using legacy customer format:', customerName);
    }

    // Step 2: Validate all products, check stock, and prepare order items with cost tracking
    const productUpdates = [];
    const orderItems = [];
    let totalCost = 0;

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

      // Calculate costs and profits for this item
      const sellingPrice = Number(item.price) || Number(product.price);
      const costPrice = Number(product.costPrice) || 0; // Assuming you have costPrice in Product model
      const quantity = Number(item.quantity);
      const itemTotal = Number((quantity * sellingPrice).toFixed(2));
      const itemCost = Number((quantity * costPrice).toFixed(2));
      const itemProfit = Number((itemTotal - itemCost).toFixed(2));

      // Create order item with all product data stored directly
      const orderItem = {
        productId: product._id.toString(),
        productName: product.name,
        productCategory: product.category || '',
        productBarcode: product.barcode || '',
        quantity: quantity,
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        itemTotal: itemTotal,
        itemCost: itemCost,
        itemProfit: itemProfit
      };

      orderItems.push(orderItem);
      totalCost += itemCost;

      productUpdates.push({
        productId: product._id,
        productName: product.name,
        quantityToReduce: item.quantity,
        currentStock: product.stock
      });
    }

    console.log('All products validated successfully');
    console.log('Total cost calculated:', totalCost);

    // Step 3: Update stock using atomic operations
    for (const update of productUpdates) {
      const result = await Product.findOneAndUpdate(
        { 
          _id: update.productId, 
          stock: { $gte: update.quantityToReduce } 
        },
        { 
          $inc: { stock: -update.quantityToReduce } 
        },
        { new: true }
      );

      if (!result) {
        console.error(`Stock update failed for product ${update.productName}`);
        
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

    // Step 4: Calculate profit metrics
    const discountAmount = Number(discount) || 0;
    const subtotalAmount = Number(subtotal);
    const totalProfitBeforeDiscount = subtotalAmount - totalCost;
    const totalProfit = Number((totalProfitBeforeDiscount - discountAmount).toFixed(2));
    const profitMargin = totalCost > 0 ? Number(((totalProfit / totalCost) * 100).toFixed(2)) : 0;

    console.log('Profit calculations:');
    console.log('- Total Cost:', totalCost);
    console.log('- Total Profit:', totalProfit);
    console.log('- Profit Margin:', profitMargin + '%');

    // Step 5: Generate order number
    const orderCount = await Order.countDocuments();
    const orderNumber = `ORD-${Date.now()}-${orderCount + 1}`;

    // Step 6: Create the order with all calculated values
    const orderData = {
      orderNumber,
      items: orderItems, // Using our processed items with full product data
      subtotal: subtotalAmount,
      tax: Number(tax) || 0,
      discount: discountAmount,
      total: Number(total),
      totalCost: Number(totalCost.toFixed(2)),
      totalProfit: totalProfit,
      profitMargin: profitMargin,
      paymentMethod,
      createdBy: req.body.userId
    };

    // Add customer information if available
    if (customerInfo) {
      orderData.customer = customerInfo;
      orderData.customerName = customerInfo.name;
      orderData.customerContact = customerInfo.phoneNumber;
    } else {
      if (customerName) orderData.customerName = customerName;
      if (customerContact) orderData.customerContact = customerContact;
    }

    const order = new Order(orderData);

    console.log('Attempting to save order:', orderNumber);
    const savedOrder = await order.save();
    console.log('Order saved successfully:', savedOrder._id);

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      orderId: savedOrder._id,
      order: savedOrder,
      profitInfo: {
        totalCost: totalCost,
        totalProfit: totalProfit,
        profitMargin: profitMargin
      }
    });

  } catch (error) {
    console.error('Order creation error:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: validationErrors 
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({ 
        message: 'Order number already exists. Please try again.' 
      });
    }

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

// Get all orders with filters (updated to work with new schema)
router.get('/', async (req, res) => {
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
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single order (no population needed since we store product data directly)
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('createdBy', 'username');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Generate order PDF (updated for new schema)
router.get('/:id/pdf', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
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

// Update order status (modified to handle new schema)
router.put('/:id/status', async (req, res) => {
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

    // If cancelling, return items to stock using stored product data
    if (status === 'cancelled') {
      for (const item of order.items) {
        // Use productId from stored data to find and update product
        const product = await Product.findById(item.productId);
        if (product) {
          product.stock += item.quantity;
          await product.save();
          console.log(`Returned ${item.quantity} units of ${item.productName} to stock`);
        } else {
          console.warn(`Product ${item.productName} (ID: ${item.productId}) no longer exists in database`);
        }
      }
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Generate receipt (no changes needed)
router.get('/:id/receipt', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('createdBy', 'username');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const pdfBuffer = await generateReceipt(order);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=receipt_${order.orderNumber}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Receipt generation error:', error);
    res.status(500).json({ message: 'Error generating receipt' });
  }
});

// New route: Get profit analytics
router.get('/analytics/profit', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const orders = await Order.find({ ...query, status: { $ne: 'cancelled' } });

    const analytics = {
      totalRevenue: orders.reduce((sum, order) => sum + order.total, 0),
      totalCost: orders.reduce((sum, order) => sum + order.totalCost, 0),
      totalProfit: orders.reduce((sum, order) => sum + order.totalProfit, 0),
      averageProfitMargin: orders.length > 0 
        ? orders.reduce((sum, order) => sum + order.profitMargin, 0) / orders.length 
        : 0,
      orderCount: orders.length,
      profitByDay: {} // You can add daily breakdown logic here
    };

    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;