import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { generateAndStoreClaimPdf } from '@/lib/pdf/claimPdfService';

// GET - List all claims for agents (authenticated, company-filtered)
export async function GET(request: NextRequest) {
  // Authenticate request
  const authError = await authMiddleware(request);
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[AGENTS][CLAIMS][GET] Fetching claims for company:', admin.companyId);
    
    const claims = await prisma.claim.findMany({
      where: {
        companyId: admin.companyId // Filter by company
      },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            phoneNumber: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`[AGENTS][CLAIMS][GET] Found ${claims.length} claims for company ${admin.companyId}`);

    return NextResponse.json({
      success: true,
      claims: claims.map((claim: any) => ({
        id: claim.id,
        claimNumber: claim.claimNumber,
        status: claim.status,
        type: claim.type,
        description: claim.description,
        incidentDate: claim.incidentDate,
        createdAt: claim.createdAt,
        customer: claim.customer
      }))
    });

  } catch (error) {
    console.error('[AGENTS][CLAIMS][GET] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch claims' },
      { status: 500 }
    );
  }
}

// Validation for claim categories (currently only Auto is supported)
const VALID_CLAIM_CATEGORIES = ['Auto'] as const;
// TODO: Add other claim types when ready: 'Travel', 'Fire', 'Transport', 'Construction'

// POST - Create new claim
export async function POST(request: NextRequest) {
  // Was unauthenticated: anyone could create a claim for any customer id.
  const authError = await authMiddleware(request);
  if (authError) return authError;
  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    console.log('[AGENTS][CLAIMS][POST] Creating new claim');
    
    const {
      customerId,
      type,
      description,
      incidentDate
    } = await request.json();

    console.log('[AGENTS][CLAIMS][POST] Request data:', { customerId, type, description, incidentDate });

    // Validate required fields
    if (!customerId || !type || !description) {
      return NextResponse.json(
        { success: false, error: 'Client, type et description sont requis' },
        { status: 400 }
      );
    }

    // Validate claim category
    if (!VALID_CLAIM_CATEGORIES.includes(type)) {
      return NextResponse.json(
        { success: false, error: `Type de réclamation invalide. Doit être: ${VALID_CLAIM_CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if customer exists
    // Only customers of the admin's own company.
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId: admin.companyId }
    });

    if (!customer) {
      return NextResponse.json(
        { success: false, error: 'Client non trouvé' },
        { status: 404 }
      );
    }

    // Generate claim number
    const claimCount = await prisma.claim.count();
    const claimNumber = `ACT-${new Date().getFullYear()}-${String(claimCount + 1).padStart(4, '0')}`;

    // Map claim types (currently only Auto is supported)
    const claimTypeMap: Record<string, string> = {
      'Auto': 'AUTO'
      // TODO: Add other claim types when ready:
      // 'Travel': 'TRAVEL', 
      // 'Fire': 'FIRE',
      // 'Transport': 'TRANSPORT',
      // 'Construction': 'CONSTRUCTION'
    };

    // Create new claim
    const claim = await prisma.claim.create({
      data: {
        claimNumber,
        type: (claimTypeMap[type] || 'AUTO') as any,
        description,
        status: 'NEW', // Default status
        incidentDate: incidentDate ? new Date(incidentDate) : new Date(),
        customerId,
        companyId: customer.companyId
      },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            phoneNumber: true
          }
        }
      }
    });

    console.log('[AGENTS][CLAIMS][POST] Claim created successfully:', claim.id);
    await generateAndStoreClaimPdf({ claimId: claim.id, companyId: admin.companyId, kind: 'report', reason: 'claim_created' });

    return NextResponse.json({
      success: true,
      claim: {
        id: claim.id,
        claimNumber: claim.claimNumber,
        status: claim.status,
        type: claim.type,
        description: claim.description,
        incidentDate: claim.incidentDate,
        createdAt: claim.createdAt,
        customer: claim.customer
      }
    });

  } catch (error) {
    console.error('[AGENTS][CLAIMS][POST] Error creating claim:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur lors de la création de la réclamation' },
      { status: 500 }
    );
  }
}