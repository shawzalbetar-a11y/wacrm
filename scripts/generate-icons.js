const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const svg192 = `<svg width="192" height="192" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
  <rect width="192" height="192" rx="40" fill="#7c3aed"/>
  <path d="M145 110a12 12 0 0 1-12 12H62l-25 25V45a12 12 0 0 1 12-12h86a12 12 0 0 1 12 12z" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="75" cy="78" r="6" fill="#ffffff"/>
  <circle cx="96" cy="78" r="6" fill="#ffffff"/>
  <circle cx="117" cy="78" r="6" fill="#ffffff"/>
</svg>`;

const svg512 = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="100" fill="#7c3aed"/>
  <path d="M386 293a32 32 0 0 1-32 32H165l-67 67V120a32 32 0 0 1 32-32h230a32 32 0 0 1 32 32z" fill="none" stroke="#ffffff" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="200" cy="208" r="16" fill="#ffffff"/>
  <circle cx="256" cy="208" r="16" fill="#ffffff"/>
  <circle cx="312" cy="208" r="16" fill="#ffffff"/>
</svg>`;

async function run() {
  await sharp(Buffer.from(svg192)).png().toFile(path.join(iconsDir, 'icon-192x192.png'));
  await sharp(Buffer.from(svg512)).png().toFile(path.join(iconsDir, 'icon-512x512.png'));
  await sharp(Buffer.from(svg192)).png().toFile(path.join(iconsDir, 'apple-touch-icon.png'));
  console.log('Successfully generated PWA icons in public/icons/');
}

run().catch(console.error);
