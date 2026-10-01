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

    // Verify the conversation belongs to the admin's company
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId: admin.companyId
      },
      include: {
        customer: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Mark conversation as no longer escalated (remove from urgent queue)
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        isEscalated: false,
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    // Log the action for audit purposes
    console.log(`[URGENT-DISMISS] Admin ${admin.email} dismissed urgent conversation ${conversationId} for customer ${conversation.customer.phoneNumber}. New escalation status: ${updatedConversation.isEscalated}`);

    // Add a system message to the conversation indicating it was handled
    await prisma.message.create({
      data: {
        conversationId: conversationId,
        content: `🚨 Conversation urgente prise en charge par ${admin.email} à ${new Date().toLocaleString('fr-FR')}`,
        role: 'system',
        createdAt: new Date(),
      }
    });

    console.log(`[URGENT-DISMISS] Successfully updated conversation ${conversationId} - isEscalated: ${updatedConversation.isEscalated}`);

    return NextResponse.json({
      message: 'Conversation removed from urgent queue and moved to current conversations',
      conversation: updatedConversation,
      dismissedBy: admin.email,
      dismissedAt: new Date().toISOString(),
      escalationStatus: updatedConversation.isEscalated // Add this for debugging
    });

  } catch (error) {
    console.error('Failed to remove from urgent queue:', error);
    return NextResponse.json(
      { error: 'Failed to remove from urgent queue' },
      { status: 500 }
    );
  }
}
