import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, corsMiddleware, securityHeadersMiddleware } from '@/lib/middleware';

interface RouteParams {
	params: { id: string };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
	const corsResponse = corsMiddleware(request);
	if (corsResponse) return corsResponse;

	const authResponse = await authMiddleware(request, { requireCompanyAccess: true });
	if (authResponse) return authResponse;

	try {
		const admin = (request as any).admin;
		const { id } = params;

		// Ensure conversation belongs to the admin's company
		const conversation = await prisma.conversation.findFirst({
			where: { id, companyId: admin.companyId },
			select: { id: true }
		});

		if (!conversation) {
			return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
		}

		await prisma.conversation.update({
			where: { id },
			data: { isBotPaused: false, pausedBy: null, pausedAt: null },
		});

		const response = NextResponse.json({ success: true });
		return securityHeadersMiddleware(response);
	} catch (error) {
		console.error('Unpause bot error:', error);
		return NextResponse.json({ error: 'Failed to unpause bot' }, { status: 500 });
	}
}
