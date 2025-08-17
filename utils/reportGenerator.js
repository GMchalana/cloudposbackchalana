// utils/reportGenerator.js
const Order = require('../models/Order');
const Product = require('../models/Product');

const generateSalesReport = async (startDate, endDate) => {
  // Get orders in date range
  const orders = await Order.find({
    createdAt: { $gte: startDate, $lte: endDate },
    status: 'completed'
  }).populate('items.product');

  // Calculate totals
  let totalSales = 0;
  let totalItems = 0;
  const salesByProduct = {};
  const salesByCategory = {};
  const salesByDay = {};

  orders.forEach(order => {
    totalSales += order.total;
    
    order.items.forEach(item => {
      totalItems += item.quantity;
      
      // Product sales
      const productId = item.product._id.toString();
      if (!salesByProduct[productId]) {
        salesByProduct[productId] = {
          name: item.product.name,
          quantity: 0,
          total: 0
        };
      }
      salesByProduct[productId].quantity += item.quantity;
      salesByProduct[productId].total += item.total;
      
      // Category sales (if product has category)
      if (item.product.category) {
        const categoryId = item.product.category.toString();
        if (!salesByCategory[categoryId]) {
          salesByCategory[categoryId] = {
            name: item.product.category.name,
            quantity: 0,
            total: 0
          };
        }
        salesByCategory[categoryId].quantity += item.quantity;
        salesByCategory[categoryId].total += item.total;
      }
    });
    
    // Daily sales
    const day = order.createdAt.toISOString().split('T')[0];
    if (!salesByDay[day]) {
      salesByDay[day] = {
        date: day,
        orders: 0,
        total: 0
      };
    }
    salesByDay[day].orders += 1;
    salesByDay[day].total += order.total;
  });

  // Convert to arrays
  const productSales = Object.values(salesByProduct)
    .sort((a, b) => b.total - a.total);
  
  const categorySales = Object.values(salesByCategory)
    .sort((a, b) => b.total - a.total);
  
  const dailySales = Object.values(salesByDay)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Generate CSV
  let csv = 'Date,Orders,Total Sales\n';
  dailySales.forEach(day => {
    csv += `${day.date},${day.orders},${day.total.toFixed(2)}\n`;
  });

  csv += '\nProduct,Quantity,Total Sales\n';
  productSales.forEach(product => {
    csv += `${product.name},${product.quantity},${product.total.toFixed(2)}\n`;
  });

  csv += '\nCategory,Quantity,Total Sales\n';
  categorySales.forEach(category => {
    csv += `${category.name},${category.quantity},${category.total.toFixed(2)}\n`;
  });

  return {
    startDate,
    endDate,
    totalOrders: orders.length,
    totalSales,
    totalItems,
    productSales,
    categorySales,
    dailySales,
    csv
  };
};

module.exports = { generateSalesReport };