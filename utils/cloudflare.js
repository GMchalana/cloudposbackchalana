const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

// Initialize S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL; // Your R2 custom domain or public URL

// Upload file to R2
const uploadToR2 = async (file, folder = 'products') => {
  try {
    // Generate unique filename
    const fileExtension = file.name.split('.').pop();
    const uniqueId = crypto.randomUUID();
    const fileName = `${folder}/${uniqueId}.${fileExtension}`;

    console.log('Uploading file:', fileName); // Debug log

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: file.data,
      ContentType: file.mimetype,
      Metadata: {
        originalName: file.name,
      },
    });

    const result = await s3Client.send(command);
    console.log('Upload result:', result); // Debug log

    // Return the public URL - Make sure this is accessible
 const publicUrl = `${PUBLIC_URL}/${fileName}`;
    
    console.log('Generated public URL:', publicUrl); // Debug log

    return {
      success: true,
      url: publicUrl,
      key: fileName,
      originalName: file.name,
    };
  } catch (error) {
    console.error('Error uploading to R2:', error);
    throw new Error('Failed to upload image');
  }
};

// Delete file from R2
const deleteFromR2 = async (key) => {
  try {
    console.log('Deleting file:', key); // Debug log
    
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    console.log('File deleted successfully:', key); // Debug log
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting from R2:', error);
    throw new Error('Failed to delete image');
  }
};

// Generate presigned URL for direct upload (optional)
const generatePresignedUrl = async (fileName, contentType, folder = 'products') => {
  try {
    const key = `${folder}/${crypto.randomUUID()}.${fileName.split('.').pop()}`;
    
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

    return {
      signedUrl,
      key,
      publicUrl: `${PUBLIC_URL}/${key}`,
    };
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw new Error('Failed to generate upload URL');
  }
};

// Test function to verify R2 connection and public access
const testR2Connection = async () => {
  try {
    // Test upload
    const testFile = {
      name: 'test.txt',
      data: Buffer.from('test content'),
      mimetype: 'text/plain'
    };
    
    const result = await uploadToR2(testFile, 'test');
    console.log('Test upload successful:', result.url);
    
    // Test if URL is accessible
    const response = await fetch(result.url);
    console.log('Public URL accessible:', response.ok);
    
    // Clean up test file
    await deleteFromR2(result.key);
    console.log('Test cleanup successful');
    
    return true;
  } catch (error) {
    console.error('R2 connection test failed:', error);
    return false;
  }
};

module.exports = {
  uploadToR2,
  deleteFromR2,
  generatePresignedUrl,
  testR2Connection
};