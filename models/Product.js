const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  price: { type: Number, required: true },
  costPrice: { type: Number, required: true },
  category: { type: String, required: true }, // Changed from ObjectId to String to store category name
  sku: { type: String, unique: true, sparse: true }, // sparse allows multiple null values
  barcode: { type: String },
  imageUrl: { type: String }, // Public URL from R2
  imageKey: { type: String }, // R2 object key for deletion
  stock: { type: Number, default: 0 },
  lowStockThreshold: { type: Number, default: 5 },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for better query performance
productSchema.index({ name: 1 });
productSchema.index({ category: 1 }); // Index on category name instead of ID
productSchema.index({ stock: 1 });
productSchema.index({ isActive: 1 });

// Virtual for profit margin
productSchema.virtual('profitMargin').get(function() {
  return ((this.price - this.costPrice) / this.costPrice * 100).toFixed(2);
});

// Instance method to check if stock is low
productSchema.methods.isLowStock = function() {
  return this.stock <= this.lowStockThreshold;
};

module.exports = mongoose.model('Product', productSchema);