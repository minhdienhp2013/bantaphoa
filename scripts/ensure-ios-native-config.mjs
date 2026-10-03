import fs from 'node:fs';

const plistPath = 'ios/App/App/Info.plist';
const appIconDir = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
const appIconParts = [
  'native-assets/ios/app-icon.base64.part01',
  'native-assets/ios/app-icon.base64.part02',
  'native-assets/ios/app-icon.base64.part03',
  'native-assets/ios/app-icon.base64.part04',
  'native-assets/ios/app-icon.base64.part05',
  'native-assets/ios/app-icon.base64.part06',
  'native-assets/ios/app-icon.base64.part07',
];

if (!fs.existsSync(plistPath)) {
  console.error(`Không tìm thấy ${plistPath}. Hãy chạy "npx cap add ios" trước.`);
  process.exit(1);
}

function applyNativePermissions() {
  let plist = fs.readFileSync(plistPath, 'utf8');

  const permissions = [
    [
      'NSCameraUsageDescription',
      'Cho phép Minh Điến sử dụng camera để quét QR và mã vạch sản phẩm.',
    ],
    [
      'NSMicrophoneUsageDescription',
      'Cho phép Minh Điến sử dụng micro để nhập liệu bằng giọng nói.',
    ],
    [
      'NSSpeechRecognitionUsageDescription',
      'Cho phép Minh Điến nhận dạng giọng nói để hỗ trợ tìm kiếm và bán hàng.',
    ],
  ];

  const additions = [];
  for (const [key, value] of permissions) {
    if (plist.includes(`<key>${key}</key>`)) continue;
    additions.push(`\t<key>${key}</key>\n\t<string>${value}</string>`);
  }

  if (additions.length === 0) {
    console.log('iOS native permissions đã có đầy đủ.');
    return;
  }

  const closing = '\n</dict>';
  if (!plist.includes(closing)) {
    console.error('Info.plist không có cấu trúc </dict> mong đợi.');
    process.exit(1);
  }

  plist = plist.replace(closing, `\n${additions.join('\n')}\n</dict>`);
  fs.writeFileSync(plistPath, plist);
  console.log(`Đã bổ sung ${additions.length} quyền native vào ${plistPath}.`);
}

function applyAppIcon() {
  for (const part of appIconParts) {
    if (!fs.existsSync(part)) {
      console.error(`Thiếu dữ liệu icon: ${part}`);
      process.exit(1);
    }
  }

  const encoded = appIconParts
    .map((part) => fs.readFileSync(part, 'utf8').trim())
    .join('');
  const png = Buffer.from(encoded, 'base64');

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length === 0 || !png.subarray(0, 8).equals(pngSignature)) {
    console.error('Dữ liệu App Icon không phải PNG hợp lệ.');
    process.exit(1);
  }

  fs.mkdirSync(appIconDir, { recursive: true });

  for (const entry of fs.readdirSync(appIconDir)) {
    if (entry.endsWith('.png')) {
      fs.rmSync(`${appIconDir}/${entry}`, { force: true });
    }
  }

  const iconFile = 'AppIcon-1024.png';
  fs.writeFileSync(`${appIconDir}/${iconFile}`, png);

  const contents = {
    images: [
      {
        filename: iconFile,
        idiom: 'universal',
        platform: 'ios',
        size: '1024x1024',
      },
    ],
    info: {
      author: 'xcode',
      version: 1,
    },
  };

  fs.writeFileSync(
    `${appIconDir}/Contents.json`,
    `${JSON.stringify(contents, null, 2)}\n`,
  );

  console.log(`Đã cập nhật App Icon Minh Điến tại ${appIconDir}.`);
}

applyNativePermissions();
applyAppIcon();
