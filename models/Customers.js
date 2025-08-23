// models/Category.js
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  address: { type: String },
  phoneNumber: { type: Number},
  nic: { type: Number},
  isVat: { type: Boolean, default: false},
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Customers', customerSchema);