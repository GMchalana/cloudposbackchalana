// routes/reports.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { authenticate, authorize } = require('../middleware/auth');
const { generateSalesReport } = require('../utils/reportGenerator');

// Get sales report
// router.get('/sales', async (req, res) => {
//   try {
//     const { startDate, endDate, format = 'json' } = req.query;

//     if (!startDate || !endDate) {
//       return res.status(400).json({ message: 'Start date and end date are required' });
//     }

//     const start = new Date(startDate);
//     const end = new Date(endDate);
//     end.setHours(23, 59, 59, 999); // Include full end date

//     // Get orders within date range
//     const orders = await Order.find({
//       createdAt: { $gte: start, $lte: end },
//       status: 'completed'
//     })
//     .populate({
//       path: 'items.product',
//       select: 'name category',
//       populate: {
//         path: 'category',
//         select: 'name'
//       }
//     })
//     .sort({ createdAt: -1 });

//     // Calculate summary statistics
//     const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
//     const totalOrders = orders.length;
//     const totalItems = orders.reduce((sum, order) => 
//       sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
//     );

//     const report = {
//       summary: {
//         totalRevenue,
//         totalOrders,
//         totalItems,
//         averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0
//       },
//       orders,
//       dateRange: { startDate, endDate }
//     };

//     if (format === 'csv') {
//       const csvHeader = 'Order Number,Date,Customer,Items,Subtotal,Tax,Discount,Total,Payment Method\n';
//       const csvData = orders.map(order => [
//         order.orderNumber,
//         order.createdAt.toISOString().split('T')[0],
//         order.customerName || 'N/A',
//         order.items.length,
//         order.subtotal,
//         order.tax,
//         order.discount,
//         order.total,
//         order.paymentMethod
//       ].join(',')).join('\n');

//       res.setHeader('Content-Type', 'text/csv');
//       res.setHeader('Content-Disposition', `attachment; filename=sales_report_${startDate}_to_${endDate}.csv`);
//       return res.send(csvHeader + csvData);
//     }

//     res.json(report);
//   } catch (error) {
//     console.error('Sales report error:', error);
//     res.status(500).json({ message: 'Error generating sales report' });
//   }
// });
router.get('/sales', async (req, res) => {
  try {
    let { startDate, endDate, format = 'json', year, month } = req.query;

    if (!startDate && !endDate && !year && !month) {
      return res.status(400).json({ message: 'A valid date range or month and year are required.' });
    }

    let start, end;
    if (year && month) {
      // Monthly report logic
      start = new Date(year, month - 1, 1);
      end = new Date(year, month, 0); // Last day of the month
      end.setHours(23, 59, 59, 999);
    } else {
      // Date range report logic
      if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start date and end date are required for a date range report.' });
      }
      start = new Date(startDate);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    }

    const orders = await Order.find({
      createdAt: { $gte: start, $lte: end },
      status: 'completed'
    })
    .sort({ createdAt: -1 });

    // Calculate summary statistics
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const totalCost = orders.reduce((sum, order) => sum + order.totalCost, 0);
    const totalProfit = orders.reduce((sum, order) => sum + order.totalProfit, 0);
    const totalOrders = orders.length;
    const totalItems = orders.reduce((sum, order) => 
      sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
    );
    const profitMargin = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const report = {
      summary: {
        totalRevenue,
        totalCost,
        totalProfit,
        profitMargin,
        totalOrders,
        totalItems,
        averageOrderValue
      },
      orders,
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() }
    };

    if (format === 'csv') {
      const csvHeader = 'Order Number,Date,Customer,Items,Total,Total Cost,Total Profit,Profit Margin,Payment Method\n';
      const csvData = orders.map(order => [
        order.orderNumber,
        order.createdAt.toISOString().split('T')[0],
        order.customer?.name || order.customerName || 'N/A', // Prioritize embedded customer data
        order.items.length,
        order.total,
        order.totalCost,
        order.totalProfit,
        ((order.totalProfit / order.totalCost) * 100).toFixed(2) + '%',
        order.paymentMethod
      ].join(',')).join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=sales_report_${start.toISOString().split('T')[0]}_to_${end.toISOString().split('T')[0]}.csv`);
      return res.send(csvHeader + csvData);
    }

    res.json(report);
  } catch (error) {
    console.error('Sales report error:', error);
    res.status(500).json({ message: 'Error generating sales report' });
  }
});

// Get inventory report
router.get('/inventory', async (req, res) => {
  try {
    const { lowStock, category, format = 'json' } = req.query;
    let query = { isActive: true };

    if (lowStock === 'true') {
      query.$expr = { $lte: ['$stock', '$lowStockThreshold'] };
    }

    if (category) {
      query.category = category;
    }

    const products = await Product.find(query)
      .populate('category', 'name')
      .sort({ stock: 1, name: 1 });

    // Calculate inventory statistics
    const totalProducts = await Product.countDocuments({ isActive: true });
    const outOfStock = await Product.countDocuments({ stock: 0, isActive: true });
    const lowStockCount = await Product.countDocuments({
      $expr: { $and: [{ $lte: ['$stock', '$lowStockThreshold'] }, { $gt: ['$stock', 0] }] },
      isActive: true
    });
    const inStock = await Product.countDocuments({
      $expr: { $gt: ['$stock', '$lowStockThreshold'] },
      isActive: true
    });

    const totalValue = products.reduce((sum, product) => sum + (product.stock * product.costPrice), 0);

    const report = {
      summary: {
        totalProducts,
        outOfStock,
        lowStock: lowStockCount,
        inStock,
        totalInventoryValue: totalValue
      },
      products
    };

    if (format === 'csv') {
      const csvHeader = 'Name,SKU,Category,Stock,Low Stock Threshold,Cost Price,Selling Price,Total Value,Status\n';
      const csvData = products.map(product => [
        `"${product.name}"`,
        product.sku || 'N/A',
        product.category?.name || 'N/A',
        product.stock,
        product.lowStockThreshold,
        product.costPrice,
        product.price,
        (product.stock * product.costPrice).toFixed(2),
        product.stock === 0 ? 'Out of Stock' : 
        product.stock <= product.lowStockThreshold ? 'Low Stock' : 'In Stock'
      ].join(',')).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=inventory_report.csv');
      return res.send(csvHeader + csvData);
    }

    res.json(report);
  } catch (error) {
    console.error('Inventory report error:', error);
    res.status(500).json({ message: 'Error generating inventory report' });
  }
});

// Get all categories for filtering
router.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find().select('_id name').sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    console.error('Categories fetch error:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

module.exports = router;