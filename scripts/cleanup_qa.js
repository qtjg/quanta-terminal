import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const del = await p.booking.deleteMany({ where: { email: "uiround3@test.jp" } });
  console.log("deleted:", del.count);
  await p.$disconnect();
})();
