import { NextRequest, NextResponse } from 'next/server';
import { knowledgeFileUrl, knowledgeFolder, writeStoredFile } from '@/lib/storage/fileStore';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { ADMIN_ROLES } from '@/lib/users/roles';

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json', 'application/xml', 'text/xml']);

/**
 * Extract text content from a file buffer based on its content type.
 * Supports: plain text, CSV, JSON, Markdown, and PDF files.
 */
async function extractTextContent(buffer: Buffer, contentType: string, filename: string): Promise<string | null> {
  try {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    // Plain text, CSV, JSON, Markdown → read directly as UTF-8
    if (
      contentType.startsWith('text/') ||
      ['txt', 'csv', 'json', 'md', 'xml', 'html'].includes(ext) ||
      contentType === 'application/json' ||
      contentType === 'application/xml'
    ) {
      const text = buffer.toString('utf-8');
      console.log(`[SETTINGS UPLOAD] Extracted ${text.length} chars of text from ${ext} file`);
      return text;
    }

    // PDF → extract text using pdf-parse
    if (contentType === 'application/pdf' || ext === 'pdf') {
      try {
        // pdf-parse/lib/pdf-parse skips the test-file loading in index.js
        const pdfParse = require('pdf-parse/lib/pdf-parse');
        const pdfData = await pdfParse(buffer);
        // Strip null bytes (0x00) — PostgreSQL TEXT columns reject them
        const text = pdfData.text?.replace(/\0/g, '').trim();
        
        if (text && text.length > 50) { // Require at least 50 chars to be useful
          console.log(`[SETTINGS UPLOAD] ✅ Extracted ${text.length} chars of text from PDF (${pdfData.numpages} pages)`);
          return text;
        }
        
        console.warn(`[SETTINGS UPLOAD] ⚠️ PDF parsed (${pdfData.numpages} pages) but insufficient text content found (${text?.length || 0} chars). Often indicates a scanned document.`);
        return null;
      } catch (pdfErr) {
        console.error('[SETTINGS UPLOAD] PDF text extraction failed:', pdfErr);
        return null;
      }
    }

    console.log(`[SETTINGS UPLOAD] No text extraction available for type: ${contentType} / ext: ${ext}`);
    return null;
  } catch (error) {
    console.error('[SETTINGS UPLOAD] Text extraction error:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  // Authenticate request
  const authError = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) return NextResponse.json({ error: 'Unsupported document type' }, { status: 400 });

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Validate file size
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)` },
        { status: 400 }
      );
    }

    const contentType = file.type || 'application/octet-stream';
    console.log('[SETTINGS UPLOAD] Storing knowledge document:', file.name, 'Size:', buffer.length, 'bytes', 'Admin:', admin.id);

    // Extract text content from the document BEFORE storing it
    const documentContent = await extractTextContent(buffer, contentType, file.name);
    if (documentContent) {
      console.log(`[SETTINGS UPLOAD] ✅ Text content extracted: ${documentContent.length} chars`);
    } else {
      console.warn('[SETTINGS UPLOAD] ⚠️ No text content could be extracted from file');
    }

    if (!admin.companyId) return NextResponse.json({ error: 'No company' }, { status: 403 });
    // Stored in the company's folder of the dashboard file store (same volume as claim documents);
    // nothing leaves the server.
    const key = await writeStoredFile(knowledgeFolder(admin.companyId), file.name, buffer);
    const url = knowledgeFileUrl(key);
    const filename = key.split('/').pop() as string;

    return NextResponse.json({
      url,
      filename,
      contentType,
      documentContent  // Include extracted text content in the response
    });

  } catch (error) {
    console.error('Error handling settings upload:', error);
    return NextResponse.json(
      { error: 'Internal server error during upload' },
      { status: 500 }
    );
  }
}
