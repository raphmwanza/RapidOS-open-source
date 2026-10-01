import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';

// Function to determine if a conversation needs agent attention
function needsAgentAttention(lastMessage: string): boolean {
  const agentKeywords = [
    'talk to an agent',
    'speak to someone',
    'human help',
    'customer service',
    'representative',
    'agent',
    'help me',
    'complaint',
    'urgent',
    'emergency',
    'escalate',
    'manager',
    'supervisor',
    'problème',
    'aide humaine',
    'parler à quelqu\'un',
    'service client',
    'représentant',
    'plainte',
    'urgence'
  ];
  
  return agentKeywords.some(keyword => 
    lastMessage.toLowerCase().includes(keyword.toLowerCase())
  );
}

export async function GET(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request);
  if (authError) return authError;

  try {
    const { admin } = request as any;
    
    // Test database connection first
    try {
      await prisma.$connect();
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503 }
      );
    }

    // Always return recent active conversations without keyword-based filtering
    const customers = await prisma.customer.findMany({
      where: { companyId: admin.companyId },
      include: {
        conversations: {
          where: { isActive: true },
          include: {
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    const processed = customers
      .filter((c: any) => c.conversations.length > 0)
      .map((customer: any) => {
        const conversation = customer.conversations[0];
        const lastMessage = conversation?.messages[0] || null;
        const needsAttention = lastMessage ? needsAgentAttention(lastMessage.content) : false;
        return {
          ...customer,
          lastMessage,
          needsAttention,
          conversationMeta: {
            id: conversation.id,
            isEscalated: conversation.isEscalated,
            isBotPaused: conversation.isBotPaused,
            pausedBy: conversation.pausedBy,
            pausedAt: conversation.pausedAt,
          },
        };
      });

    console.log(`Returning ${processed.length} conversations for company ${admin.companyId}`);

    return NextResponse.json({
      customers: processed,
      total: processed.length,
    });

  } catch (error) {
    console.error('Failed to fetch conversations:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch conversations',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  } finally {
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error('Failed to disconnect from database:', disconnectError);
    }
  }
}

export async function POST(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request);
  if (authError) return authError;

  try {
    const { admin } = request as any;
    const body = await request.json();
    
    const {
      customerId,
      title
    } = body;

    const conversation = await prisma.conversation.create({
      data: {
        customerId,
        title: title || undefined,
        companyId: admin.companyId
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true
          }
        },
        messages: true
      }
    });

    // If no explicit title, backfill a human-friendly title using name or phone
    if (!conversation.title) {
      const displayName = conversation.customer.firstName && conversation.customer.lastName
        ? `${conversation.customer.firstName} ${conversation.customer.lastName}`
        : conversation.customer.phoneNumber;
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { title: `Conversation with ${displayName}` }
      });
      conversation.title = `Conversation with ${displayName}` as any;
    }

    return NextResponse.json({
      message: 'Conversation created successfully',
      conversation
    });

  } catch (error) {
    console.error('Failed to create conversation:', error);
    return NextResponse.json(
      { error: 'Failed to create conversation' },
      { status: 500 }
    );
  }
}
