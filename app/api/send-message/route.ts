import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { companyCallingCode } from '@/lib/customers/upsert';
import { normalizePhoneE164, phoneLookupVariants } from '@/lib/phone';
import { 
  authMiddleware, 
  corsMiddleware, 
  securityHeadersMiddleware, 
  validateInput,
  companyContextMiddleware,
  getBackendInternalHeaders
} from '@/lib/middleware';
import { sendMessageSchema } from '@/lib/validation';

export async function POST(request: NextRequest) {
  const corsResponse = corsMiddleware(request);
  if (corsResponse) return corsResponse;

  const authResponse = await authMiddleware(request, { requireCompanyAccess: true });
  if (authResponse) return authResponse;

  try {
    const admin = (request as any).admin;
    const body = await request.json();
    
    // Validate input
    const validation = validateInput(sendMessageSchema, body);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.errors },
        { status: 400 }
      );
    }

    const { conversationId, customerId, phoneNumber, content, message: messageText, source } = body;
    // Determine role: admins send as 'agent', otherwise default to 'assistant' unless explicitly provided
    let role: 'assistant' | 'agent' | 'user' = body.role as any;
    if (!role) {
      role = source === 'admin' ? 'agent' : 'assistant';
    }

    // Support both 'content' and 'message' fields for backwards compatibility
    const messageContent = content || messageText;

    if (!messageContent) {
      return NextResponse.json(
        { error: 'Message content is required' },
        { status: 400 }
      );
    }

    let customer;
    let conversation;

    // If phoneNumber is provided, find customer by phone
    if (phoneNumber) {
      const e164 = normalizePhoneE164(phoneNumber, await companyCallingCode(admin.companyId));
      customer = !e164 ? null : await prisma.customer.findFirst({
        where: {
          phoneNumber: { in: phoneLookupVariants(e164) },
          companyId: admin.companyId,
          isActive: true
        }
      });

      if (!customer) {
        return NextResponse.json(
          { error: 'Customer not found with this phone number' },
          { status: 404 }
        );
      }

      // Find the most recent conversation for this customer
      conversation = await prisma.conversation.findFirst({
        where: {
          customerId: customer.id,
          companyId: admin.companyId,
          isActive: true
        },
        orderBy: {
          updatedAt: 'desc'
        }
      });

      if (!conversation) {
        // Create new conversation if none exists
        conversation = await prisma.conversation.create({
          data: {
            customerId: customer.id,
            companyId: admin.companyId,
            title: `Conversation with ${customer.firstName && customer.lastName ? `${customer.firstName} ${customer.lastName}` : (customer.firstName || customer.phoneNumber)}`
          }
        });
      }
    } else if (customerId) {
      // Original logic for customerId
      customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          companyId: admin.companyId,
          isActive: true
        }
      });

      if (!customer) {
        return NextResponse.json(
          { error: 'Customer not found or not accessible' },
          { status: 404 }
        );
      }

      // If conversationId is provided, verify it exists and belongs to the customer
      if (conversationId) {
        conversation = await prisma.conversation.findFirst({
          where: {
            id: conversationId,
            customerId,
            companyId: admin.companyId,
            isActive: true
          }
        });

        if (!conversation) {
          return NextResponse.json(
            { error: 'Conversation not found or not accessible' },
            { status: 404 }
          );
        }
      } else {
        // Create new conversation
        conversation = await prisma.conversation.create({
          data: {
            customerId,
            companyId: admin.companyId,
            title: `Conversation with ${customer.firstName && customer.lastName ? `${customer.firstName} ${customer.lastName}` : (customer.firstName || customer.phoneNumber)}`
          }
        });
      }
    } else {
      return NextResponse.json(
        { error: 'Either phoneNumber or customerId is required' },
        { status: 400 }
      );
    }

    // Get company context
    const companyContext = await companyContextMiddleware(request, admin.companyId);
    if (companyContext instanceof NextResponse) return companyContext;
    const { company } = companyContext;

    // Create the message
    const createdMessage = await prisma.message.create({
      data: {
        content: messageContent,
        role: role as any,
        conversationId: conversation.id,
        metadata: {
          sentBy: 'admin',
          adminId: admin.id,
          timestamp: new Date().toISOString()
        }
      },
      select: {
        id: true,
        content: true,
        role: true,
        createdAt: true,
        metadata: true
      }
    });

    // Update conversation's updatedAt timestamp
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() }
    });

  // Prepare backend payload for external chatbot/WhatsApp integration
    const backendPayload = {
      conversationId: conversation.id,
      customerId,
      companyId: admin.companyId,
      companySlug: company.slug,
      message: messageContent,
  role,
      source: 'admin',
      adminId: admin.id,
      customerPhone: customer.phoneNumber
    };

  // Send to Go backend for WhatsApp/chatbot processing
    const backendUrl = (await import('@/lib/apiConfig')).getBackendUrl();
    
    console.log('Attempting to send to backend:', backendUrl);
    
    try {
      let backendHeaders: Record<string, string>;
      try {
        backendHeaders = getBackendInternalHeaders(admin.companyId);
      } catch {
        return NextResponse.json(
          { error: 'Backend API key not configured' },
          { status: 500 }
        );
      }

      const backendResponse = await fetch(`${backendUrl}/api/v1/internal/send-message`, {
        method: 'POST',
        headers: backendHeaders,
        body: JSON.stringify(backendPayload),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      console.log('Backend response status:', backendResponse.status);

      if (!backendResponse.ok) {
        const errorText = await backendResponse.text();
        console.error('Backend response error:', errorText);
        return NextResponse.json(
          { error: `Failed to send WhatsApp message: ${errorText}` },
          { status: 500 }
        );
      } else {
        console.log('✅ WhatsApp message sent successfully via Go backend');
      }
    } catch (backendError) {
      console.error('Backend communication error:', backendError);
      // Log more details about the error
      if (backendError instanceof Error) {
        console.error('Error name:', backendError.name);
        console.error('Error message:', backendError.message);
        console.error('Error stack:', backendError.stack);
      }
      return NextResponse.json(
        { error: 'Failed to communicate with WhatsApp backend' },
        { status: 500 }
      );
    }

    const response = NextResponse.json(
      {
        message: 'Message sent successfully',
        data: {
          messageId: createdMessage.id,
          conversationId: conversation.id,
          message: createdMessage,
          conversation: {
            id: conversation.id,
            title: conversation.title,
            customerId: conversation.customerId
          }
        }
      },
      { status: 201 }
    );

    return securityHeadersMiddleware(response);
    
  } catch (error) {
    console.error('Send message error:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}
