// models/Order.js
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  total: { type: Number, required: true }
});

// Embedded customer schema to store customer data directly in order
const embeddedCustomerSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customers' }, // Optional reference for linking
  name: { type: String, required: true },
  address: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  nic: { type: String, default: '' },
  isVat: { type: Boolean, default: false }
}, { _id: false }); // Don't create _id for embedded document

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  items: [orderItemSchema],
  subtotal: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  paymentMethod: { type: String, enum: ['cash', 'card', 'transfer'], required: true },
  status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'completed' },
  
  // Customer information stored directly in order
  customer: {
    type: embeddedCustomerSchema,
    default: null // Allow orders without customer
  },
  
  // Legacy fields for backward compatibility (can be removed later)
  customerName: { type: String },
  customerContact: { type: String },
  
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for better performance
orderSchema.index({ 'customer.name': 1 });
orderSchema.index({ 'customer.phoneNumber': 1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);