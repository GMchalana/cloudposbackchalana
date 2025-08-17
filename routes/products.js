// routes/products.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadToR2, deleteFromR2, generatePresignedUrl } = require('../utils/cloudflare');

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Get all products with optional filters
router.get('/', async (req, res) => {
  try {
    const { category, search, lowStock } = req.query;
    let query = {};

    if (category) query.category = category;
    if (search) query.name = { $regex: search, $options: 'i' };
    if (lowStock === 'true') query.stock = { $lte: 5 };

    const products = await Product.find(query)
      .populate('category', 'name')
      .sort({ name: 1 });

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create product (admin only)
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { 
      name, 
      description, 
      price, 
      costPrice, 
      category, 
      sku, 
      barcode, 
      stock, 
      lowStockThreshold 
    } = req.body;

    // Check if category exists
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(400).json({ message: 'Category not found' });
    }

    let imageUrl = null;
    let imageKey = null;

    // Handle image upload if provided
    if (req.file) {
      const uploadResult = await uploadToR2({
        data: req.file.buffer,
        name: req.file.originalname,
        mimetype: req.file.mimetype
      });
      imageUrl = uploadResult.url;
      imageKey = uploadResult.key;
    }

    const product = new Product({
      name,
      description,
      price,
      costPrice,
      category,
      sku,
      barcode,
      stock: stock || 0,
      lowStockThreshold: lowStockThreshold || 5,
      imageUrl,
      imageKey
    });

    await product.save();
    res.status(201).json(product);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'SKU or barcode already exists' });
    } else {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
});

// Update product (admin only)
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const { 
      name, 
      description, 
      price, 
      costPrice, 
      category, 
      sku, 
      barcode, 
      stock, 
      lowStockThreshold,
      isActive,
      removeImage
    } = req.body;

    // Check if category exists
    if (category) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        return res.status(400).json({ message: 'Category not found' });
      }
    }

    const existingProduct = await Product.findById(req.params.id);
    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }

    let imageUrl = existingProduct.imageUrl;
    let imageKey = existingProduct.imageKey;

    // Handle image removal
    if (removeImage === 'true' && existingProduct.imageKey) {
      await deleteFromR2(existingProduct.imageKey);
      imageUrl = null;
      imageKey = null;
    }

    // Handle new image upload
    if (req.file) {
      // Delete old image if exists
      if (existingProduct.imageKey) {
        await deleteFromR2(existingProduct.imageKey);
      }
      
      const uploadResult = await uploadToR2({
        data: req.file.buffer,
        name: req.file.originalname,
        mimetype: req.file.mimetype
      });
      imageUrl = uploadResult.url;
      imageKey = uploadResult.key;
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { 
        name, 
        description, 
        price, 
        costPrice, 
        category, 
        sku, 
        barcode, 
        stock, 
        lowStockThreshold,
        isActive,
        imageUrl,
        imageKey,
        updatedAt: new Date() 
      },
      { new: true }
    );

    res.json(product);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'SKU or barcode already exists' });
    } else {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
});

// Upload/Update product image separately (admin only)
router.post('/:id/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Delete old image if exists
    if (product.imageKey) {
      await deleteFromR2(product.imageKey);
    }

    // Upload new image
    const uploadResult = await uploadToR2({
      data: req.file.buffer,
      name: req.file.originalname,
      mimetype: req.file.mimetype
    });

    // Update product with new image
    product.imageUrl = uploadResult.url;
    product.imageKey = uploadResult.key;
    await product.save();

    res.json({ 
      imageUrl: product.imageUrl,
      message: 'Image uploaded successfully' 
    });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading image', error: error.message });
  }
});

// Delete product image (admin only)
router.delete('/:id/image', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (!product.imageKey) {
      return res.status(400).json({ message: 'No image to delete' });
    }

    // Delete from R2
    await deleteFromR2(product.imageKey);

    // Update product
    product.imageUrl = null;
    product.imageKey = null;
    await product.save();

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting image', error: error.message });
  }
});

// Get presigned URL for direct upload (admin only)
router.post('/presigned-url', async (req, res) => {
  try {
    const { fileName, contentType } = req.body;
    
    if (!fileName || !contentType) {
      return res.status(400).json({ message: 'fileName and contentType are required' });
    }

    const result = await generatePresignedUrl(fileName, contentType);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error generating presigned URL', error: error.message });
  }
});

// Delete product (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Delete image from R2 if exists
    if (product.imageKey) {
      await deleteFromR2(product.imageKey);
    }

    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;