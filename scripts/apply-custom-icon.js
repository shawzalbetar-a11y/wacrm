const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const srcImagePath = 'C:/Users/KDLO-X0X/.gemini/antigravity-ide/brain/87dc331f-c027-4444-b393-9b937923cdc5/.user_uploaded/media_1788906261081.jpg';
const iconsDir = path.join(__dirname, '../public/icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

async function processIcons() {
  console.log('Processing custom icon from:', srcImagePath);
  
  // 192x192 PNG for PWA & Android
  await sharp(srcImagePath)
    .resize(192, 192)
    .png()
    .toFile(path.join(iconsDir, 'icon-192x192.png'));

  // 512x512 PNG for PWA splash & Android high-res
  await sharp(srcImagePath)
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon-512x512.png'));

  // Apple Touch Icon
  await sharp(srcImagePath)
    .resize(180, 180)
    .png()
    .toFile(path.join(iconsDir, 'apple-touch-icon.png'));

  // Save in public as logo
  await sharp(srcImagePath)
    .resize(512, 512)
    .png()
    .toFile(path.join(__dirname, '../public/app-logo.png'));

  // Small favicon 32x32 in public
  await sharp(srcImagePath)
    .resize(32, 32)
    .png()
    .toFile(path.join(iconsDir, 'favicon-32x32.png'));

  console.log('Successfully generated all icon assets!');
}

processIcons().catch(err => {
  console.error('Error processing icon:', err);
});
