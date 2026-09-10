import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const b = await db.booking.deleteMany({ where: { email: { in: ["qa-v11@example.com"] } } });
const i = await db.inquiry.deleteMany({ where: { email: { in: ["qa-test@example.com", "mayank.group@example.com"] } } });
console.log(`removed ${b.count} QA booking(s), ${i.count} QA inquiry(ies)`);
const left = await db.booking.findMany({ select: { id: true, status: true, total: true } });
console.log("remaining bookings:", left);
await db.$disconnect();
