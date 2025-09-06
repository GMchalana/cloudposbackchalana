// models/Category.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  notificationType: { type: String},
  title: { type: String },
  description: { type: String},
  isView: { type: Boolean, default: false},
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notifications', notificationSchema);