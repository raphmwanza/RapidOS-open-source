import { NextRequest, NextResponse } from 'next/server';
import { resolveClaimAccess } from '@/lib/claimAccess';
import { storeClaimDocument, validateUpload } from '@/lib/storage/documents';
import { generateAndStoreClaimPdf } from '@/lib/pdf/claimPdfService';

export const dynamic = 'force-dynamic';

/** POST (multipart "file") - attach a document to the claim (company-scoped, stored in the file store). */
export async function POST(request: NextRequest, { params }: { params: { id: string; claimNumber: string } }) {
  const access = await resolveClaimAccess(request, params.claimNumber);
  if (access instanceof NextResponse) return access;
  try {
    const file = (await request.formData()).get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    const upload = validateUpload(Buffer.from(await file.arrayBuffer()), file.type, file.name, 'document');
    if (!upload.ok) return NextResponse.json({ success: false, error: upload.error }, { status: upload.status });
    const document = await storeClaimDocument({
      companyId: access.companyId,
      claimId: access.claim.id,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      data: upload.data,
      uploadedBy: access.admin?.id || 'dashboard',
    });
    await generateAndStoreClaimPdf({ claimId: access.claim.id, companyId: access.companyId, kind: 'report', reason: 'documents_added' });
    return NextResponse.json({
      success: true,
      document: { ...document, filePath: `/api/documents/${access.claim.id}/${document.id}` },
      message: 'File uploaded successfully',
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ success: false, error: 'Failed to upload file' }, { status: 500 });
  }
}
