import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';

// POST - Add note to claim
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; claimNumber: string } }
) {
  try {
    // Active account, current token version; read-only roles cannot write.
    const authError = await authMiddleware(request);
    if (authError) return authError;
    const admin = getAdminFromRequest(request)!;

    const { claimNumber } = params;
    const body = await request.json();
    const { content, isInternal = false } = body;

    if (!content || !content.trim()) {
      return NextResponse.json(
        { error: 'Note content is required' },
        { status: 400 }
      );
    }

    // Verify the claim exists and belongs to the admin's company
    const claim = await prisma.claim.findFirst({
      where: {
        claimNumber: claimNumber,
        companyId: admin.companyId
      },
      include: {
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

    if (!claim) {
      return NextResponse.json(
        { success: false, error: 'Claim not found' },
        { status: 404 }
      );
    }

    // Create the claim note
    const claimNote = await prisma.claimNote.create({
      data: {
        claimId: claim.id,
        content: content.trim(),
        isInternal: Boolean(isInternal),
        authorId: admin.id
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        }
      }
    });

    // Generate and send updated PDF to customer if this is not an internal note (handled by semantic kernel)
    if (!isInternal && claim.customer?.phoneNumber) {
      console.log(`📄 [NOTE ADDED] Note added to claim ${claimNumber} - PDF will be generated automatically by next status update`);
    }

    // Format the response
    const formattedNote = {
      id: claimNote.id,
      content: claimNote.content,
      isInternal: claimNote.isInternal,
      createdAt: claimNote.createdAt.toISOString(),
      author: claimNote.author
    };

    return NextResponse.json({
      success: true,
      note: formattedNote
    });

  } catch (error) {
    console.error('Error adding claim note:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}