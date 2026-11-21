This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

### ตั้งค่าครั้งแรก

เปิด Terminal ในโฟลเดอร์โปรเจกต์นี้ แล้วรันตามลำดับ:

```bash
npm install
npm run deploy:login
npm run deploy:link
```

ล็อกอินด้วยบัญชีที่สร้างเว็บไว้ เลือกบัญชีหรือทีมที่เป็นเจ้าของโปรเจกต์
จากนั้นเลือกเชื่อมกับ **โปรเจกต์ที่มีอยู่แล้ว** ซึ่งใช้โดเมน `zombie0102.vercel.app`
(ตรวจสอบชื่อโปรเจกต์ใน Vercel Dashboard ก่อนเลือก ชื่ออาจต่างจากโดเมน)
ใช้โฟลเดอร์ปัจจุบัน `./` เป็นโฟลเดอร์โค้ด ไม่ใช่ `app/` หรือ `.next/`
ข้อมูลการเชื่อมจะอยู่ใน `.vercel/` ซึ่งถูกยกเว้นจาก Git อยู่แล้ว

### Deploy ขึ้นเว็บจริง

```bash
npm run deploy
```

คำสั่งนี้อัปโหลดโค้ดปัจจุบันในเครื่อง แล้วให้ Vercel build และเผยแพร่ไปยัง
production domain ของโปรเจกต์ที่เชื่อมไว้ ไม่จำเป็นต้อง commit หรือ push ก่อน
รอจน CLI แจ้งว่า deploy สำเร็จ แล้วเปิด URL ที่แสดงในผลลัพธ์
ครั้งถัดไปใช้ `npm run deploy` ได้เลย ไม่ต้องล็อกอินหรือเชื่อมโปรเจกต์ซ้ำ

### Deploy เพื่อทดสอบก่อนขึ้นเว็บจริง

```bash
npm run deploy:preview
```

เมื่อเชื่อมกับโปรเจกต์เดิมแล้ว คำสั่งนี้จะสร้าง Preview URL สำหรับทดสอบ
ก่อนใช้ `npm run deploy` เพื่ออัปเดตเว็บจริง

### หากยังเห็นหน้าเริ่มต้นของ Next.js

ตรวจสอบว่าเชื่อมกับโปรเจกต์ที่ใช้โดเมนข้างต้น และ Deployment ล่าสุดมีสถานะ Ready
ใน Project Settings ให้ใช้ Framework Preset เป็น Next.js และ Root Directory
เป็นรากของแอปที่มี `package.json` ถ้าเคยตั้ง Build Command เอง ให้ใช้ `npm run build`
และคืนค่า Output Directory เป็นค่าเริ่มต้นของ Next.js จากนั้น deploy อีกครั้ง

ตรวจสอบ build ในเครื่องได้ด้วย `npm run build`

อ้างอิง: [Vercel CLI deploy](https://vercel.com/docs/cli/deploy)
และ [Vercel CLI link](https://vercel.com/docs/cli/link)
