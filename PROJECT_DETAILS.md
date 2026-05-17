# Photobss System Details

เอกสารนี้เก็บรายละเอียดระบบแบบไม่ใส่รหัสลับ ใช้สำหรับกลับมาดูภายหลังว่าเว็บรันอย่างไรและต้องดูแลจุดไหนบ้าง

## สถานะปัจจุบัน

- เว็บรันบน Cloudflare Workers Free
- ข้อมูลกิจกรรมและรายการรูปเก็บใน Cloudflare KV
- ไฟล์รูปจริงเก็บใน Google Drive
- หน้า admin ใช้สำหรับสร้างกิจกรรม อัปโหลดรูป ลบรูป ลบโฟลเดอร์ และจัดการลิงก์แชร์
- หน้า user ใช้ค้นหารูปจากใบหน้า และเปิดโฟลเดอร์ Drive ของกิจกรรมที่เลือก

## เว็บจะหลับไหม

ไม่หลับตามคอมของเรา เพราะ Cloudflare Workers รันอยู่บน cloud ของ Cloudflare

ปิดคอม ปิด VS Code หรือปิด PowerShell ได้ เว็บยังออนไลน์อยู่ตามปกติ สิ่งที่จะหยุดมีแค่ server local เวลาทดสอบบนเครื่อง เช่น `localhost`

ถ้า `wrangler deploy` แจ้งว่ายังไม่มี `workers.dev subdomain` ให้ register subdomain ใน Cloudflare หนึ่งครั้งก่อน หลังจากนั้น deploy รอบต่อไปจะ publish ได้ปกติ

## ไฟล์สำคัญ

- `cloudflare-worker.mjs` คือ server ที่รันบน Cloudflare Workers
- `wrangler.toml` คือ config สำหรับ deploy Cloudflare
- `.assetsignore` คือรายการไฟล์ที่อนุญาตให้ส่งขึ้นเป็น static assets
- `admin.html` คือหน้า admin
- `user.html` คือหน้า user
- `app.js` คือ logic ฝั่งหน้าเว็บ
- `styles.css` คือหน้าตาเว็บ
- `DEPLOY_CLOUDFLARE.md` คือคู่มือ deploy ทีละขั้น

## ค่า secret ที่อยู่ใน Cloudflare

ค่าเหล่านี้ไม่ควรใส่ใน GitHub หรือไฟล์ public:

- `ADMIN_PASSWORD`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_DRIVE_REFRESH_TOKEN` ถ้ามี

ถ้าต้องเปลี่ยนค่า ใช้คำสั่ง:

```powershell
wrangler secret put ชื่อ_SECRET
```

## วิธี deploy หลังแก้โค้ด

```powershell
npm run check
git add .
git commit -m "update site"
git push
wrangler deploy
```

ถ้าแก้แค่ secret ไม่ต้อง commit ให้ใช้ `wrangler secret put ...` แล้ว `wrangler deploy`

## ข้อควรระวัง

- ห้าม commit `googleDriveConfig.json`, `.env.*`, `data/google-drive-config.json` หรือไฟล์ key ของ Google
- ถ้าเผลอเอา secret ขึ้น GitHub ให้สร้าง secret/key ใหม่ใน Google Cloud และ Cloudflare
- KV namespace id ใน `wrangler.toml` ไม่ใช่รหัสลับ แต่ควรเก็บไว้ให้ตรงกับโปรเจกต์
