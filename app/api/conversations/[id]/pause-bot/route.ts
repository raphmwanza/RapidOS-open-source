import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // Check authentication
  const authError = await authMiddleware(request);
  if (authError) return authError;

  try {
    const { admin } = request as any;
    const conversationId = params.id;
    const body = await request.json().catch(() => null);
    const paused = body?.paused;
    if (typeof paused !== 'boolean') {
      return NextResponse.json({ error: '"paused" must be true or false' }, { status: 400 });
    }

    // Verify the conversation belongs to the admin's company
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId: admin.companyId
      }
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Update bot pause status
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        isBotPaused: paused,
        pausedBy: paused ? admin.id : null,
        pausedAt: paused ? new Date() : null,
      },
      include: {
        customer: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    return NextResponse.json({
      message: `Bot ${paused ? 'paused' : 'resumed'} successfully`,
      conversation: updatedConversation
    });

  } catch (error) {
    console.error('Failed to toggle bot pause:', error);
    return NextResponse.json(
      { error: 'Failed to toggle bot pause' },
      { status: 500 }
    );
  }
}
