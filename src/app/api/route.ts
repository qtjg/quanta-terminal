import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "quanta-terminal",
    time: new Date().toISOString(),
  });
}
