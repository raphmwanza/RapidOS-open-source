import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; claimNumber: string } }
) {
  const authError = await authMiddleware(request);
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get the claim from the database
    const claim = await prisma.claim.findFirst({
      where: { claimNumber: params.claimNumber, companyId: admin.companyId },
      include: {
        documents: {
          select: { id: true, fileName: true, fileType: true, fileSize: true, uploadedBy: true, createdAt: true },
          orderBy: {
            createdAt: 'desc'
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

    // Format documents for frontend display
    const documents = claim.documents.map((doc: any) => {
      const isImage = doc.fileType.startsWith('image/');
      const isPDF = doc.fileType === 'application/pdf';
      
      return {
        id: doc.id,
        fileName: doc.fileName,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        uploadedBy: doc.uploadedBy,
        createdAt: doc.createdAt,
        category: isImage ? 'image' : isPDF ? 'pdf' : 'document',
        // Every document (uploaded PDFs too) is served from its own bytes.
        previewUrl: `/api/documents/${claim.id}/${doc.id}`,
        downloadUrl: `/api/documents/${claim.id}/${doc.id}?download=1`,
        canPreview: isImage || isPDF,
        icon: getFileIcon(doc.fileType)
      };
    });

    // Separate by category for easier handling
    const categorized = {
      images: documents.filter((doc: any) => doc.category === 'image'),
      pdfs: documents.filter((doc: any) => doc.category === 'pdf'),
      documents: documents.filter((doc: any) => doc.category === 'document'),
      all: documents
    };

    return NextResponse.json({
      success: true,
      claim: {
        id: claim.id,
        claimNumber: claim.claimNumber,
        type: claim.type,
        status: claim.status
      },
      documents: categorized,
      totalCount: documents.length
    });

  } catch (error) {
    console.error('Documents fetch error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}

// Helper function to get file icon based on file type
function getFileIcon(fileType: string): string {
  if (fileType.startsWith('image/')) {
    return 'image';
  } else if (fileType === 'application/pdf') {
    return 'pdf';
  } else if (fileType.includes('word') || fileType.includes('document')) {
    return 'document';
  } else if (fileType.includes('spreadsheet') || fileType.includes('excel')) {
    return 'spreadsheet';
  } else if (fileType.includes('presentation') || fileType.includes('powerpoint')) {
    return 'presentation';
  } else {
    return 'file';
  }
}