const express = require('express');
const router = express.Router();
const Notification = require('../models/Notifications');
const { authenticate, authorize } = require('../middleware/auth');

router.post('/', async (req, res) => {
  try {
    const { notificationType, title, description } = req.body;
    const notification = new Notification({ notificationType, title, description });
    await notification.save();
    res.status(201).json(notification);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'Notification already exists' });
    } else {
      res.status(500).json({ message: 'Server error' });
    }
  }
});

router.get('/', async (req, res) => {
  try {
    const notifications = await Notification.find().sort({ createdAt: 1 });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});


// PATCH mark single notification as viewed
router.patch('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    
    const notification = await Notification.findByIdAndUpdate(
      id,
      { isView: true, updatedAt: new Date() },
      { new: true }
    );
    
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    
    res.json({ 
      message: 'Notification marked as viewed',
      notification 
    });
  } catch (error) {
    console.error('Error marking notification as viewed:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid notification ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH mark all notifications as viewed
router.patch('/mark-all-viewed', async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { isView: false },
      { 
        isView: true, 
        updatedAt: new Date() 
      }
    );
    
    res.json({ 
      message: 'All notifications marked as viewed',
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error('Error marking all notifications as viewed:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET unread notifications count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await Notification.countDocuments({ isView: false });
    res.json({ unreadCount: count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE notification by ID
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const notification = await Notification.findByIdAndDelete(id);
    
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid notification ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE all viewed notifications
router.delete('/clear-viewed', async (req, res) => {
  try {
    const result = await Notification.deleteMany({ isView: true });
    
    res.json({ 
      message: 'All viewed notifications cleared',
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error('Error clearing viewed notifications:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;