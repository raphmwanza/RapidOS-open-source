import { NextRequest, NextResponse } from 'next/server';

// Minimal stub to satisfy Next.js route module requirements.
// This can be expanded to handle WhatsApp media association with a claim.

export async function GET() {
	return NextResponse.json({ ok: true });
}

export async function POST(
	request: NextRequest,
	ctx: { params: { claimNumber: string } }
) {
	try {
		const { claimNumber } = ctx.params || ({} as any);
		const body = await request.json().catch(() => ({}));
		return NextResponse.json({ success: true, claimNumber, received: body });
	} catch (err) {
		return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
	}
}

