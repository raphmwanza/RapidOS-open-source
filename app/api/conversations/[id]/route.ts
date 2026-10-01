import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { 
  authMiddleware, 
  corsMiddleware, 
  securityHeadersMiddleware, 
  validateInput 
} from '@/lib/middleware';
import { MODERATION_ROLES } from '@/lib/users/roles';
import { uuidSchema, paginationSchema } from '@/lib/validation';

interface RouteParams {
  params: {
    id: string;
  };
}

// GET - Get conversation with messages
export async function GET(request: NextRequest, { params }: RouteParams) {
  const corsResponse = corsMiddleware(request);
  if (corsResponse) return corsResponse;

  const authResponse = await authMiddleware(request, { requireCompanyAccess: true });
  if (authResponse) return authResponse;

  try {
    const admin = (request as any).admin;
    const { id } = params;
    const { searchParams } = new URL(request.url);

    // Validate UUID
    const uuidValidation = validateInput(uuidSchema, id);
    if (!uuidValidation.isValid) {
      return NextResponse.json(
        { error: 'Invalid conversation ID format' },
        { status: 400 }
      );
    }

    // Validate pagination for messages
    const paginationData = {
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '200'),
      sortBy: 'createdAt',
      sortOrder: searchParams.get('sortOrder') || 'asc'  // Chronological order so full conversation renders correctly
    };

    // The detail page loads up to 200 messages at once; the shared schema caps at 100.
    const validation = validateInput(paginationSchema.fork(['limit'], (s: any) => s.max(200)), paginationData);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters', details: validation.errors },
        { status: 400 }
      );
    }

    const { page, limit, sortOrder } = paginationData;
    const skip = (page - 1) * limit;

    // Get conversation with customer info
    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        companyId: admin.companyId
      },
      select: {
        id: true,
        title: true,
        isActive: true,
        isEscalated: true,
        isBotPaused: true,
        pausedBy: true,
        pausedAt: true,
        createdAt: true,
        updatedAt: true,
        customer: {
          select: {
            id: true,
            phoneNumber: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Get messages with pagination
    const [messages, totalMessages] = await Promise.all([
      prisma.message.findMany({
        where: {
          conversationId: id
        },
        select: {
          id: true,
          content: true,
          role: true,
          metadata: true,
          createdAt: true
        },
        orderBy: { createdAt: sortOrder as any },
        skip,
        take: limit
      }),
      prisma.message.count({
        where: {
          conversationId: id
        }
      })
    ]);

    const totalPages = Math.ceil(totalMessages / limit);

    const response = NextResponse.json({
      conversation: {
        ...conversation,
        messages
      },
      pagination: {
        currentPage: page,
        totalPages,
        totalCount: totalMessages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });

    return securityHeadersMiddleware(response);

  } catch (error) {
    console.error('Get conversation error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversation' },
      { status: 500 }
    );
  }
}

// PUT - Update conversation (e.g., title, status)
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const corsResponse = corsMiddleware(request);
  if (corsResponse) return corsResponse;

  const authResponse = await authMiddleware(request, { requireCompanyAccess: true });
  if (authResponse) return authResponse;

  try {
    const admin = (request as any).admin;
    const { id } = params;
    const body = await request.json();

    // Validate UUID
    const uuidValidation = validateInput(uuidSchema, id);
    if (!uuidValidation.isValid) {
      return NextResponse.json(
        { error: 'Invalid conversation ID format' },
        { status: 400 }
      );
    }

    // Get existing conversation
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        id,
        companyId: admin.companyId
      }
    });

    if (!existingConversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Update conversation
    const allowedFields = ['title', 'isActive'];
    const updateData: any = {};
    
    Object.keys(body).forEach(key => {
      if (allowedFields.includes(key)) {
        updateData[key] = body[key];
      }
    });

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const updatedConversation = await prisma.conversation.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        title: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        customer: {
          select: {
            id: true,
            phoneNumber: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    const response = NextResponse.json(
      {
        message: 'Conversation updated successfully',
        conversation: updatedConversation
      }
    );

    return securityHeadersMiddleware(response);

  } catch (error) {
    console.error('Update conversation error:', error);
    return NextResponse.json(
      { error: 'Failed to update conversation' },
      { status: 500 }
    );
  }
}

// DELETE - Archive conversation
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const corsResponse = corsMiddleware(request);
  if (corsResponse) return corsResponse;

  const authResponse = await authMiddleware(request, { 
    requireCompanyAccess: true,
    requiredRole: [...MODERATION_ROLES]
  });
  if (authResponse) return authResponse;

  try {
    const admin = (request as any).admin;
    const { id } = params;

    // Validate UUID
    const uuidValidation = validateInput(uuidSchema, id);
    if (!uuidValidation.isValid) {
      return NextResponse.json(
        { error: 'Invalid conversation ID format' },
        { status: 400 }
      );
    }

    // Get existing conversation
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        id,
        companyId: admin.companyId
      }
    });

    if (!existingConversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Soft delete by setting isActive to false
    await prisma.conversation.update({
      where: { id },
      data: { isActive: false }
    });

    const response = NextResponse.json(
      { message: 'Conversation archived successfully' }
    );

    return securityHeadersMiddleware(response);

  } catch (error) {
    console.error('Delete conversation error:', error);
    return NextResponse.json(
      { error: 'Failed to archive conversation' },
      { status: 500 }
    );
  }
}
