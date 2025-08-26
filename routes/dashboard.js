// routes/dashboard.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { authenticate, authorize } = require('../middleware/auth');

// Get dashboard overview statistics
router.get('/overview', async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    // Sales statistics
    const salesStats = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          totalOrders: { $sum: 1 },
          totalItems: {
            $sum: {
              $sum: '$items.quantity'
            }
          },
          totalProfit: { $sum: '$totalProfit' },
          averageOrderValue: { $avg: '$total' }
        }
      }
    ]);

    // Previous period comparison
    const prevStartDate = new Date(startDate);
    prevStartDate.setDate(prevStartDate.getDate() - days);
    const prevEndDate = new Date(startDate);

    const prevSalesStats = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: prevStartDate, $lt: prevEndDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          totalOrders: { $sum: 1 }
        }
      }
    ]);

    // Product statistics
    const productStats = await Product.aggregate([
      {
        $facet: {
          total: [{ $match: { isActive: true } }, { $count: "count" }],
          outOfStock: [{ $match: { stock: 0, isActive: true } }, { $count: "count" }],
          lowStock: [
            {
              $match: {
                $expr: { $lte: ['$stock', '$lowStockThreshold'] },
                stock: { $gt: 0 },
                isActive: true
              }
            },
            { $count: "count" }
          ],
          totalValue: [
            { $match: { isActive: true } },
            { $group: { _id: null, value: { $sum: { $multiply: ['$stock', '$costPrice'] } } } }
          ]
        }
      }
    ]);

    // Updated Category statistics to use denormalized 'category' string field
    const categoryStats = await Product.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$category',
          productCount: { $sum: 1 },
          totalStock: { $sum: '$stock' },
          totalValue: { $sum: { $multiply: ['$stock', '$costPrice'] } }
        }
      },
      {
        $project: {
          _id: 0, // Exclude _id
          name: '$_id',
          productCount: 1,
          totalStock: 1,
          totalValue: 1
        }
      },
      { $sort: { productCount: -1 } }
    ]);

    // Format response
    const currentSales = salesStats[0] || { totalRevenue: 0, totalOrders: 0, totalItems: 0, totalProfit: 0, averageOrderValue: 0 };
    const previousSales = prevSalesStats[0] || { totalRevenue: 0, totalOrders: 0 };

    const revenueGrowth = previousSales.totalRevenue > 0
      ? ((currentSales.totalRevenue - previousSales.totalRevenue) / previousSales.totalRevenue * 100)
      : 0;

    const ordersGrowth = previousSales.totalOrders > 0
      ? ((currentSales.totalOrders - previousSales.totalOrders) / previousSales.totalOrders * 100)
      : 0;

    const products = productStats[0];
    const totalProducts = products.total[0]?.count || 0;
    const outOfStockProducts = products.outOfStock[0]?.count || 0;
    const lowStockProducts = products.lowStock[0]?.count || 0;
    const totalInventoryValue = products.totalValue[0]?.value || 0;

    res.json({
      sales: {
        totalRevenue: currentSales.totalRevenue,
        totalOrders: currentSales.totalOrders,
        totalItems: currentSales.totalItems,
        totalProfit: currentSales.totalProfit,
        averageOrderValue: currentSales.averageOrderValue,
        revenueGrowth,
        ordersGrowth
      },
      products: {
        totalProducts,
        outOfStockProducts,
        lowStockProducts,
        inStockProducts: totalProducts - outOfStockProducts - lowStockProducts,
        totalInventoryValue
      },
      categories: categoryStats
    });

  } catch (error) {
    console.error('Dashboard overview error:', error);
    res.status(500).json({ message: 'Error fetching dashboard data' });
  }
});

// Get sales chart data
router.get('/sales-chart', async (req, res) => {
  try {
    const { period = '7' } = req.query;
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const salesChart = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
          profit: { $sum: '$totalProfit' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Fill missing dates with zero values
    const chartData = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const existingData = salesChart.find(item => item._id === dateStr);
      chartData.push({
        date: dateStr,
        revenue: existingData?.revenue || 0,
        orders: existingData?.orders || 0,
        profit: existingData?.profit || 0,
      });
    }

    res.json(chartData);
  } catch (error) {
    console.error('Sales chart error:', error);
    res.status(500).json({ message: 'Error fetching sales chart data' });
  }
});

// Get top products
// routes/dashboard.js
router.get('/top-products', async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const limitNum = parseInt(limit);

    const topProducts = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$items.productName' },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.itemTotal' },
        }
      },
      // --- FIX: Add a stage to convert _id string to ObjectId ---
      {
        $addFields: {
          convertedId: { $toObjectId: '$_id' }
        }
      },
      // --- Now, use the new convertedId for the lookup ---
      {
        $lookup: {
          from: 'products',
          localField: 'convertedId', // Use the converted ObjectId
          foreignField: '_id', // Matches the product's ObjectId
          as: 'productInfo'
        }
      },
      { $unwind: '$productInfo' },
      {
        $project: {
          name: 1,
          totalQuantity: 1,
          totalRevenue: 1,
          currentStock: '$productInfo.stock'
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: limitNum }
    ]);

    res.json(topProducts);
  } catch (error) {
    console.error('Top products error:', error);
    res.status(500).json({ message: 'Error fetching top products' });
  }
});

// Get recent orders
router.get('/recent-orders', async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const limitNum = parseInt(limit);

    const recentOrders = await Order.find({ status: 'completed' })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .select('orderNumber total totalProfit paymentMethod customerName createdAt items.productName');

    res.json(recentOrders);
  } catch (error) {
    console.error('Recent orders error:', error);
    res.status(500).json({ message: 'Error fetching recent orders' });
  }
});

// Get low stock alerts
router.get('/low-stock-alerts', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit);

    // Removed the populate call as 'category' is now a String
    const lowStockProducts = await Product.find({
      $expr: { $lte: ['$stock', '$lowStockThreshold'] },
      isActive: true
    })
    .sort({ stock: 1 })
    .limit(limitNum)
    .select('name stock lowStockThreshold category');

    res.json(lowStockProducts);
  } catch (error) {
    console.error('Low stock alerts error:', error);
    res.status(500).json({ message: 'Error fetching low stock alerts' });
  }
});

module.exports = router;