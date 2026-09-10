import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const inquiries = await db.inquiry.findMany();
console.log("inquiries:", inquiries.length, inquiries.map(i => `${i.name}|${i.subject}|pax:${i.pax}|resolved:${i.resolved}`));
const b = await db.booking.findFirst({ orderBy: { createdAt: "desc" } });
console.log("latest booking status field:", b ? b.status : "none");
await db.$disconnect();
