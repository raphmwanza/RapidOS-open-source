/**
 * Media Upload API for Claims
 * Handles image and document uploads for claims
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { storeClaimDocument, validateUpload } from '@/lib/storage/documents';
import { generateAndStoreClaimPdf } from '@/lib/pdf/claimPdfService';

// Validation schema for media upload
const mediaUploadSchema = z.object({
  claimId: z.string().uuid(),
  files: z.array(z.object({
    name: z.string(),
    type: z.string(),
    size: z.number().max(10 * 1024 * 1024), // 10MB limit
    data: z.string() // base64 encoded file data
  })).max(10) // Maximum 10 files per upload
});

export async function POST(request: NextRequest) {
  const authError = await authMiddleware(request);
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[MEDIA][UPLOAD] Processing media upload request');
    
    const body = await request.json();
    const validatedData = mediaUploadSchema.parse(body);
    
    console.log(`[MEDIA][UPLOAD] Uploading ${validatedData.files.length} files for claim ${validatedData.claimId}`);

    // Verify claim exists
    const claim = await prisma.claim.findFirst({
      where: { id: validatedData.claimId, companyId: admin.companyId },
      include: { customer: true, company: true }
    });

    if (!claim) {
      return NextResponse.json(
        { error: 'Claim not found' },
        { status: 404 }
      );
    }

    const uploadedFiles: any[] = [];
    const errors: string[] = [];

    // Process each file
    for (let i = 0; i < validatedData.files.length; i++) {
      const file = validatedData.files[i];
      
      try {
        const raw = Buffer.from(file.data.includes(',') ? file.data.split(',')[1] : file.data, 'base64');
        const upload = validateUpload(raw, file.type, file.name, 'document');
        if (!upload.ok) {
          errors.push(`File ${file.name}: ${upload.error}`);
          continue;
        }
        const fileCategory = upload.mimeType.startsWith('image/') ? 'image' : 'document';
        const claimDocument = await storeClaimDocument({
          companyId: admin.companyId,
          claimId: claim.id,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          data: upload.data,
          uploadedBy: admin.id,
        });
        const relativePath = `/api/documents/${claim.id}/${claimDocument.id}`;

        uploadedFiles.push({
          id: claimDocument.id,
          fileName: claimDocument.fileName,
          filePath: relativePath,
          fileType: claimDocument.fileType,
          fileSize: claimDocument.fileSize,
          category: fileCategory,
          uploadedAt: claimDocument.createdAt
        });

        console.log(`[MEDIA][UPLOAD] Successfully uploaded ${file.name} for claim ${claim.claimNumber}`);

      } catch (fileError) {
        console.error(`[MEDIA][UPLOAD] Error processing file ${file.name}:`, fileError);
        errors.push(`File ${file.name}: ${fileError instanceof Error ? fileError.message : 'Unknown error'}`);
      }
    }

    // Update auto claim data with photo count if it's an auto claim
    if (claim.type === 'AUTO') {
      const totalPhotos = await prisma.claimDocument.count({
        where: { 
          claimId: claim.id,
          fileType: { startsWith: 'image/' }
        }
      });

      await prisma.autoClaimData.updateMany({
        where: { claimId: claim.id },
        data: { totalPhotosUploaded: totalPhotos }
      });

      console.log(`[MEDIA][UPLOAD] Updated photo count to ${totalPhotos} for auto claim ${claim.claimNumber}`);
    }

    if (uploadedFiles.length) {
      await generateAndStoreClaimPdf({ claimId: claim.id, companyId: admin.companyId, kind: 'report', reason: 'documents_added' });
    }

    // Return results
    const response = {
      success: true,
      message: `Successfully uploaded ${uploadedFiles.length} files`,
      data: {
        claimId: claim.id,
        claimNumber: claim.claimNumber,
        uploadedFiles,
        totalUploaded: uploadedFiles.length,
        totalErrors: errors.length,
        errors: errors.length > 0 ? errors : undefined
      }
    };

    console.log(`[MEDIA][UPLOAD] Upload complete for claim ${claim.claimNumber}: ${uploadedFiles.length} successful, ${errors.length} errors`);

    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    console.error('[MEDIA][UPLOAD] Upload failed:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Invalid request data',
          details: error.issues 
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error during media upload' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const authError = await authMiddleware(request);
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const claimId = searchParams.get('claimId');

    if (!claimId) {
      return NextResponse.json(
        { error: 'claimId parameter is required' },
        { status: 400 }
      );
    }

    const claim = await prisma.claim.findFirst({
      where: { id: claimId, companyId: admin.companyId },
      select: { id: true },
    });

    if (!claim) {
      return NextResponse.json(
        { error: 'Claim not found' },
        { status: 404 }
      );
    }

    // Get all media files for the claim
    const claimDocuments = await prisma.claimDocument.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, claimId: true, fileName: true, fileType: true, fileSize: true, uploadedBy: true, createdAt: true,
        claim: {
          select: {
            claimNumber: true,
            customer: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    const mediaFiles = claimDocuments.map((doc: any) => ({
      id: doc.id,
      fileName: doc.fileName,
      filePath: `/api/documents/${doc.claimId}/${doc.id}`,
      fileType: doc.fileType,
      fileSize: doc.fileSize,
      category: String(doc.fileType).startsWith('image/') ? 'image' : 'document',
      uploadedBy: doc.uploadedBy,
      uploadedAt: doc.createdAt,
      claimNumber: doc.claim.claimNumber
    }));

    return NextResponse.json({
      success: true,
      data: {
        claimId,
        totalFiles: mediaFiles.length,
        files: mediaFiles
      }
    });

  } catch (error) {
    console.error('[MEDIA][GET] Error fetching media files:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}