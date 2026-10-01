import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request);
  if (authError) return authError;

  try {
    const { admin } = request as any;
    
    // Get clients with their claims and claim notes
    const clients = await prisma.customer.findMany({
      where: { companyId: admin.companyId },
      include: {
        claims: {
          include: {
            claimNotes: {
              include: {
                author: {
                  select: {
                    firstName: true,
                    lastName: true,
                    email: true
                  }
                }
              },
              orderBy: {
                createdAt: 'asc'
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform the data to match the expected format
    const transformedClients = clients.map((client: any) => ({
      id: client.id,
      phoneNumber: client.phoneNumber,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email || '',
      isActive: client.isActive,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
      claims: client.claims.map((claim: any) => ({
        id: claim.id,
        claimNumber: claim.claimNumber,
        status: claim.status,
        type: claim.type,
        description: claim.description,
        amount: claim.estimatedAmount,
        createdAt: claim.createdAt.toISOString(),
        updatedAt: claim.updatedAt.toISOString(),
        notes: claim.claimNotes.map((note: any) => ({
          id: note.id,
          content: note.content,
          createdAt: note.createdAt.toISOString(),
          author: {
            firstName: note.author.firstName,
            lastName: note.author.lastName,
            email: note.author.email
          }
        }))
      }))
    }));
    
    return NextResponse.json({
      success: true,
      clients: transformedClients
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch clients' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Check authentication
  const authError = await authMiddleware(request);
  if (authError) return authError;

  try {
    const { admin } = request as any;
  const body = await request.json();
  const { claimId, content } = body;
    
    // Validate required fields
    if (!claimId || !content) {
      return NextResponse.json(
        { success: false, error: 'claimId and content are required' },
        { status: 400 }
      );
    }

    // Verify the claim belongs to the admin's company
    const claim = await prisma.claim.findFirst({
      where: {
        id: claimId,
        companyId: admin.companyId
      }
    });

    if (!claim) {
      return NextResponse.json(
        { success: false, error: 'Claim not found' },
        { status: 404 }
      );
    }

    // Create the note
    const newNote = await prisma.claimNote.create({
      data: {
        content,
        claimId,
        authorId: admin.id
      },
      include: {
        author: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });
    
    return NextResponse.json({
      success: true,
      note: {
        id: newNote.id,
        content: newNote.content,
        createdAt: newNote.createdAt.toISOString(),
        author: {
          firstName: newNote.author.firstName,
          lastName: newNote.author.lastName,
          email: newNote.author.email
        }
      }
    });
  } catch (error) {
    console.error('Error adding note:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add note' },
      { status: 500 }
    );
  }
}
