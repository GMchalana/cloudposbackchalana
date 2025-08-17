// utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');

const generatePDF = async (order, size = 'a4') => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: size.toUpperCase(),
        margin: size === 'a4' ? 50 : 20
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Header
      doc.fontSize(20).text('INVOICE', { align: 'center' });
      doc.moveDown();
      
      // Order details
      doc.fontSize(12).text(`Order #: ${order.orderNumber}`);
      doc.text(`Date: ${order.createdAt.toLocaleDateString()}`);
      doc.text(`Customer: ${order.customerName || 'Walk-in Customer'}`);
      if (order.customerContact) doc.text(`Contact: ${order.customerContact}`);
      doc.moveDown();

      // Items table
      const tableTop = doc.y;
      const itemWidth = size === 'a4' ? 300 : 150;
      const priceWidth = 80;
      const qtyWidth = 50;
      const totalWidth = 80;

      // Table header
      doc.font('Helvetica-Bold')
        .text('Item', 50, tableTop)
        .text('Price', 50 + itemWidth, tableTop)
        .text('Qty', 50 + itemWidth + priceWidth, tableTop)
        .text('Total', 50 + itemWidth + priceWidth + qtyWidth, tableTop);
      
      doc.moveTo(50, tableTop + 20)
        .lineTo(50 + itemWidth + priceWidth + qtyWidth + totalWidth, tableTop + 20)
        .stroke();

      // Table rows
      let y = tableTop + 30;
      order.items.forEach(item => {
        doc.font('Helvetica')
          .text(item.product.name, 50, y)
          .text(`$${item.price.toFixed(2)}`, 50 + itemWidth, y)
          .text(item.quantity.toString(), 50 + itemWidth + priceWidth, y)
          .text(`$${item.total.toFixed(2)}`, 50 + itemWidth + priceWidth + qtyWidth, y);
        y += 20;
      });

      // Summary
      y += 20;
      doc.moveTo(50, y)
        .lineTo(50 + itemWidth + priceWidth + qtyWidth + totalWidth, y)
        .stroke();
      
      y += 10;
      doc.text('Subtotal:', 50 + itemWidth + priceWidth, y)
        .text(`$${order.subtotal.toFixed(2)}`, 50 + itemWidth + priceWidth + qtyWidth, y);
      
      y += 20;
      if (order.tax > 0) {
        doc.text('Tax:', 50 + itemWidth + priceWidth, y)
          .text(`$${order.tax.toFixed(2)}`, 50 + itemWidth + priceWidth + qtyWidth, y);
        y += 20;
      }
      
      if (order.discount > 0) {
        doc.text('Discount:', 50 + itemWidth + priceWidth, y)
          .text(`-$${order.discount.toFixed(2)}`, 50 + itemWidth + priceWidth + qtyWidth, y);
        y += 20;
      }
      
      doc.font('Helvetica-Bold')
        .text('Total:', 50 + itemWidth + priceWidth, y)
        .text(`$${order.total.toFixed(2)}`, 50 + itemWidth + priceWidth + qtyWidth, y);

      // Footer
      doc.font('Helvetica').fontSize(10)
        .text('Thank you for your business!', 50, doc.page.height - 50, { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { generatePDF };