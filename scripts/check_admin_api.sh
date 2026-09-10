#!/bin/bash
set -e
BASE=http://localhost:3000
CJ=/tmp/vt-cookies.txt

# 1) login → cookie jar
curl -s -c $CJ -X POST $BASE/api/admin/login -H "Content-Type: application/json" -d '{"pin":"2026"}' | head -c 120; echo " <- login"

# 2) latest booking id from db via API? admin page is SSR; instead grab from db file using sqlite through node is heavy — use booking PATCH with id from db query:
ID=$(bun -e 'import {PrismaClient} from "@prisma/client"; const db=new PrismaClient(); const b=await db.booking.findFirst({orderBy:{createdAt:"desc"}}); console.log(b.id); await db.$disconnect();')
echo "booking id: $ID"

# 3) cycle status PENDING → CONFIRMED
curl -s -b $CJ -X PATCH $BASE/api/admin/bookings -H "Content-Type: application/json" -d "{\"id\":\"$ID\",\"status\":\"CONFIRMED\"}"; echo " <- patch confirmed"

# 4) inquiries PATCH + DELETE round-trip
IQ=$(bun -e 'import {PrismaClient} from "@prisma/client"; const db=new PrismaClient(); const i=await db.inquiry.findFirst({orderBy:{createdAt:"desc"}}); console.log(i.id); await db.$disconnect();')
curl -s -b $CJ -X PATCH $BASE/api/admin/inquiries -H "Content-Type: application/json" -d "{\"id\":\"$IQ\",\"resolved\":true}"; echo " <- inquiry resolved"
curl -s -b $CJ -X PATCH $BASE/api/admin/bookings -H "Content-Type: application/json" -d "{\"id\":\"$ID\",\"status\":\"PENDING\"}"; echo " <- patch back to pending (leave clean)"
